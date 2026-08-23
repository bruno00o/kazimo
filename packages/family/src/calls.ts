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
} from "./callkeep";
import type { Strings } from "./i18n";

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
): Promise<CallCenter> => {
  const me = client.userId();
  const byRoom = new Map<string, string>();
  const byUuid = new Map<string, IncomingCall>();
  const watchers = new Map<string, TaskHandleLike>();
  let answeredRoomId: string | null = null;

  await setupCallKeep(strings);

  const clear = (roomId: string) => {
    const uuid = byRoom.get(roomId);
    if (uuid) byUuid.delete(uuid);
    byRoom.delete(roomId);
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

  const sync = (info: RoomInfo) => {
    if (info.membership !== Membership.Joined) return;
    const remote = remoteInCall(info);
    const uuid = byRoom.get(info.id);
    if (remote && !uuid) {
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
  };

  const offAnswer = onCallEvent("answerCall", (uuid) => {
    const call = byUuid.get(uuid);
    if (!call) return;
    answeredRoomId = call.roomId;
    markActive(uuid);
    handlers.onAnswer(call);
  });

  const offEnd = onCallEvent("endCall", (uuid) => {
    const call = byUuid.get(uuid);
    if (!call) return;
    const wasAnswered = answeredRoomId === call.roomId;
    clear(call.roomId);
    if (wasAnswered) handlers.onRemoteEnd(call.roomId);
  });

  scan();
  const scanner = setInterval(scan, ROOM_SCAN_INTERVAL_MS);

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
      dismissAll();
      byRoom.clear();
      byUuid.clear();
      answeredRoomId = null;
    },
  };
};
