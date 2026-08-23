import {
  EventStatus,
  EventTimeline,
  EventType,
  type IContent,
  type ISendEventResponse,
  type MatrixClient,
  type MatrixEvent,
  MsgType,
  RelationType,
  type Room,
  RoomEvent,
  TimelineWindow,
} from "matrix-js-sdk";

const BLURHASH_KEY = "xyz.amorgan.blurhash";
const DAY_MARKER_ID_PREFIX = "day:";
const DEFAULT_PAGE_SIZE = 40;
const TEXT_MSGTYPES = new Set<string>([MsgType.Text, MsgType.Emote, MsgType.Notice]);
const PENDING_STATUSES = new Set<EventStatus>([
  EventStatus.SENDING,
  EventStatus.QUEUED,
  EventStatus.ENCRYPTING,
]);

type Delivery = { mine: boolean; pending: boolean; failed: boolean };

type Identity = { id: string; senderId: string; senderName: string; timestamp: number };

export type ChatItem =
  | ({ kind: "text"; body: string } & Identity & Delivery)
  | ({
      kind: "image";
      mxc: string;
      width: number | null;
      height: number | null;
      blurhash: string | null;
      caption: string | null;
    } & Identity &
      Delivery)
  | { kind: "dayMarker"; id: string; timestamp: number };

export type ChatMessage =
  | { kind: "text"; body: string }
  | {
      kind: "image";
      mxc: string;
      width: number | null;
      height: number | null;
      blurhash: string | null;
      caption: string | null;
    };

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

const effectiveContent = (event: MatrixEvent): IContent => {
  const replacement = event.replacingEvent();
  if (!replacement) return event.getContent();
  const replaced = replacement.getContent()["m.new_content"];
  return replaced ?? event.getContent();
};

const imageOf = (content: IContent): ChatMessage | null => {
  const mxc = stringOrNull(content.url);
  if (!mxc) return null;
  const info = content.info ?? {};
  const body = stringOrNull(content.body);
  const filename = stringOrNull(content.filename);
  return {
    kind: "image",
    mxc,
    width: numberOrNull(info.w),
    height: numberOrNull(info.h),
    blurhash: stringOrNull(info[BLURHASH_KEY]),
    caption: filename !== null && body !== null && filename !== body ? body : null,
  };
};

export const messageOf = (event: MatrixEvent): ChatMessage | null => {
  if (event.getType() !== EventType.RoomMessage) return null;
  if (event.isRedacted()) return null;
  if (event.isRelation(RelationType.Replace) || event.isRelation(RelationType.Annotation)) return null;

  const content = effectiveContent(event);
  const msgtype = content.msgtype;
  if (typeof msgtype !== "string") return null;

  if (TEXT_MSGTYPES.has(msgtype)) {
    const body = stringOrNull(content.body);
    return body === null ? null : { kind: "text", body };
  }
  if (msgtype === MsgType.Image) return imageOf(content);
  return null;
};

export const localDayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const deliveryOf = (event: MatrixEvent, myUserId: string, senderId: string): Delivery => ({
  mine: senderId === myUserId,
  pending: event.status !== null && PENDING_STATUSES.has(event.status),
  failed: event.status === EventStatus.NOT_SENT,
});

export const toChatItems = (
  events: MatrixEvent[],
  myUserId: string,
  senderName: (userId: string) => string,
): ChatItem[] => {
  const items: ChatItem[] = [];
  let currentDay: string | null = null;

  for (const event of [...events].sort((left, right) => left.getTs() - right.getTs())) {
    const message = messageOf(event);
    const id = event.getId();
    const senderId = event.getSender();
    if (!message || !id || !senderId) continue;

    const timestamp = event.getTs();
    const day = localDayKey(timestamp);
    if (day !== currentDay) {
      items.push({ kind: "dayMarker", id: `${DAY_MARKER_ID_PREFIX}${day}`, timestamp });
      currentDay = day;
    }

    items.push({
      ...message,
      ...deliveryOf(event, myUserId, senderId),
      id,
      senderId,
      senderName: senderName(senderId),
      timestamp,
    });
  }

  return items;
};

export type TimelineSource = {
  items: () => ChatItem[];
  subscribe: (listener: () => void) => () => void;
  loadOlder: () => Promise<boolean>;
  stop: () => void;
};

export const openTimeline = async (
  client: MatrixClient,
  room: Room,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<TimelineSource> => {
  const myUserId = client.getUserId() ?? "";
  const senderName = (userId: string) => room.getMember(userId)?.name ?? userId;
  const listeners = new Set<() => void>();

  let window = new TimelineWindow(client, room.getUnfilteredTimelineSet());
  await window.load(undefined, pageSize);
  let cached = toChatItems(window.getEvents(), myUserId, senderName);

  const recompute = () => {
    cached = toChatItems(window.getEvents(), myUserId, senderName);
    for (const listener of listeners) listener();
  };

  const followLive = async () => {
    await window.paginate(EventTimeline.FORWARDS, pageSize, false);
    recompute();
  };

  const reload = async () => {
    window = new TimelineWindow(client, room.getUnfilteredTimelineSet());
    await window.load(undefined, pageSize);
    recompute();
  };

  const onTimeline = (
    _event: MatrixEvent,
    eventRoom: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    _removed: boolean,
    data: { liveEvent?: boolean },
  ) => {
    if (eventRoom?.roomId !== room.roomId) return;
    if (toStartOfTimeline || !data.liveEvent) return;
    void followLive();
  };

  const onTimelineReset = (resetRoom: Room | undefined) => {
    if (resetRoom && resetRoom.roomId !== room.roomId) return;
    void reload();
  };

  const onRedaction = (_event: MatrixEvent, redactedRoom: Room) => {
    if (redactedRoom.roomId !== room.roomId) return;
    recompute();
  };

  const onLocalEchoUpdated = (_event: MatrixEvent, echoRoom: Room) => {
    if (echoRoom.roomId !== room.roomId) return;
    void followLive();
  };

  room.on(RoomEvent.Timeline, onTimeline);
  room.on(RoomEvent.TimelineReset, onTimelineReset);
  room.on(RoomEvent.Redaction, onRedaction);
  room.on(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);

  return {
    items: () => cached,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async loadOlder() {
      await window.paginate(EventTimeline.BACKWARDS, pageSize);
      recompute();
      return window.canPaginate(EventTimeline.BACKWARDS);
    },
    stop() {
      room.off(RoomEvent.Timeline, onTimeline);
      room.off(RoomEvent.TimelineReset, onTimelineReset);
      room.off(RoomEvent.Redaction, onRedaction);
      room.off(RoomEvent.LocalEchoUpdated, onLocalEchoUpdated);
      listeners.clear();
    },
  };
};

export const sendText = (client: MatrixClient, roomId: string, body: string): Promise<ISendEventResponse> =>
  client.sendTextMessage(roomId, body);
