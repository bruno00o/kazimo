import {
  type ClientLike,
  type ImageInfo,
  messageEventContentFromMarkdown,
  ReceiptType,
  type RoomLike,
  type TaskHandleLike,
  type TimelineItemLike,
  type TimelineLike,
  type UploadParameters,
  UploadSource,
} from "@unomed/react-native-matrix-sdk";
import type { PhotoToSend } from "./media";

const DAY_MARKER_ID_PREFIX = "day:";
const DEFAULT_PAGE_SIZE = 40;
const PHOTO_MIME_TYPE = "image/jpeg";

const CONTENT_MSG_LIKE = "MsgLike";
const MSG_LIKE_MESSAGE = "Message";
const MESSAGE_IMAGE = "Image";
const TEXT_MESSAGE_TAGS = new Set(["Text", "Emote", "Notice"]);
const SEND_STATE_NOT_SENT_YET = "NotSentYet";
const SEND_STATE_SENDING_FAILED = "SendingFailed";
const PROFILE_READY = "Ready";

const DIFF_APPEND = "Append";
const DIFF_CLEAR = "Clear";
const DIFF_PUSH_FRONT = "PushFront";
const DIFF_PUSH_BACK = "PushBack";
const DIFF_POP_FRONT = "PopFront";
const DIFF_POP_BACK = "PopBack";
const DIFF_INSERT = "Insert";
const DIFF_SET = "Set";
const DIFF_REMOVE = "Remove";
const DIFF_TRUNCATE = "Truncate";
const DIFF_RESET = "Reset";

const USER_ID_PREFIX = "@";
const USER_ID_SEPARATOR = ":";
const NOTHING_READ: ReadonlySet<string> = new Set<string>();

export type DeliveryState = "pending" | "sent" | "read";

export type SendState = "pending" | "sent" | "failed";

type Ownership = { mine: boolean; delivery: DeliveryState; failed: boolean };

type Identity = { id: string; senderId: string; senderName: string; timestamp: number };

export type ChatItem =
  | ({ kind: "text"; body: string } & Identity & Ownership)
  | ({
      kind: "image";
      mxc: string;
      width: number | null;
      height: number | null;
      blurhash: string | null;
      caption: string | null;
    } & Identity &
      Ownership)
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

