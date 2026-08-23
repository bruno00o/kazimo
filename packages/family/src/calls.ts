import { type MatrixClient, type MatrixEvent, type Room, RoomStateEvent } from "matrix-js-sdk";
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

const RTC_MEMBER_TYPES = new Set(["org.matrix.msc3401.call.member", "m.rtc.member", "io.element.rtc.member"]);

const INCOMING_DEFAULT_HAS_VIDEO = true;

export type IncomingCall = { roomId: string; title: string };

export type CallCenter = {
  hangup: (roomId: string) => void;
  stop: () => void;
};

export const startCallCenter = async (
  client: MatrixClient,
  handlers: { onAnswer: (call: IncomingCall) => void; onRemoteEnd: (roomId: string) => void },
  strings: Strings,
): Promise<CallCenter> => {
  const me = client.getUserId() ?? "";
  const byRoom = new Map<string, string>();
  const byUuid = new Map<string, IncomingCall>();
  let answeredRoomId: string | null = null;

  await setupCallKeep(strings);

  const clear = (roomId: string) => {
    const uuid = byRoom.get(roomId);
    if (uuid) byUuid.delete(uuid);
    byRoom.delete(roomId);
    if (answeredRoomId === roomId) answeredRoomId = null;
  };

  const remoteInCall = (room: Room): boolean => {
    for (const type of RTC_MEMBER_TYPES) {
      for (const event of room.currentState.getStateEvents(type)) {
        const sender = event.getSender();
        if (sender && sender !== me && Object.keys(event.getContent()).length > 0) return true;
      }
    }
    return false;
  };

  const callerOf = (room: Room): { handle: string; name: string } => {
    const other = room.getJoinedMembers().find((member) => member.userId !== me);
    return { handle: other?.userId ?? room.roomId, name: room.name };
  };

  const sync = (room: Room) => {
    if (room.getMyMembership() !== "join") return;
    const remote = remoteInCall(room);
    const uuid = byRoom.get(room.roomId);
    if (remote && !uuid) {
      const fresh = callUuid();
      const { handle, name } = callerOf(room);
      byRoom.set(room.roomId, fresh);
      byUuid.set(fresh, { roomId: room.roomId, title: name });
      ringIncoming(fresh, handle, name, INCOMING_DEFAULT_HAS_VIDEO);
      return;
    }
    if (!remote && uuid) {
      dismiss(uuid);
      const wasAnswered = answeredRoomId === room.roomId;
      clear(room.roomId);
      if (wasAnswered) handlers.onRemoteEnd(room.roomId);
    }
  };

  const onState = (event: MatrixEvent) => {
    if (!RTC_MEMBER_TYPES.has(event.getType())) return;
    const roomId = event.getRoomId();
    const room = roomId ? client.getRoom(roomId) : null;
    if (room) sync(room);
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

  client.on(RoomStateEvent.Events, onState);
  for (const room of client.getRooms()) sync(room);

  return {
    hangup(roomId) {
      const uuid = byRoom.get(roomId);
      if (uuid) dismiss(uuid);
      clear(roomId);
    },
    stop() {
      client.off(RoomStateEvent.Events, onState);
      offAnswer();
      offEnd();
      dismissAll();
      byRoom.clear();
      byUuid.clear();
      answeredRoomId = null;
    },
  };
};
