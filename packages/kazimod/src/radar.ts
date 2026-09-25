import { access, open } from "node:fs/promises";
import type { Presence } from "@kazimo/shared";
import { Context, Effect, Layer, Schema } from "effect";
import { daemonConfig } from "./config";
import { configureSerialPort, describeCause, serialDevicePath } from "./serial";

export const RADAR_BAUD_RATE = 115200;
export const RADAR_RECONNECT_DELAY_MS = 2000;
export const RADAR_SILENCE_LIMIT_MS = 150_000;

const RADAR_HEADER = [0x53, 0x59] as const;
const RADAR_FOOTER = [0x54, 0x43] as const;
const RADAR_PREAMBLE_BYTES = 6;
const RADAR_TRAILER_BYTES = 3;
const RADAR_MAX_DATA_BYTES = 256;
const RADAR_QUERY = 0x0f;
const RADAR_READ_BUFFER_BYTES = 512;
const RADAR_IDLE_READS_BEFORE_PROBE = 10;

const RadarKey = {
  heartbeat: 0x0101,
  reset: 0x0102,
  model: 0x02a1,
  firmware: 0x02a4,
  presence: 0x8001,
  motion: 0x8002,
  energy: 0x8003,
  direction: 0x800b,
  directionAlt: 0x8010,
  presenceAnswer: 0x8081,
  motionAnswer: 0x8082,
  energyAnswer: 0x8083,
} as const;

export class RadarPortError extends Schema.TaggedError<RadarPortError>()("RadarPortError", {
  cause: Schema.Defect(),
}) {}

export interface RadarFrame {
  readonly control: number;
  readonly command: number;
  readonly data: Uint8Array;
}

export type RadarMotion = "none" | "static" | "active";
export type RadarDirection = "still" | "approaching" | "receding";

export type RadarReport =
  | { t: "heartbeat" }
  | { t: "reset" }
  | { t: "model"; value: string }
  | { t: "firmware"; value: string }
  | { t: "presence"; occupied: boolean }
  | { t: "motion"; motion: RadarMotion }
  | { t: "energy"; value: number }
  | { t: "direction"; direction: RadarDirection };

const MOTIONS: readonly RadarMotion[] = ["none", "static", "active"];
const DIRECTIONS: Readonly<Record<number, RadarDirection>> = { 1: "still", 2: "approaching", 3: "receding" };
const MAX_ENERGY = 100;

const sumOf = (bytes: Uint8Array): number => bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0);

const byteAt = (bytes: Uint8Array, index: number): number => bytes[index] ?? -1;

export const encodeRadarFrame = (control: number, command: number, data: readonly number[]): Uint8Array => {
  const body = Uint8Array.from([
    ...RADAR_HEADER,
    control,
    command,
    (data.length >> 8) & 0xff,
    data.length & 0xff,
    ...data,
  ]);
  return Uint8Array.from([...body, sumOf(body), ...RADAR_FOOTER]);
};

export const RADAR_OPENING_QUERIES: readonly Uint8Array[] = [
  encodeRadarFrame(0x02, 0xa1, [RADAR_QUERY]),
  encodeRadarFrame(0x02, 0xa4, [RADAR_QUERY]),
  encodeRadarFrame(0x80, 0x81, [RADAR_QUERY]),
];

const headerAt = (bytes: Uint8Array, from: number): number => {
  for (let index = from; index < bytes.length - 1; index += 1) {
    if (bytes[index] === RADAR_HEADER[0] && bytes[index + 1] === RADAR_HEADER[1]) return index;
  }
  return -1;
};

export interface TakenRadarFrames {
  readonly frames: RadarFrame[];
  readonly pending: Uint8Array;
  readonly rejected: number;
}