export type TimelineEntry = {
  id: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  message: ChatMessage;
  sendState: SendState;
  readByOthers: boolean;
  sourceJson: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const tagOf = (value: unknown): string | null => {
  const tag = asRecord(value)?.tag;
  return typeof tag === "string" ? tag : null;
};

const innerOf = (value: unknown): Record<string, unknown> | null => asRecord(asRecord(value)?.inner);

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const callOf = (value: unknown, method: string): string | null => {
  const holder = asRecord(value);
  const fn = holder?.[method];
  if (typeof fn !== "function") return null;
  try {
    return stringOrNull((fn as () => unknown).call(holder));
  } catch {
    return null;
  }
};

const messageContentOf = (content: unknown): Record<string, unknown> | null => {
  if (tagOf(content) !== CONTENT_MSG_LIKE) return null;
  const msgLike = innerOf(content)?.content;
  const kind = asRecord(msgLike)?.kind;
  if (tagOf(kind) !== MSG_LIKE_MESSAGE) return null;
  return asRecord(innerOf(kind)?.content);
};

const imageContentOf = (content: unknown): Record<string, unknown> | null => {
  const message = messageContentOf(content);
  const msgType = message?.msgType;
  if (tagOf(msgType) !== MESSAGE_IMAGE) return null;
  return asRecord(innerOf(msgType)?.content);
};

const imageMessageOf = (image: Record<string, unknown>): ChatMessage | null => {
  const mxc = callOf(image.source, "url");
  if (mxc === null) return null;
  const info = asRecord(image.info);
  return {
    kind: "image",
    mxc,
    width: numberOrNull(info?.width),
    height: numberOrNull(info?.height),
    blurhash: stringOrNull(info?.blurhash),
    caption: stringOrNull(image.caption),
  };
};

export const bodyOf = (content: unknown): ChatMessage | null => {
  const message = messageContentOf(content);
  if (message === null) return null;
  const tag = tagOf(message.msgType);
  if (tag === null) return null;
  if (TEXT_MESSAGE_TAGS.has(tag)) {
    const body = stringOrNull(message.body);
    return body === null ? null : { kind: "text", body };
  }
  if (tag !== MESSAGE_IMAGE) return null;
  const image = imageContentOf(content);
  return image === null ? null : imageMessageOf(image);
};

export const mediaSourceJsonOf = (content: unknown): string | null => {
  const image = imageContentOf(content);
  return image === null ? null : callOf(image.source, "toJson");
};

export const sendStateOf = (value: unknown): SendState => {
  const tag = tagOf(value);
  if (tag === SEND_STATE_NOT_SENT_YET) return "pending";
  if (tag === SEND_STATE_SENDING_FAILED) return "failed";
  return "sent";
};

export const localpartOf = (userId: string): string => {
  const withoutPrefix = userId.startsWith(USER_ID_PREFIX) ? userId.slice(USER_ID_PREFIX.length) : userId;
  const separator = withoutPrefix.indexOf(USER_ID_SEPARATOR);
  return separator === -1 ? withoutPrefix : withoutPrefix.slice(0, separator);
};

export const senderNameOf = (userId: string, profile: unknown): string => {
  if (tagOf(profile) !== PROFILE_READY) return localpartOf(userId);
  const displayName = stringOrNull(innerOf(profile)?.displayName);
  return displayName === null || displayName.length === 0 ? localpartOf(userId) : displayName;
};

export const receiptUserIdsOf = (receipts: unknown): string[] => {
  if (receipts instanceof Map)
    return [...receipts.keys()].filter((key): key is string => typeof key === "string");
  const record = asRecord(receipts);
  return record === null ? [] : Object.keys(record);
};

export const localDayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

export const readUpTo = (
  itemIds: readonly string[],
  receiptItemIds: readonly string[],
): ReadonlySet<string> => {
  const receipts = new Set(receiptItemIds);
  let lastReadIndex = -1;
  itemIds.forEach((itemId, index) => {
    if (receipts.has(itemId)) lastReadIndex = index;
  });
  return new Set(itemIds.slice(0, lastReadIndex + 1));
};

export const typingNamesOf = (
  userIds: readonly string[],
  myUserId: string,
  nameOf: (userId: string) => string,
): string[] => userIds.filter((userId) => userId !== myUserId).map(nameOf);

export type TimelineDiffLike<Item> = {
  tag: string;
  inner?: { values?: readonly Item[]; value?: Item; index?: number; length?: number };
};

const withoutIndex = <Item>(items: readonly Item[], index: number): Item[] => [
  ...items.slice(0, index),
  ...items.slice(index + 1),
];

const inRange = (index: number | undefined, length: number): index is number =>
  index !== undefined && Number.isInteger(index) && index >= 0 && index < length;

export const applyTimelineDiff = <Item>(items: readonly Item[], diff: TimelineDiffLike<Item>): Item[] => {
  const inner = diff.inner;
  const value = inner?.value;
  switch (diff.tag) {
    case DIFF_APPEND:
      return [...items, ...(inner?.values ?? [])];
    case DIFF_CLEAR:
      return [];
    case DIFF_PUSH_FRONT:
      return value === undefined ? [...items] : [value, ...items];
    case DIFF_PUSH_BACK:
      return value === undefined ? [...items] : [...items, value];
    case DIFF_POP_FRONT:
      return items.slice(1);
    case DIFF_POP_BACK:
      return items.slice(0, Math.max(items.length - 1, 0));
    case DIFF_INSERT: {
      const index = inner?.index;
      if (value === undefined || !inRange(index, items.length + 1)) return [...items];
      return [...items.slice(0, index), value, ...items.slice(index)];
    }
    case DIFF_SET: {
      const index = inner?.index;
      if (value === undefined || !inRange(index, items.length)) return [...items];
      return items.map((current, position) => (position === index ? value : current));
    }
    case DIFF_REMOVE: {
      const index = inner?.index;
      return inRange(index, items.length) ? withoutIndex(items, index) : [...items];
    }
    case DIFF_TRUNCATE: {
      const length = inner?.length;
      return length === undefined || length < 0 ? [...items] : items.slice(0, length);
    }
    case DIFF_RESET:
      return [...(inner?.values ?? [])];
    default:
      return [...items];
  }
};

const deliveryOf = (entry: TimelineEntry, read: ReadonlySet<string>): DeliveryState => {
  if (entry.sendState === "pending") return "pending";
  return read.has(entry.id) ? "read" : "sent";
};

export const chatItemsOf = (
  entries: readonly TimelineEntry[],
  myUserId: string,
  read: ReadonlySet<string> = NOTHING_READ,
): ChatItem[] => {
  const items: ChatItem[] = [];
  const markedDays = new Set<string>();

  for (const entry of entries) {
    const day = localDayKey(entry.timestamp);
    if (!markedDays.has(day)) {
      markedDays.add(day);
      items.push({ kind: "dayMarker", id: `${DAY_MARKER_ID_PREFIX}${day}`, timestamp: entry.timestamp });
    }
    items.push({
      ...entry.message,
      id: entry.id,
      senderId: entry.senderId,
      senderName: entry.senderName,
      timestamp: entry.timestamp,
      mine: entry.senderId === myUserId,
      delivery: deliveryOf(entry, read),
      failed: entry.sendState === "failed",
    });
  }

  return items;
};

export const readSetOf = (entries: readonly TimelineEntry[]): ReadonlySet<string> =>
  readUpTo(
    entries.map((entry) => entry.id),
    entries.filter((entry) => entry.readByOthers).map((entry) => entry.id),
  );

export const imageInfoOf = (photo: PhotoToSend): ImageInfo => ({
  width: BigInt(photo.width),
  height: BigInt(photo.height),
  size: BigInt(photo.size),
  mimetype: PHOTO_MIME_TYPE,
  blurhash: photo.blurhash ?? undefined,
});

export const uploadPathOf = (uri: string): string => uri.replace(/^file:\/\//, "");

export type TimelineSource = {
  items: () => ChatItem[];
  subscribe: (listener: () => void) => () => void;
  subscribeTyping: (listener: (names: string[]) => void) => () => void;
  loadOlder: () => Promise<boolean>;
  send: (body: string) => Promise<void>;
  sendPhoto: (photo: PhotoToSend) => Promise<void>;
  setTyping: (active: boolean) => Promise<void>;
  markLatestRead: () => Promise<void>;
  mediaSourceOf: (mxc: string) => string | null;
  stop: () => void;
};

const entryOf = (item: TimelineItemLike, myUserId: string): TimelineEntry | null => {
  try {
    const event = item.asEvent();
    if (!event) return null;
    const message = bodyOf(event.content);
    if (message === null) return null;
    return {
      id: item.uniqueId().id,
      senderId: event.sender,
      senderName: senderNameOf(event.sender, event.senderProfile),
      timestamp: Number(event.timestamp),
      message,
      sendState: sendStateOf(event.localSendState),
      readByOthers: receiptUserIdsOf(event.readReceipts).some((userId) => userId !== myUserId),
      sourceJson: mediaSourceJsonOf(event.content),
    };
  } catch {
    return null;
  }
};

type ChatMessageItem = Exclude<ChatItem, { kind: "dayMarker" }>;

export const latestMessageOf = (items: readonly ChatItem[]): ChatMessageItem | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && item.kind !== "dayMarker") return item;
  }
  return null;
};

