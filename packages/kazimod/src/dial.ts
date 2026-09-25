import { access, open } from "node:fs/promises";
import {
  DIAL_BAUD_RATE,
  type DialCommand,
  type DialEvent,
  encodeDialCommand,
  parseDialEvent,
} from "@kazimo/shared";
import { Context, Effect, Layer, Schema } from "effect";
import { daemonConfig } from "./config";
import { configureSerialPort, describeCause, drainSerialInput, serialDevicePath } from "./serial";

const DIAL_RECONNECT_DELAY_MS = 2000;
const DIAL_READ_BUFFER_BYTES = 512;
const DIAL_MAX_LINE_LENGTH = 512;
const DIAL_IDLE_READS_BEFORE_PROBE = 10;

export class DialPortError extends Schema.TaggedError<DialPortError>()("DialPortError", {
  cause: Schema.Defect(),
}) {}

export const takeDialLines = (pending: string, chunk: string): { lines: string[]; pending: string } => {
  const parts = (pending + chunk).split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, pending: rest.length > DIAL_MAX_LINE_LENGTH ? "" : rest };
};

export interface DialLabels {
  readonly green: string;
  readonly magenta: string;
}

export const dialReplyTo = (event: DialEvent, labels: DialLabels): DialCommand | null =>
  event.t === "hello" ? { t: "labels", green: labels.green, magenta: labels.magenta } : null;

const log = (message: string) => Effect.log(`dial: ${message}`);

export interface DialApi {
  readonly connected: () => boolean;
  readonly setLabels: (green: string, magenta: string) => void;
  readonly onEvent: (listener: (event: DialEvent) => void) => () => void;
}

export class Dial extends Context.Service<Dial, DialApi>()("kazimo/kazimod/Dial") {
  static readonly layer = Layer.effect(
    Dial,
    Effect.gen(function* () {
      const config = yield* daemonConfig;

      const listeners = new Set<(event: DialEvent) => void>();
      let labels = { green: "", magenta: "" };
      let write: ((command: DialCommand) => void) | null = null;

      const api = Dial.of({
        connected: () => write !== null,
        setLabels: (green, magenta) => {
          labels = { green, magenta };
          write?.({ t: "labels", green, magenta });
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      });

      if (config.dialPort === null) {
        yield* log("no KAZIMO_DIAL_PORT, wheel and buttons are off");
        return api;
      }

      const path = serialDevicePath(config.dialPort, process.platform);
      let lastFailure: string | null = null;

      const configurePort = Effect.tryPromise({
        try: () => configureSerialPort(path, process.platform, DIAL_BAUD_RATE),
        catch: (cause) => new DialPortError({ cause }),
      });

      const session = Effect.gen(function* () {
        const port = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => open(path, "r+"),
            catch: (cause) => new DialPortError({ cause }),
          }),
          (handle) => Effect.promise(() => handle.close().catch(() => undefined)),
        );

        yield* configurePort;

        const buffer = Buffer.allocUnsafe(DIAL_READ_BUFFER_BYTES);
        const readIntoBuffer = () =>
          port.read(buffer, 0, buffer.length, null).then(({ bytesRead }) => bytesRead);

        const stale = yield* drainSerialInput(readIntoBuffer, (cause) => new DialPortError({ cause }));
        if (stale > 0) yield* log(`dropped ${stale} stale bytes`);

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            write = (command) => {
              void port.write(Buffer.from(encodeDialCommand(command), "utf8")).catch(() => undefined);
            };
          }),
          () =>
            Effect.sync(() => {
              write = null;
            }),
        );

        lastFailure = null;
        yield* log(`connected on ${path}`);
        write?.({ t: "ping" });
        write?.({ t: "labels", green: labels.green, magenta: labels.magenta });

        let pending = "";
        let idleReads = 0;

        yield* Effect.forever(
          Effect.gen(function* () {
            const bytesRead = yield* Effect.tryPromise({
              try: readIntoBuffer,
              catch: (cause) => new DialPortError({ cause }),
            });

            if (bytesRead === 0) {
              idleReads += 1;
              if (idleReads < DIAL_IDLE_READS_BEFORE_PROBE) return;
              idleReads = 0;
              yield* Effect.tryPromise({
                try: () => access(path),
                catch: (cause) => new DialPortError({ cause }),
              });
              return;
            }

            idleReads = 0;
            const taken = takeDialLines(pending, buffer.toString("utf8", 0, bytesRead));
            pending = taken.pending;
            for (const line of taken.lines) {
              const event = parseDialEvent(line);
              if (event === null) continue;
              yield* log(JSON.stringify(event));
              const reply = dialReplyTo(event, labels);
              if (reply) write?.(reply);
              for (const listener of listeners) listener(event);
            }
          }),
        );
      });

      yield* Effect.forkScoped(
        session.pipe(
          Effect.scoped,
          Effect.catch((error) => {
            const complaint = describeCause(error.cause);
            if (complaint === lastFailure) return Effect.void;
            lastFailure = complaint;
            return log(`${path} unavailable: ${complaint}`);
          }),
          Effect.flatMap(() => Effect.sleep(DIAL_RECONNECT_DELAY_MS)),
          Effect.forever,
        ),
      );

      return api;
    }),
  );
}