export const takeRadarFrames = (pending: Uint8Array, chunk: Uint8Array): TakenRadarFrames => {
  const bytes = new Uint8Array(pending.length + chunk.length);
  bytes.set(pending);
  bytes.set(chunk, pending.length);
  const frames: RadarFrame[] = [];
  let rejected = 0;
  let offset = 0;

  while (true) {
    const start = headerAt(bytes, offset);
    if (start < 0) {
      const tail = byteAt(bytes, bytes.length - 1) === RADAR_HEADER[0] ? bytes.slice(-1) : new Uint8Array(0);
      return { frames, pending: tail, rejected };
    }
    offset = start;
    if (bytes.length - offset < RADAR_PREAMBLE_BYTES) break;
    const length = (byteAt(bytes, offset + 4) << 8) | byteAt(bytes, offset + 5);
    if (length > RADAR_MAX_DATA_BYTES) {
      rejected += 1;
      offset += 1;
      continue;
    }
    const total = RADAR_PREAMBLE_BYTES + length + RADAR_TRAILER_BYTES;
    if (bytes.length - offset < total) break;
    const frame = bytes.subarray(offset, offset + total);
    const bodyEnd = RADAR_PREAMBLE_BYTES + length;
    const valid =
      byteAt(frame, bodyEnd) === sumOf(frame.subarray(0, bodyEnd)) &&
      byteAt(frame, total - 2) === RADAR_FOOTER[0] &&
      byteAt(frame, total - 1) === RADAR_FOOTER[1];
    if (!valid) {
      rejected += 1;
      offset += 1;
      continue;
    }
    frames.push({
      control: byteAt(frame, 2),
      command: byteAt(frame, 3),
      data: frame.slice(RADAR_PREAMBLE_BYTES, bodyEnd),
    });
    offset += total;
  }

  return { frames, pending: bytes.slice(offset), rejected };
};

const textOf = (data: Uint8Array): string => new TextDecoder().decode(data).replace(/\0+$/, "").trim();

export const radarReportOf = (frame: RadarFrame): RadarReport | null => {
  const value = frame.data.length === 1 ? byteAt(frame.data, 0) : -1;
  switch ((frame.control << 8) | frame.command) {
    case RadarKey.heartbeat:
      return { t: "heartbeat" };
    case RadarKey.reset:
      return { t: "reset" };
    case RadarKey.model:
      return { t: "model", value: textOf(frame.data) };
    case RadarKey.firmware:
      return { t: "firmware", value: textOf(frame.data) };
    case RadarKey.presence:
    case RadarKey.presenceAnswer:
      return value === 0 || value === 1 ? { t: "presence", occupied: value === 1 } : null;
    case RadarKey.motion:
    case RadarKey.motionAnswer: {
      const motion = MOTIONS[value];
      return motion ? { t: "motion", motion } : null;
    }
    case RadarKey.energy:
    case RadarKey.energyAnswer:
      return value >= 0 && value <= MAX_ENERGY ? { t: "energy", value } : null;
    case RadarKey.direction:
    case RadarKey.directionAlt: {
      const direction = DIRECTIONS[value];
      return direction ? { t: "direction", direction } : null;
    }
    default:
      return null;
  }
};

export const presenceAfter = (current: Presence, report: RadarReport): Presence => {
  if (report.t === "presence") return report.occupied ? "present" : "absent";
  if (report.t === "motion" && report.motion !== "none") return "present";
  if (report.t === "reset") return "unknown";
  return current;
};

