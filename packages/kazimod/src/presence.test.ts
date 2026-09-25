/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Presence } from "@kazimo/shared";
import { createPresenceTracker, effectivePresence, nudgesPresence, type PresenceClock } from "./presence";

const HOLD_MS = 1000;

function manualClock() {
  let now = 0;
  let pending: { at: number; run: () => void } | null = null;
  const clock: PresenceClock = {
    now: () => now,
    schedule: (run, delayMs) => {
      const entry = { at: now + delayMs, run };
      pending = entry;
      return () => {
        if (pending === entry) pending = null;
      };
    },
  };
  return {
    clock,
    advance: (ms: number) => {
      now += ms;
      const due = pending;
      if (due && due.at <= now) {
        pending = null;
        due.run();
      }
    },
  };
}

function tracked() {
  const time = manualClock();
  const tracker = createPresenceTracker(time.clock, HOLD_MS);
  const seen: Presence[] = [];
  tracker.onChange((presence) => seen.push(presence));
  return { ...time, tracker, seen };
}

describe("nudgesPresence", () => {
  test("the wheel and the green button prove someone is there", () => {
    expect(nudgesPresence({ t: "wheel", d: 1 })).toBe(true);
    expect(nudgesPresence({ t: "wheel", d: -1 })).toBe(true);
    expect(nudgesPresence({ t: "button", b: "green", k: "press" })).toBe(true);
  });

  test("releases, magenta, maintenance and link chatter do not", () => {
    expect(nudgesPresence({ t: "button", b: "green", k: "release" })).toBe(false);
    expect(nudgesPresence({ t: "button", b: "magenta", k: "press" })).toBe(false);
    expect(nudgesPresence({ t: "maintenance" })).toBe(false);
    expect(nudgesPresence({ t: "hello", fw: "1.0" })).toBe(false);
    expect(nudgesPresence({ t: "pong" })).toBe(false);
  });
});

describe("effectivePresence", () => {
  test("the radar decides when nobody touched the dial", () => {
    expect(effectivePresence("present", 0, 10)).toBe("present");
    expect(effectivePresence("absent", 0, 10)).toBe("absent");
    expect(effectivePresence("unknown", 0, 10)).toBe("unknown");
  });

  test("a recent nudge overrides a radar that missed her", () => {
    expect(effectivePresence("absent", 20, 10)).toBe("present");
    expect(effectivePresence("unknown", 20, 10)).toBe("present");
    expect(effectivePresence("absent", 20, 20)).toBe("absent");
  });
});

describe("createPresenceTracker", () => {
  test("starts unknown, as a daemon without radar stays", () => {
    const { tracker, seen } = tracked();
    expect(tracker.current()).toBe("unknown");
    expect(seen).toEqual([]);
  });

  test("publishes radar transitions once each", () => {
    const { tracker, seen } = tracked();
    tracker.setRadar("present");
    tracker.setRadar("present");
    tracker.setRadar("absent");
    tracker.setRadar("unknown");
    expect(seen).toEqual(["present", "absent", "unknown"]);
  });

  test("a dial nudge wakes an empty room for the hold, then the radar wins again", () => {
    const { tracker, seen, advance } = tracked();
    tracker.setRadar("absent");
    tracker.nudge();
    expect(tracker.current()).toBe("present");
    advance(HOLD_MS - 1);
    expect(tracker.current()).toBe("present");
    advance(1);
    expect(tracker.current()).toBe("absent");
    expect(seen).toEqual(["absent", "present", "absent"]);
  });

  test("each nudge restarts the hold", () => {
    const { tracker, advance } = tracked();
    tracker.setRadar("absent");
    tracker.nudge();
    advance(HOLD_MS - 10);
    tracker.nudge();
    advance(HOLD_MS - 10);
    expect(tracker.current()).toBe("present");
    advance(10);
    expect(tracker.current()).toBe("absent");
  });

  test("a fresh radar absence cancels the nudge: she turned the wheel, then left", () => {
    const { tracker, seen, advance } = tracked();
    tracker.setRadar("present");
    tracker.nudge();
    tracker.setRadar("absent");
    expect(tracker.current()).toBe("absent");
    advance(HOLD_MS);
    expect(seen).toEqual(["present", "absent"]);
  });

  test("without radar a nudge is present for the hold, then back to unknown", () => {
    const { tracker, seen, advance } = tracked();
    tracker.nudge();
    advance(HOLD_MS);
    expect(seen).toEqual(["present", "unknown"]);
  });

  test("stops notifying a listener that unsubscribed", () => {
    const time = manualClock();
    const tracker = createPresenceTracker(time.clock, HOLD_MS);
    const seen: Presence[] = [];
    const stop = tracker.onChange((presence) => seen.push(presence));
    tracker.setRadar("present");
    stop();
    tracker.setRadar("absent");
    expect(seen).toEqual(["present"]);
  });
});
