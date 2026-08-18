import type { ActivitySummary, DaemonToKiosk } from "@kazimo/shared";
import { Context, Layer } from "effect";

const emptyActivity = (): ActivitySummary => ({ unread: [], missed: [], ringing: null });

export interface KioskBridgeApi {
  readonly activity: () => ActivitySummary;
  readonly setActivity: (activity: ActivitySummary) => void;
  readonly clearActivity: (what: "unread" | "missed") => void;
  readonly send: (message: DaemonToKiosk) => boolean;
  readonly setSink: (sink: ((message: DaemonToKiosk) => void) | null) => void;
}

export class KioskBridge extends Context.Service<KioskBridge, KioskBridgeApi>()(
  "kazimo/kazimod/KioskBridge",
) {
  static readonly layer = Layer.sync(KioskBridge, () => {
    let activity = emptyActivity();
    let sink: ((message: DaemonToKiosk) => void) | null = null;

    const send = (message: DaemonToKiosk) => {
      if (!sink) return false;
      sink(message);
      return true;
    };

    return KioskBridge.of({
      activity: () => activity,
      setActivity: (next) => {
        activity = next;
      },
      clearActivity: (what) => {
        activity = { ...activity, [what]: [] };
        send({ type: "activity-clear", what });
      },
      send,
      setSink: (next) => {
        sink = next;
      },
    });
  });
}
