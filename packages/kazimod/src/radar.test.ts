/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Presence } from "@kazimo/shared";
import { Effect, Fiber, References } from "effect";
import {
  encodeRadarFrame,
  presenceAfter,
  RADAR_OPENING_QUERIES,
  type RadarPort,
  type RadarReport,
  radarLink,
  radarReportOf,
  takeRadarFrames,
} from "./radar";

const bytes = (hex: string) => Uint8Array.from(hex.split(" ").map((pair) => Number.parseInt(pair, 16)));
const hexOf = (data: Uint8Array) => [...data].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

const OCCUPIED = encodeRadarFrame(0x80, 0x01, [0x01]);
const EMPTY = encodeRadarFrame(0x80, 0x01, [0x00]);
const MOTION_ACTIVE = encodeRadarFrame(0x80, 0x02, [0x02]);
const MOTION_STATIC = encodeRadarFrame(0x80, 0x02, [0x01]);
const MOTION_NONE = encodeRadarFrame(0x80, 0x02, [0x00]);
const HEARTBEAT = encodeRadarFrame(0x01, 0x01, [0x0f]);
const ENERGY = encodeRadarFrame(0x80, 0x03, [0x2a]);
const MODEL = encodeRadarFrame(0x02, 0xa1, ascii("R24DVD1"));
const FIRMWARE = encodeRadarFrame(0x02, 0xa4, ascii("G24VD1SYV001006"));

const reportsOf = (chunks: Uint8Array[]) => {
  let pending = new Uint8Array(0) as Uint8Array;
  const reports: (RadarReport | null)[] = [];
  let rejected = 0;
  for (const chunk of chunks) {
    const taken = takeRadarFrames(pending, chunk);
    pending = taken.pending;
    rejected += taken.rejected;
    reports.push(...taken.frames.map(radarReportOf));
  }
  return { reports, pending, rejected };
};

describe("encodeRadarFrame", () => {
  test("matches the frames validated on the module", () => {
    expect(hexOf(encodeRadarFrame(0x02, 0xa4, [0x0f]))).toBe("53 59 02 a4 00 01 0f 62 54 43");
    expect(hexOf(encodeRadarFrame(0x80, 0x81, [0x0f]))).toBe("53 59 80 81 00 01 0f bd 54 43");
    expect(hexOf(OCCUPIED)).toBe("53 59 80 01 00 01 01 2f 54 43");
  });

  test("asks for model, firmware and current presence on open", () => {
    expect(RADAR_OPENING_QUERIES.map(hexOf)).toEqual([
      "53 59 02 a1 00 01 0f 5f 54 43",
      "53 59 02 a4 00 01 0f 62 54 43",
      "53 59 80 81 00 01 0f bd 54 43",
    ]);
  });
});

