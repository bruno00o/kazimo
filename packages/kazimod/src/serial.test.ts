/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { drainSerialInput, serialDevicePath, serialPortSettings } from "./serial";

const BAUD_RATE = 115200;

function queuedReads(chunks: number[]) {
  const queue = [...chunks];
  let reads = 0;
  return {
    readCount: () => reads,
    read: async () => {
      reads += 1;
      return queue.shift() ?? 0;
    },
  };
}

describe("serialDevicePath", () => {
  test("uses the callout device on macOS so opening never waits on carrier", () => {
    expect(serialDevicePath("/dev/tty.usbmodem14201", "darwin")).toBe("/dev/cu.usbmodem14201");
    expect(serialDevicePath("/dev/tty.usbserial-2140", "darwin")).toBe("/dev/cu.usbserial-2140");
    expect(serialDevicePath("/dev/cu.usbserial-2140", "darwin")).toBe("/dev/cu.usbserial-2140");
  });

  test("leaves linux device paths alone", () => {
    expect(serialDevicePath("/dev/ttyACM0", "linux")).toBe("/dev/ttyACM0");
    expect(serialDevicePath("/dev/ttyUSB0", "linux")).toBe("/dev/ttyUSB0");
    expect(serialDevicePath("/dev/serial/by-id/usb-Prolific_PL2303", "linux")).toBe(
      "/dev/serial/by-id/usb-Prolific_PL2303",
    );
  });
});

describe("serialPortSettings", () => {
  test("picks the platform flag and asks for raw reads that time out", () => {
    expect(serialPortSettings("/dev/cu.usbmodem1", "darwin", BAUD_RATE).slice(0, 4)).toEqual([
      "stty",
      "-f",
      "/dev/cu.usbmodem1",
      "115200",
    ]);
    expect(serialPortSettings("/dev/ttyUSB0", "linux", BAUD_RATE).slice(0, 4)).toEqual([
      "stty",
      "-F",
      "/dev/ttyUSB0",
      "115200",
    ]);
    const settings = serialPortSettings("/dev/ttyACM0", "linux", BAUD_RATE);
    expect(settings).toContain("raw");
    expect(settings).toContain("-echo");
    expect(settings.slice(-4)).toEqual(["min", "0", "time", "1"]);
  });
});

describe("drainSerialInput", () => {
  test("swallows everything the port buffered while nobody was reading", async () => {
    const port = queuedReads([40, 20]);
    const dropped = await Effect.runPromise(drainSerialInput(port.read, (cause) => cause));
    expect(dropped).toBe(60);
    expect(port.readCount()).toBe(3);
  });

  test("returns at once on a quiet port", async () => {
    const port = queuedReads([]);
    expect(await Effect.runPromise(drainSerialInput(port.read, (cause) => cause))).toBe(0);
    expect(port.readCount()).toBe(1);
  });

  test("fails with the caller's error when the device vanished", async () => {
    const vanished = () => Promise.reject(new Error("ENXIO"));
    const outcome = await Effect.runPromise(
      Effect.flip(drainSerialInput(vanished, (cause) => ({ tag: "gone", cause }))),
    );
    expect(outcome.tag).toBe("gone");
  });
});
