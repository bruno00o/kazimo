import { describe, expect, test } from "bun:test";
import type { Presence } from "@kazimo/shared";
import { mayAutoAnswer, mayInterrupt, screenAsleep } from "./presence";

const DAY = false;
const NIGHT = true;
const PRESENCES: Presence[] = ["present", "absent", "unknown"];

describe("screen wake", () => {
  test("entering the room wakes the screen during the day", () => {
    expect(screenAsleep(DAY, "present")).toBe(false);
  });

  test("an empty room lets the screen sleep", () => {
    expect(screenAsleep(DAY, "absent")).toBe(true);
  });

  test("without radar the screen stays awake by day, as before", () => {
    expect(screenAsleep(DAY, "unknown")).toBe(false);
  });

  test("the night keeps the screen asleep whoever is in the room", () => {
    for (const presence of PRESENCES) expect(screenAsleep(NIGHT, presence)).toBe(true);
  });
});

describe("auto-answer", () => {
  test("picks up only when she is there", () => {
    expect(mayAutoAnswer(DAY, "present")).toBe(true);
    expect(mayAutoAnswer(DAY, "absent")).toBe(false);
  });

  test("falls back to the daytime window without radar", () => {
    expect(mayAutoAnswer(DAY, "unknown")).toBe(true);
    expect(mayAutoAnswer(NIGHT, "unknown")).toBe(false);
  });

  test("never picks up at night", () => {
    for (const presence of PRESENCES) expect(mayAutoAnswer(NIGHT, presence)).toBe(false);
  });
});

describe("message announcements", () => {
  test("announce aloud and display when she is there by day", () => {
    expect(mayInterrupt(DAY, "present")).toBe(true);
  });

  test("an empty room gets a silent badge, so nothing counts as seen", () => {
    expect(mayInterrupt(DAY, "absent")).toBe(false);
  });

  test("without radar messages are announced by day, as before", () => {
    expect(mayInterrupt(DAY, "unknown")).toBe(true);
  });

  test("the night is always a silent badge", () => {
    for (const presence of PRESENCES) expect(mayInterrupt(NIGHT, presence)).toBe(false);
  });
});