describe("takeRadarFrames", () => {
  test("decodes a recorded room entry", () => {
    const { reports, pending, rejected } = reportsOf([bytes("53 59 80 01 00 01 01 2f 54 43"), MOTION_ACTIVE]);
    expect(reports).toEqual([
      { t: "presence", occupied: true },
      { t: "motion", motion: "active" },
    ]);
    expect(pending.length).toBe(0);
    expect(rejected).toBe(0);
  });

  test("splits concatenated frames from a single read", () => {
    const { reports } = reportsOf([concat(HEARTBEAT, OCCUPIED, ENERGY, EMPTY)]);
    expect(reports).toEqual([
      { t: "heartbeat" },
      { t: "presence", occupied: true },
      { t: "energy", value: 42 },
      { t: "presence", occupied: false },
    ]);
  });

  test("reassembles frames split at every possible byte boundary", () => {
    const stream = concat(OCCUPIED, MOTION_STATIC);
    for (let cut = 1; cut < stream.length; cut += 1) {
      const { reports, pending } = reportsOf([stream.slice(0, cut), stream.slice(cut)]);
      expect(reports).toEqual([
        { t: "presence", occupied: true },
        { t: "motion", motion: "static" },
      ]);
      expect(pending.length).toBe(0);
    }
  });

  test("survives a stream delivered one byte at a time", () => {
    const stream = concat(MODEL, EMPTY);
    const { reports } = reportsOf([...stream].map((byte) => Uint8Array.of(byte)));
    expect(reports).toEqual([
      { t: "model", value: "R24DVD1" },
      { t: "presence", occupied: false },
    ]);
  });

  test("rejects a bad checksum and keeps the next frame", () => {
    const corrupt = OCCUPIED.slice();
    corrupt[7] = (corrupt[7] ?? 0) ^ 0xff;
    const { reports, rejected } = reportsOf([concat(corrupt, EMPTY)]);
    expect(reports).toEqual([{ t: "presence", occupied: false }]);
    expect(rejected).toBeGreaterThan(0);
  });

  test("rejects a frame with a broken footer", () => {
    const corrupt = OCCUPIED.slice();
    corrupt[corrupt.length - 1] = 0x00;
    const { reports } = reportsOf([concat(corrupt, MOTION_NONE)]);
    expect(reports).toEqual([{ t: "motion", motion: "none" }]);
  });

  test("resyncs after line noise, including a lone header byte", () => {
    const noise = bytes("00 ff 53 12 54 43 59 53");
    const { reports } = reportsOf([noise, concat(OCCUPIED, bytes("aa bb")), FIRMWARE]);
    expect(reports).toEqual([
      { t: "presence", occupied: true },
      { t: "firmware", value: "G24VD1SYV001006" },
    ]);
  });

  test("keeps only a possible header start from pure garbage", () => {
    expect(takeRadarFrames(new Uint8Array(0), bytes("01 02 03")).pending.length).toBe(0);
    expect(hexOf(takeRadarFrames(new Uint8Array(0), bytes("01 02 53")).pending)).toBe("53");
  });

  test("skips an implausible length instead of waiting forever", () => {
    const { reports, rejected } = reportsOf([concat(bytes("53 59 80 01 ff ff"), OCCUPIED)]);
    expect(reports).toEqual([{ t: "presence", occupied: true }]);
    expect(rejected).toBe(1);
  });
});

describe("radarReportOf", () => {
  const frame = (control: number, command: number, data: number[]) => ({
    control,
    command,
    data: Uint8Array.from(data),
  });

  test("reads the answers to the opening presence query", () => {
    expect(radarReportOf(frame(0x80, 0x81, [1]))).toEqual({ t: "presence", occupied: true });
    expect(radarReportOf(frame(0x80, 0x82, [0]))).toEqual({ t: "motion", motion: "none" });
  });

  test("reads direction and reset reports", () => {
    expect(radarReportOf(frame(0x80, 0x0b, [2]))).toEqual({ t: "direction", direction: "approaching" });
    expect(radarReportOf(frame(0x80, 0x10, [3]))).toEqual({ t: "direction", direction: "receding" });
    expect(radarReportOf(frame(0x01, 0x02, [0x0f]))).toEqual({ t: "reset" });
  });

  test("ignores out of range values and unknown commands", () => {
    expect(radarReportOf(frame(0x80, 0x01, [7]))).toBeNull();
    expect(radarReportOf(frame(0x80, 0x01, []))).toBeNull();
    expect(radarReportOf(frame(0x80, 0x02, [9]))).toBeNull();
    expect(radarReportOf(frame(0x80, 0x03, [101]))).toBeNull();
    expect(radarReportOf(frame(0x80, 0x0b, [9]))).toBeNull();
    expect(radarReportOf(frame(0x07, 0x81, [1]))).toBeNull();
  });
});

