import { parseRingPushPayload, ringPushIsLive } from "@kazimo/shared";

export type PendingRingCall = {
  uuid: string;
  roomId: string;
  callerName: string;
  expiresAt: number;
};

export type PendingRingCalls = {
  remember: (payload: unknown, now?: number) => PendingRingCall | null;
  forRoom: (roomId: string, now?: number) => PendingRingCall | null;
  forUuid: (uuid: string, now?: number) => PendingRingCall | null;
  expire: (now?: number) => PendingRingCall[];
  forget: (roomId: string) => void;
  watch: (handler: (call: PendingRingCall) => void) => () => void;
  clear: () => void;
};

export const pendingRingCallOf = (payload: unknown): PendingRingCall | null => {
  const parsed = parseRingPushPayload(payload);
  if (!parsed) return null;
  return {
    uuid: parsed.callId.toUpperCase(),
    roomId: parsed.roomId,
    callerName: parsed.callerName,
    expiresAt: parsed.expiresAt,
  };
};

export const createPendingRingCalls = (): PendingRingCalls => {
  const byRoom = new Map<string, PendingRingCall>();
  const watchers = new Set<(call: PendingRingCall) => void>();

  const live = (call: PendingRingCall, now: number) => ringPushIsLive(call, now);

  const expire = (now = Date.now()): PendingRingCall[] => {
    const dead: PendingRingCall[] = [];
    for (const [roomId, call] of byRoom) {
      if (live(call, now)) continue;
      dead.push(call);
      byRoom.delete(roomId);
    }
    return dead;
  };

  return {
    remember(payload, now = Date.now()) {
      const call = pendingRingCallOf(payload);
      if (!call || !live(call, now)) return null;
      byRoom.set(call.roomId, call);
      for (const watcher of watchers) watcher(call);
      return call;
    },
    forRoom(roomId, now = Date.now()) {
      const call = byRoom.get(roomId);
      if (!call) return null;
      if (live(call, now)) return call;
      byRoom.delete(roomId);
      return null;
    },
    forUuid(uuid, now = Date.now()) {
      for (const call of byRoom.values()) {
        if (call.uuid !== uuid) continue;
        if (live(call, now)) return call;
        byRoom.delete(call.roomId);
        return null;
      }
      return null;
    },
    expire,
    forget(roomId) {
      byRoom.delete(roomId);
    },
    watch(handler) {
      watchers.add(handler);
      return () => {
        watchers.delete(handler);
      };
    },
    clear() {
      byRoom.clear();
    },
  };
};

export const pendingRingCalls = createPendingRingCalls();
