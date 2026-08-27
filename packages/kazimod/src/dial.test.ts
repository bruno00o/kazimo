/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { type DialCommand, type DialEvent, parseDialEvent } from "@kazimo/shared";
import { Effect } from "effect";
import {
  type DialLabels,
  dialDevicePath,
  dialPortSettings,
  dialReplyTo,
  drainDialInput,
  takeDialLines,
} from "./dial";

const FAKE_PORT_BUFFER_BYTES = 512;

function fakePort(buffered: string[]) {
  const queue = [...buffered];
  const buffer = Buffer.allocUnsafe(FAKE_PORT_BUFFER_BYTES);
  const written: DialCommand[] = [];
  let reads = 0;
  return {
    buffer,
    written,
    readCount: () => reads,
    push: (chunk: string) => queue.push(chunk),
    read: async () => {
      reads += 1;
      const next = queue.shift();
      return next === undefined ? 0 : buffer.write(next, 0, "utf8");
    },
    write: (command: DialCommand) => {
      written.push(command);
    },
  };
}

async function pump(port: ReturnType<typeof fakePort>, labels: DialLabels): Promise<DialEvent[]> {
  const seen: DialEvent[] = [];
  let pending = "";
  for (;;) {
    const bytesRead = await port.read();
    if (bytesRead === 0) return seen;
    const taken = takeDialLines(pending, port.buffer.toString("utf8", 0, bytesRead));
    pending = taken.pending;
    for (const line of taken.lines) {
      const event = parseDialEvent(line);
      if (event === null) continue;
      const reply = dialReplyTo(event, labels);
      if (reply) port.write(reply);
      seen.push(event);
    }
  }
}

describe("dialDevicePath", () => {
  test("uses the callout device on macOS so opening never waits on carrier", () => {
    expect(dialDevicePath("/dev/tty.usbmodem14201", "darwin")).toBe("/dev/cu.usbmodem14201");
    expect(dialDevicePath("/dev/cu.usbmodem14201", "darwin")).toBe("/dev/cu.usbmodem14201");
  });

  test("leaves linux device paths alone", () => {
    expect(dialDevicePath("/dev/ttyACM0", "linux")).toBe("/dev/ttyACM0");
    expect(dialDevicePath("/dev/serial/by-id/usb-M5Stack_Dial", "linux")).toBe(
      "/dev/serial/by-id/usb-M5Stack_Dial",
    );
  });
});

describe("dialPortSettings", () => {
  test("picks the platform flag and asks for raw reads that time out", () => {
    expect(dialPortSettings("/dev/cu.usbmodem1", "darwin").slice(0, 4)).toEqual([
      "stty",
      "-f",
      "/dev/cu.usbmodem1",
      "115200",
    ]);
    expect(dialPortSettings("/dev/ttyACM0", "linux").slice(0, 4)).toEqual([
      "stty",
      "-F",
      "/dev/ttyACM0",
      "115200",
    ]);
    const settings = dialPortSettings("/dev/ttyACM0", "linux");
    expect(settings).toContain("raw");
    expect(settings).toContain("-echo");
    expect(settings.slice(-4)).toEqual(["min", "0", "time", "1"]);
  });
});

describe("takeDialLines", () => {
  test("emits only complete lines and keeps the tail", () => {
    const first = takeDialLines("", '{"t":"pong"}\n{"t":"whe');
    expect(first.lines).toEqual(['{"t":"pong"}']);
    expect(first.pending).toBe('{"t":"whe');

    const second = takeDialLines(first.pending, 'el","d":1}\n');
    expect(second.lines).toEqual(['{"t":"wheel","d":1}']);
    expect(second.pending).toBe("");
  });

  test("returns nothing while a line is still arriving", () => {
    expect(takeDialLines("", "{").lines).toEqual([]);
  });

  test("drops a tail that grew past a plausible line", () => {
    expect(takeDialLines("x".repeat(600), "y").pending).toBe("");
  });
});

describe("drainDialInput", () => {
  test("swallows everything the port buffered while nobody was reading", async () => {
    const buffered = ['{"t":"button","b":"green","k":"press"}\n', '{"t":"wheel","d":1}\n'];
    const port = fakePort(buffered);
    const dropped = await Effect.runPromise(drainDialInput(port.read));
    expect(dropped).toBe(buffered.join("").length);
    expect(port.readCount()).toBe(buffered.length + 1);
  });

  test("returns at once on a quiet port", async () => {
    const port = fakePort([]);
    expect(await Effect.runPromise(drainDialInput(port.read))).toBe(0);
    expect(port.readCount()).toBe(1);
  });
});

describe("dialReplyTo", () => {
  test("rewrites the cached labels when the firmware reintroduces itself", () => {
    expect(dialReplyTo({ t: "hello", fw: "1.0" }, { green: "Atender", magenta: "Recusar" })).toEqual({
      t: "labels",
      green: "Atender",
      magenta: "Recusar",
    });
  });

  test("stays quiet for every other event", () => {
    const labels: DialLabels = { green: "", magenta: "Desligar" };
    expect(dialReplyTo({ t: "wheel", d: 1 }, labels)).toBeNull();
    expect(dialReplyTo({ t: "button", b: "green", k: "press" }, labels)).toBeNull();
    expect(dialReplyTo({ t: "maintenance" }, labels)).toBeNull();
    expect(dialReplyTo({ t: "pong" }, labels)).toBeNull();
  });
});

describe("a daemon restart on a port that kept talking", () => {
  test("ignores the replayed press and relabels when the firmware says hello", async () => {
    const port = fakePort(['{"t":"button","b":"magenta","k":"press"}\n']);
    expect(await Effect.runPromise(drainDialInput(port.read))).toBeGreaterThan(0);

    port.push('{"t":"hello","fw":"1.0"}\n{"t":"button","b":"green","k":"press"}\n');
    const seen = await pump(port, { green: "Atender", magenta: "Recusar" });

    expect(seen).toEqual([
      { t: "hello", fw: "1.0" },
      { t: "button", b: "green", k: "press" },
    ]);
    expect(port.written).toEqual([{ t: "labels", green: "Atender", magenta: "Recusar" }]);
  });
});