describe("presenceAfter", () => {
  test("follows the module's presence verdict", () => {
    expect(presenceAfter("unknown", { t: "presence", occupied: true })).toBe("present");
    expect(presenceAfter("present", { t: "presence", occupied: false })).toBe("absent");
  });

  test("treats any motion as someone in the room but waits for the module to call absence", () => {
    expect(presenceAfter("absent", { t: "motion", motion: "active" })).toBe("present");
    expect(presenceAfter("unknown", { t: "motion", motion: "static" })).toBe("present");
    expect(presenceAfter("present", { t: "motion", motion: "none" })).toBe("present");
  });

  test("forgets what it knew when the module resets", () => {
    expect(presenceAfter("present", { t: "reset" })).toBe("unknown");
  });

  test("keeps the current verdict on telemetry", () => {
    const telemetry: RadarReport[] = [
      { t: "heartbeat" },
      { t: "energy", value: 80 },
      { t: "direction", direction: "receding" },
      { t: "model", value: "R24DVD1" },
    ];
    for (const report of telemetry) {
      expect(presenceAfter("absent", report)).toBe("absent");
      expect(presenceAfter("present", report)).toBe("present");
    }
  });
});

type Script = (() => RadarPort) | Error;

function fakeDevice(scripts: Script[]) {
  const written: string[][] = [];
  let opens = 0;
  return {
    written,
    opens: () => opens,
    open: async (): Promise<RadarPort> => {
      const script = scripts[Math.min(opens, scripts.length - 1)];
      opens += 1;
      if (!script) throw new Error("no script");
      if (script instanceof Error) throw script;
      const port = script();
      const writes: string[] = [];
      written.push(writes);
      return {
        ...port,
        write: async (data) => {
          writes.push(hexOf(data));
        },
      };
    },
  };
}

function streamingPort(chunks: Uint8Array[], then: "quiet" | "unplug"): () => RadarPort {
  return () => {
    const queue = [...chunks];
    return {
      read: async (into) => {
        const next = queue.shift();
        if (next) {
          into.set(next);
          return next.length;
        }
        if (then === "unplug") throw new Error("ENXIO: device not configured");
        await Bun.sleep(1);
        return 0;
      },
      write: async () => {},
      probe: async () => {},
      close: async () => {},
    };
  };
}

async function watchLink(
  device: ReturnType<typeof fakeDevice>,
  done: (seen: Presence[]) => boolean,
  silenceLimitMs = 60_000,
) {
  const seen: Presence[] = [];
  const fiber = Effect.runFork(
    radarLink({
      name: "fake",
      open: device.open,
      onPresence: (presence) => seen.push(presence),
      reconnectDelayMs: 1,
      silenceLimitMs,
      now: Date.now,
    }).pipe(Effect.provideService(References.MinimumLogLevel, "None")),
  );
  const deadline = Date.now() + 2000;
  while (!done(seen) && Date.now() < deadline) await Bun.sleep(2);
  await Effect.runPromise(Fiber.interrupt(fiber));
  return seen;
}

describe("radarLink", () => {
  test("waits for a missing device, then falls back to unknown when it is unplugged", async () => {
    const device = fakeDevice([
      new Error("ENOENT: no such file"),
      streamingPort([concat(OCCUPIED, MOTION_ACTIVE)], "unplug"),
      streamingPort([EMPTY], "quiet"),
    ]);
    const seen = await watchLink(device, (presences) => presences.includes("absent"));
    expect(seen.slice(0, 3)).toEqual(["present", "unknown", "absent"]);
    expect(device.opens()).toBe(3);
    expect(device.written[0]).toEqual(RADAR_OPENING_QUERIES.map(hexOf));
    expect(device.written[1]).toEqual(RADAR_OPENING_QUERIES.map(hexOf));
  });

  test("reopens a module that went silent and forgets its last verdict", async () => {
    const device = fakeDevice([streamingPort([OCCUPIED], "quiet")]);
    const seen = await watchLink(device, (presences) => presences.length >= 3, 20);
    expect(seen.slice(0, 3)).toEqual(["present", "unknown", "present"]);
    expect(device.opens()).toBeGreaterThanOrEqual(2);
  });

  test("never reports presence from a port that only says hello", async () => {
    const device = fakeDevice([streamingPort([concat(MODEL, FIRMWARE, HEARTBEAT)], "quiet")]);
    const started = Date.now();
    const seen = await watchLink(device, () => Date.now() - started > 50);
    expect(seen).toEqual([]);
    expect(device.opens()).toBe(1);
  });
});
