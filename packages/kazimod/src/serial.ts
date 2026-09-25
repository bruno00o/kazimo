import { Effect } from "effect";

export const serialDevicePath = (configured: string, platform: string): string =>
  platform === "darwin" ? configured.replace(/^\/dev\/tty\./, "/dev/cu.") : configured;

export const serialPortSettings = (path: string, platform: string, baudRate: number): string[] => [
  "stty",
  platform === "darwin" ? "-f" : "-F",
  path,
  String(baudRate),
  "raw",
  "-echo",
  "-echoe",
  "-echok",
  "-crtscts",
  "clocal",
  "min",
  "0",
  "time",
  "1",
];

export const configureSerialPort = async (path: string, platform: string, baudRate: number) => {
  const stty = Bun.spawn(serialPortSettings(path, platform, baudRate), {
    stdout: "ignore",
    stderr: "pipe",
  });
  const complaint = await new Response(stty.stderr).text();
  const status = await stty.exited;
  if (status !== 0) throw new Error(complaint.trim() || `stty exited with ${status}`);
};

export const drainSerialInput = <E>(read: () => Promise<number>, onError: (cause: unknown) => E) =>
  Effect.gen(function* () {
    let dropped = 0;
    while (true) {
      const bytesRead = yield* Effect.tryPromise({ try: read, catch: onError });
      if (bytesRead === 0) return dropped;
      dropped += bytesRead;
    }
  });

export const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