export const openTimeline = async (
  client: ClientLike,
  roomId: string,
  myUserId: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<TimelineSource | null> => {
  const room: RoomLike | undefined = client.getRoom(roomId);
  if (!room) return null;
  const timeline: TimelineLike = await room.timeline();

  const listeners = new Set<() => void>();
  const typingListeners = new Set<(names: string[]) => void>();
  const names = new Map<string, string>();
  const sources = new Map<string, string>();
  let raw: TimelineItemLike[] = [];
  let cached: ChatItem[] = [];
  let acknowledged: string | null = null;

  const nameOf = (userId: string) => names.get(userId) ?? localpartOf(userId);

  const recompute = () => {
    const entries = raw
      .map((item) => entryOf(item, myUserId))
      .filter((entry): entry is TimelineEntry => entry !== null);
    names.clear();
    sources.clear();
    for (const entry of entries) {
      names.set(entry.senderId, entry.senderName);
      if (entry.message.kind === "image" && entry.sourceJson !== null) {
        sources.set(entry.message.mxc, entry.sourceJson);
      }
    }
    cached = chatItemsOf(entries, myUserId, readSetOf(entries));
    for (const listener of listeners) listener();
  };

  const handle: TaskHandleLike = await timeline.addListener({
    onUpdate: (diffs) => {
      for (const diff of diffs) raw = applyTimelineDiff(raw, diff);
      recompute();
    },
  });

  const typingHandle: TaskHandleLike = room.subscribeToTypingNotifications({
    call: (userIds) => {
      const typing = typingNamesOf(userIds, myUserId, nameOf);
      for (const listener of typingListeners) listener(typing);
    },
  });

  await timeline.paginateBackwards(pageSize);

  return {
    items: () => cached,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeTyping(listener) {
      typingListeners.add(listener);
      return () => {
        typingListeners.delete(listener);
      };
    },
    async loadOlder() {
      const hitStart = await timeline.paginateBackwards(pageSize);
      return !hitStart;
    },
    async send(body) {
      await timeline.send(messageEventContentFromMarkdown(body));
    },
    async sendPhoto(photo) {
      const params: UploadParameters = {
        source: new UploadSource.File({ filename: uploadPathOf(photo.uri) }),
      };
      await timeline.sendImage(params, undefined, imageInfoOf(photo)).join();
    },
    async setTyping(active) {
      await room.typingNotice(active);
    },
    async markLatestRead() {
      const latest = latestMessageOf(cached);
      if (!latest || latest.mine || latest.delivery === "pending") return;
      if (acknowledged === latest.id) return;
      acknowledged = latest.id;
      await timeline.markAsRead(ReceiptType.Read);
    },
    mediaSourceOf: (mxc) => sources.get(mxc) ?? null,
    stop() {
      handle.cancel();
      typingHandle.cancel();
      listeners.clear();
      typingListeners.clear();
    },
  };
};
