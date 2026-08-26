import {
  type ClientLike,
  Membership,
  type RoomInfo,
  type RoomLike,
  type TaskHandleLike,
} from "@unomed/react-native-matrix-sdk";
import {
  callUuid,
  dismiss,
  dismissAll,
  markActive,
  onCallEvent,
  ringIncoming,
  setupCallKeep,
  takeBufferedCallEvents,
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
): Promise<CallCenter> => {
  const me = client.userId();
  const byRoom = new Map<string, string>();
  const byUuid = new Map<string, IncomingCall>();
  const watchers = new Map<string, TaskHandleLike>();
  let answeredRoomId: string | null = null;
  let answeredPushUuid: string | null = null;

  await setupCallKeep(strings);

  const clear = (roomId: string) => {
    const uuid = byRoom.get(roomId);
    if (uuid) byUuid.delete(uuid);
    byRoom.delete(roomId);
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

  const adopt = (info: RoomInfo, pushed: PendingRingCall) => {
    const { name } = callerOf(info);
    const call = { roomId: info.id, title: name === info.id ? pushed.callerName : name };
    byRoom.set(info.id, pushed.uuid);
    byUuid.set(pushed.uuid, call);
    pending?.forget(info.id);
    if (answeredPushUuid !== pushed.uuid) return;
    answeredPushUuid = null;
    answeredRoomId = info.id;
    handlers.onAnswer(call);
  };

  const sync = (info: RoomInfo) => {
    if (info.membership !== Membership.Joined) return;
    const remote = remoteInCall(info);
    const uuid = byRoom.get(info.id);
    if (remote && !uuid) {
      const pushed = pending?.forRoom(info.id) ?? null;
      if (pushed) {
        adopt(info, pushed);
        return;
      }
      const fresh = callUuid();
      const { handle, name } = callerOf(info);
      byRoom.set(info.id, fresh);
      byUuid.set(fresh, { roomId: info.id, title: name });
      ringIncoming(fresh, handle, name, INCOMING_DEFAULT_HAS_VIDEO);
      return;
    }
    if (!remote && uuid) {
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
      if (answeredPushUuid === stale.uuid) answeredPushUuid = null;
      dismiss(stale.uuid);
    }
  };

  const dropDuplicate = (pushed: PendingRingCall) => {
    const known = byRoom.get(pushed.roomId);
    if (!known || known === pushed.uuid) return;
    pending?.forget(pushed.roomId);
    dismiss(pushed.uuid);
  };

  const answered = (uuid: string) => {
    const call = byUuid.get(uuid);
    if (!call) {
      if (!pending?.forUuid(uuid)) return;
      answeredPushUuid = uuid;
      markActive(uuid);
      return;
    }
    answeredRoomId = call.roomId;
    markActive(uuid);
    handlers.onAnswer(call);
  };

  const ended = (uuid: string) => {
    const call = byUuid.get(uuid);
    if (!call) {
      const pushed = pending?.forUuid(uuid);
      if (!pushed) return;
      if (answeredPushUuid === uuid) answeredPushUuid = null;
      pending?.forget(pushed.roomId);
      return;
    }
    const wasAnswered = answeredRoomId === call.roomId;
    clear(call.roomId);
    if (wasAnswered) handlers.onRemoteEnd(call.roomId);
  };

  const offAnswer = onCallEvent("answerCall", answered);
  const offEnd = onCallEvent("endCall", ended);
  const offPush = pending?.watch(dropDuplicate) ?? (() => {});

  scan();
  const scanner = setInterval(scan, ROOM_SCAN_INTERVAL_MS);
  void takeBufferedCallEvents()
    .then((buffered) => {
      for (const { event, uuid } of buffered) (event === "answerCall" ? answered : ended)(uuid);
    })
    .catch(() => {});

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
      offAnswer();
      offEnd();
      offPush();
      dismissAll();
      byRoom.clear();
      byUuid.clear();
      answeredRoomId = null;
      answeredPushUuid = null;
    },
  };
};
