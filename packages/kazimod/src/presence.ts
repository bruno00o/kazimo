import type { DialEvent, Presence as PresenceState } from "@kazimo/shared";
import { Context, Effect, Layer } from "effect";
import { Dial } from "./dial";
import { Radar } from "./radar";

export const PRESENCE_NUDGE_HOLD_MS = 120_000;

export const nudgesPresence = (event: DialEvent): boolean =>
  event.t === "wheel" || (event.t === "button" && event.b === "green" && event.k === "press");

export const effectivePresence = (radar: PresenceState, nudgedUntil: number, now: number): PresenceState =>
  radar === "present" || now < nudgedUntil ? "present" : radar;

export interface PresenceClock {
  readonly now: () => number;
  readonly schedule: (run: () => void, delayMs: number) => () => void;
}

export const systemClock: PresenceClock = {
  now: Date.now,
  schedule: (run, delayMs) => {
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  },
};

export interface PresenceApi {
  readonly current: () => PresenceState;
  readonly onChange: (listener: (presence: PresenceState) => void) => () => void;
}

export interface PresenceTracker extends PresenceApi {
  readonly setRadar: (radar: PresenceState) => void;
  readonly nudge: () => void;
}

export const createPresenceTracker = (
  clock: PresenceClock,
  holdMs: number = PRESENCE_NUDGE_HOLD_MS,
): PresenceTracker => {
  const listeners = new Set<(presence: PresenceState) => void>();
  let radar: PresenceState = "unknown";
  let nudgedUntil = 0;
  let cancelExpiry: (() => void) | null = null;
  let current: PresenceState = "unknown";

  const publish = () => {
    const next = effectivePresence(radar, nudgedUntil, clock.now());
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener(next);
  };

  const clearNudge = () => {
    cancelExpiry?.();
    cancelExpiry = null;
    nudgedUntil = 0;
  };

  return {
    current: () => current,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRadar: (next) => {
      if (next === radar) return;
      radar = next;
      if (next === "absent") clearNudge();
      publish();
    },
    nudge: () => {
      cancelExpiry?.();
      nudgedUntil = clock.now() + holdMs;
      cancelExpiry = clock.schedule(() => {
        cancelExpiry = null;
        publish();
      }, holdMs);
      publish();
    },
  };
};

export class Presence extends Context.Service<Presence, PresenceApi>()("kazimo/kazimod/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const radar = yield* Radar;
      const dial = yield* Dial;
      const tracker = createPresenceTracker(systemClock);

      tracker.setRadar(radar.presence());
      const stopRadar = radar.onPresence(tracker.setRadar);
      const stopDial = dial.onEvent((event) => {
        if (nudgesPresence(event)) tracker.nudge();
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stopRadar();
          stopDial();
        }),
      );

      return Presence.of({ current: tracker.current, onChange: tracker.onChange });
    }),
  );
}
