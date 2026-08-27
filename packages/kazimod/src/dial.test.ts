/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { dialDevicePath, dialPortSettings, takeDialLines } from "./dial";

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