export interface RadarPort {
  readonly read: (into: Uint8Array) => Promise<number>;
  readonly write: (bytes: Uint8Array) => Promise<void>;
  readonly probe: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface RadarLinkOptions {
  readonly name: string;
  readonly open: () => Promise<RadarPort>;
  readonly onPresence: (presence: Presence) => void;
  readonly reconnectDelayMs: number;
  readonly silenceLimitMs: number;
  readonly now: () => number;
}

const log = (message: string) => Effect.log(`radar: ${message}`);

const portFailure = (cause: unknown) => new RadarPortError({ cause });

export const radarLink = (options: RadarLinkOptions) => {
  let presence: Presence = "unknown";
  let lastFailure: string | null = null;

  const settle = (next: Presence) =>
    Effect.suspend(() => {
      if (next === presence) return Effect.void;
      presence = next;
      options.onPresence(next);
      return Effect.logDebug(`radar: presence ${next}`);
    });

  const session = Effect.gen(function* () {
    const port = yield* Effect.acquireRelease(
      Effect.tryPromise({ try: options.open, catch: portFailure }),
      (handle) =>
        Effect.promise(() => handle.close().catch(() => undefined)).pipe(Effect.andThen(settle("unknown"))),
    );

    for (const query of RADAR_OPENING_QUERIES) {
      yield* Effect.tryPromise({ try: () => port.write(query), catch: portFailure });
    }

    lastFailure = null;
    yield* log(`connected on ${options.name}`);

    const buffer = new Uint8Array(RADAR_READ_BUFFER_BYTES);
    let pending: Uint8Array = new Uint8Array(0);
    let idleReads = 0;
    let lastHeard = options.now();

    yield* Effect.forever(
      Effect.gen(function* () {
        const bytesRead = yield* Effect.tryPromise({ try: () => port.read(buffer), catch: portFailure });

        if (bytesRead === 0) {
          const silentFor = options.now() - lastHeard;
          if (silentFor > options.silenceLimitMs) {
            return yield* Effect.fail(portFailure(new Error(`silent for ${Math.round(silentFor / 1000)}s`)));
          }
          idleReads += 1;
          if (idleReads < RADAR_IDLE_READS_BEFORE_PROBE) return;
          idleReads = 0;
          yield* Effect.tryPromise({ try: port.probe, catch: portFailure });
          return;
        }

        idleReads = 0;
        const taken = takeRadarFrames(pending, buffer.slice(0, bytesRead));
        pending = taken.pending;
        if (taken.rejected > 0)
          yield* Effect.logDebug(`radar: skipped ${taken.rejected} corrupt frame starts`);
        for (const frame of taken.frames) {
          lastHeard = options.now();
          const report = radarReportOf(frame);
          if (report === null) continue;
          if (report.t === "model" || report.t === "firmware") yield* log(`${report.t} ${report.value}`);
          if (report.t === "reset") yield* log("module reset");
          yield* settle(presenceAfter(presence, report));
        }
      }),
    );
  });

  return session.pipe(
    Effect.scoped,
    Effect.catch((error) => {
      const complaint = describeCause(error.cause);
      if (complaint === lastFailure) return Effect.void;
      lastFailure = complaint;
      return log(`${options.name} unavailable: ${complaint}`);
    }),
    Effect.flatMap(() => Effect.sleep(options.reconnectDelayMs)),
    Effect.forever,
  );
};

const openRadarPort = async (path: string): Promise<RadarPort> => {
  const handle = await open(path, "r+");
  try {
    await configureSerialPort(path, process.platform, RADAR_BAUD_RATE);
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  return {
    read: (into) => handle.read(into, 0, into.length, null).then(({ bytesRead }) => bytesRead),
    write: (bytes) => handle.write(bytes).then(() => undefined),
    probe: () => access(path),
    close: () => handle.close(),
  };
};

export interface RadarApi {
  readonly presence: () => Presence;
  readonly onPresence: (listener: (presence: Presence) => void) => () => void;
}

export class Radar extends Context.Service<Radar, RadarApi>()("kazimo/kazimod/Radar") {
  static readonly layer = Layer.effect(
    Radar,
    Effect.gen(function* () {
      const config = yield* daemonConfig;

      const listeners = new Set<(presence: Presence) => void>();
      let presence: Presence = "unknown";

      const api = Radar.of({
        presence: () => presence,
        onPresence: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      });

      if (config.radarPort === null) {
        yield* log("no KAZIMO_RADAR_PORT, presence unknown, daytime rules apply");
        return api;
      }

      const path = serialDevicePath(config.radarPort, process.platform);

      yield* Effect.forkScoped(
        radarLink({
          name: path,
          open: () => openRadarPort(path),
          onPresence: (next) => {
            presence = next;
            for (const listener of listeners) listener(next);
          },
          reconnectDelayMs: RADAR_RECONNECT_DELAY_MS,
          silenceLimitMs: RADAR_SILENCE_LIMIT_MS,
          now: Date.now,
        }),
      );

      return api;
    }),
  );
}
