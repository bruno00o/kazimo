import {
  type ClientLike,
  Membership,
  type RoomInfo,
  type RoomLike,
  type TaskHandleLike,
} from "@unomed/react-native-matrix-sdk";
import {
  type CallEvents,
  callUuid,
  dismiss,
  dismissAll,
  markActive,
  ringIncoming,
  setupCallKeep,
  callEvents as sharedCallEvents,
} from "./callkeep";
import type { Strings } from "./i18n";
import type { PendingRingCall, PendingRingCalls } from "./pending-calls";

const INCOMING_DEFAULT_HAS_VIDEO = true;
const ROOM_SCAN_INTERVAL_MS = 5000;

export type IncomingCall = { roomId: string; title: string };

export type CallCenter = {
  hangup: (roomId: string) => void;
  stop: () => void;
};

export const startCallCenter = async (
  client: ClientLike,
  handlers: { onAnswer: (call: IncomingCall) => void; onRemoteEnd: (roomId: string) => void },
  strings: Strings,
  pending: PendingRingCalls | null = null,
  events: CallEvents = sharedCallEvents,
): Promise<CallCenter> => {
  const me = client.userId();
  const byRoom = new Map<string, string>();
  const byUuid = new Map<string, IncomingCall>();
  const watchers = new Map<string, TaskHandleLike>();
  const seenRemote = new Set<string>();
  let answeredRoomId: string | null = null;

  await setupCallKeep(strings);

  const clear = (roomId: string) => {
    const uuid = byRoom.get(roomId);
    if (uuid) byUuid.delete(uuid);
    byRoom.delete(roomId);
    seenRemote.delete(roomId);
    pending?.forget(roomId);
    if (answeredRoomId === roomId) answeredRoomId = null;
  };

  const remoteInCall = (info: RoomInfo): boolean =>
    info.hasRoomCall &&
    !info.activeRoomCallParticipants.includes(me) &&
    info.activeRoomCallParticipants.some((participant) => participant !== me);

  const callerOf = (info: RoomInfo): { handle: string; name: string } => {
    const other = info.heroes.find((hero) => hero.userId !== me);
    return {
      handle: other?.userId ?? info.id,
      name: other?.displayName ?? info.displayName ?? info.id,
    };
  };

  const register = (roomId: string, uuid: string, title: string): IncomingCall => {
    const call = { roomId, title };
    byRoom.set(roomId, uuid);
    byUuid.set(uuid, call);
    pending?.forget(roomId);
    return call;
  };

  const adopt = (info: RoomInfo, pushed: PendingRingCall) => {
    const { name } = callerOf(info);
    register(info.id, pushed.uuid, name === info.id ? pushed.callerName : name);
  };

  const sync = (info: RoomInfo) => {
    if (info.membership !== Membership.Joined) return;
    const remote = remoteInCall(info);
    const uuid = byRoom.get(info.id);
    if (remote) seenRemote.add(info.id);
    if (remote && !uuid) {
      const pushed = pending?.forRoom(info.id) ?? null;
      if (pushed) {
        adopt(info, pushed);
        return;
      }
      const fresh = callUuid();
      const { handle, name } = callerOf(info);
      register(info.id, fresh, name);
      ringIncoming(fresh, handle, name, INCOMING_DEFAULT_HAS_VIDEO);
      return;
    }
    if (!remote && uuid && seenRemote.has(info.id)) {
      dismiss(uuid);
      const wasAnswered = answeredRoomId === info.id;
      clear(info.id);
      if (wasAnswered) handlers.onRemoteEnd(info.id);
    }
  };

  const watch = (room: RoomLike) => {
    if (watchers.has(room.id())) return;
    watchers.set(room.id(), room.subscribeToRoomInfoUpdates({ call: sync }));
    void room
      .roomInfo()
      .then(sync)
      .catch(() => {});
  };

  const scan = () => {
    for (const room of client.rooms()) watch(room);
    for (const stale of pending?.expire() ?? []) {
      if (byRoom.get(stale.roomId) === stale.uuid) continue;
      dismiss(stale.uuid);
    }
  };

  const dropDuplicate = (pushed: PendingRingCall) => {
    const known = byRoom.get(pushed.roomId);
    if (!known || known === pushed.uuid) return;
    pending?.forget(pushed.roomId);
    dismiss(pushed.uuid);
  };

  const fromPush = (uuid: string): IncomingCall | null => {
    const pushed = pending?.forUuid(uuid);
    return pushed ? register(pushed.roomId, uuid, pushed.callerName) : null;
  };

  const answered = (uuid: string) => {
    const call = byUuid.get(uuid) ?? fromPush(uuid);
    if (!call) return;
    if (answeredRoomId === call.roomId) return;
    answeredRoomId = call.roomId;
    markActive(uuid);
    handlers.onAnswer(call);
  };

  const ended = (uuid: string) => {
    const call = byUuid.get(uuid);
    if (!call) {
      const pushed = pending?.forUuid(uuid);
      if (!pushed) return;
      pending?.forget(pushed.roomId);
      return;
    }
    const wasAnswered = answeredRoomId === call.roomId;
    clear(call.roomId);
    if (wasAnswered) handlers.onRemoteEnd(call.roomId);
  };

  const offPush = pending?.watch(dropDuplicate) ?? (() => {});

  scan();
  const scanner = setInterval(scan, ROOM_SCAN_INTERVAL_MS);
  const offEvents = events.take(({ event, uuid }) => (event === "answerCall" ? answered : ended)(uuid));

  return {
    hangup(roomId) {
      const uuid = byRoom.get(roomId);
      if (uuid) dismiss(uuid);
      clear(roomId);
    },
    stop() {
      clearInterval(scanner);
      for (const watcher of watchers.values()) watcher.cancel();
      watchers.clear();
      offEvents();
      offPush();
      dismissAll();
      byRoom.clear();
      byUuid.clear();
      seenRemote.clear();
      answeredRoomId = null;
    },
  };
};
