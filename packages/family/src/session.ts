import type { ClientLike, EventTimelineItem, RoomInfo, RoomLike } from "@unomed/react-native-matrix-sdk";
import type { MatrixHandle } from "./matrix";

export type Identity = {
  userId: string;
  deviceId: string;
};

export type Conversation = {
  id: string;
  name: string;
  kind: "person" | "group";
  otherUserId: string | null;
  preview: { kind: "text"; body: string } | { kind: "photo" } | null;
  lastActive: number;
  unread: number;
  muted: boolean;
  encrypted: boolean;
};

type Sdk = typeof import("@unomed/react-native-matrix-sdk");

const GROUP_THRESHOLD = 3n;

let pendingSdk: Promise<Sdk> | null = null;

const sdk = (): Promise<Sdk> => {
  pendingSdk ??= import("@unomed/react-native-matrix-sdk");
  return pendingSdk;
};

export const whoami = async (homeserver: string, token: string): Promise<Identity> => {
  const res = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`whoami ${res.status}`);
  const body = (await res.json()) as { user_id: string; device_id?: string };
  return { userId: body.user_id, deviceId: body.device_id ?? "" };
};

export const acceptInvites = async (client: ClientLike): Promise<void> => {
  const { Membership } = await sdk();
  const invited = client.rooms().filter((room) => room.membership() === Membership.Invited);
  await Promise.all(invited.map((room) => client.joinRoomById(room.id()).catch(() => undefined)));
};

export const endSession = (handle: MatrixHandle): Promise<void> => handle.stop();

const previewOf = (module: Sdk, item: EventTimelineItem | undefined): Conversation["preview"] => {
  const content = item?.content;
  if (!content || content.tag !== module.TimelineItemContent_Tags.MsgLike) return null;
  const kind = content.inner.content.kind;
  if (kind.tag !== module.MsgLikeKind_Tags.Message) return null;
  const message = kind.inner.content;
  if (message.msgType.tag === module.MessageType_Tags.Image) return { kind: "photo" };
  return { kind: "text", body: message.body };
};

const conversationOf = (
  module: Sdk,
  info: RoomInfo,
  latest: EventTimelineItem | undefined,
  me: string,
): Conversation => {
  const others = info.heroes.filter((hero) => hero.userId !== me);
  const isPerson = info.activeMembersCount < GROUP_THRESHOLD;
  const other = isPerson ? others[0] : undefined;
  return {
    id: info.id,
    name: other?.displayName ?? info.displayName ?? info.id,
    kind: isPerson ? "person" : "group",
    otherUserId: other?.userId ?? null,
    preview: previewOf(module, latest),
    lastActive: latest ? Number(latest.timestamp) : 0,
    unread: Number(info.numUnreadNotifications),
    muted: info.cachedUserDefinedNotificationMode === module.RoomNotificationMode.Mute,
    encrypted: info.encryptionState === module.EncryptionState.Encrypted,
  };
};

const describe = async (module: Sdk, room: RoomLike, me: string): Promise<Conversation> => {
  const [info, latest] = await Promise.all([room.roomInfo(), room.latestEvent().catch(() => undefined)]);
  return conversationOf(module, info, latest, me);
};

export const conversations = async (client: ClientLike): Promise<Conversation[]> => {
  const module = await sdk();
  const me = client.userId();
  const joined = client.rooms().filter((room) => room.membership() === module.Membership.Joined);
  const list = await Promise.all(joined.map((room) => describe(module, room, me)));
  return list.sort((a, b) => b.lastActive - a.lastActive);
};

export const conversationFor = async (client: ClientLike, roomId: string): Promise<Conversation | null> => {
  const room = client.getRoom(roomId);
  if (!room) return null;
  return describe(await sdk(), room, client.userId());
};

export const markRead = async (client: ClientLike, roomId: string): Promise<void> => {
  const room = client.getRoom(roomId);
  if (!room) return;
  const { ReceiptType } = await sdk();
  await room.markAsRead(ReceiptType.Read);
};

export const setRoomMuted = async (client: ClientLike, roomId: string, muted: boolean): Promise<void> => {
  const settings = await client.getNotificationSettings();
  if (!muted) {
    await settings.restoreDefaultRoomNotificationMode(roomId);
    return;
  }
  const { RoomNotificationMode } = await sdk();
  await settings.setRoomNotificationMode(roomId, RoomNotificationMode.Mute);
};

export const leaveConversation = async (client: ClientLike, roomId: string): Promise<void> => {
  await client.getRoom(roomId)?.leave();
};
