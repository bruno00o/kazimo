import type { ActivitySummary, Contact, DaemonToKiosk, KioskReply, RingDevices } from "@kazimo/shared";
import { Context, Layer } from "effect";

const REQUEST_TIMEOUT_MS = 3000;

const emptyActivity = (): ActivitySummary => ({ unread: [], missed: [], ringing: null });

export interface KioskBridgeApi {
  readonly activity: () => ActivitySummary;
  readonly setActivity: (activity: ActivitySummary) => void;
  readonly clearActivity: (what: "unread" | "missed") => void;
  readonly contacts: () => Contact[];
  readonly setContacts: (contacts: Contact[]) => void;
  readonly ringDevices: () => RingDevices;
  readonly setRingDevices: (devices: RingDevices) => void;
  readonly send: (message: DaemonToKiosk) => boolean;
  readonly request: (build: (id: number) => DaemonToKiosk, timeoutMs?: number) => Promise<KioskReply | null>;
  readonly resolveRequest: (reply: KioskReply) => void;
  readonly setSink: (sink: ((message: DaemonToKiosk) => void) | null) => void;
}

export class KioskBridge extends Context.Service<KioskBridge, KioskBridgeApi>()(
  "kazimo/kazimod/KioskBridge",
) {
  static readonly layer = Layer.sync(KioskBridge, () => {
    let activity = emptyActivity();
    let contacts: Contact[] = [];
    let ringDevices: RingDevices = {};
    let sink: ((message: DaemonToKiosk) => void) | null = null;
    let nextRequestId = 1;
    const pending = new Map<
      number,
      { resolve: (reply: KioskReply | null) => void; timer: ReturnType<typeof setTimeout> }
    >();

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
      contacts: () => contacts,
      setContacts: (next) => {
        contacts = next;
      },
      ringDevices: () => ringDevices,
      setRingDevices: (next) => {
        ringDevices = next;
      },
      send,
      request: (build, timeoutMs = REQUEST_TIMEOUT_MS) =>
        new Promise((resolve) => {
          const id = nextRequestId++;
          if (!send(build(id))) return resolve(null);
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve(null);
          }, timeoutMs);
          pending.set(id, { resolve, timer });
        }),
      resolveRequest: (reply) => {
        const entry = pending.get(reply.id);
        if (!entry) return;
        pending.delete(reply.id);
        clearTimeout(entry.timer);
        entry.resolve(reply);
      },
      setSink: (next) => {
        sink = next;
      },
    });
  });
}
