import {
  ClientEvent,
  createClient,
  type MatrixClient,
  type MatrixEvent,
  NotificationCountType,
  PushRuleActionName,
  type Room,
  SyncState,
  type TokenRefreshFunction,
} from "matrix-js-sdk";
import { createSqliteStore, databaseNameForUser } from "./store";

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

const GROUP_THRESHOLD = 3;
const INITIAL_SYNC_LIMIT = 20;
const PUSH_RULE_SCOPE = "global";

export const whoami = async (homeserver: string, token: string): Promise<Identity> => {
  const res = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`whoami ${res.status}`);
  const body = (await res.json()) as { user_id: string; device_id?: string };
  return { userId: body.user_id, deviceId: body.device_id ?? "" };
};

export type SessionRefresh = {
  refreshToken: string;
  tokenRefreshFunction: TokenRefreshFunction;
};

export const startSession = async (
  homeserver: string,
  token: string,
  identity: Identity,
  refresh?: SessionRefresh,
): Promise<MatrixClient> => {
  const store = createSqliteStore({ dbName: databaseNameForUser(identity.userId) });
  const client = createClient({
    baseUrl: homeserver,
    accessToken: token,
    userId: identity.userId,
    deviceId: identity.deviceId || undefined,
    useAuthorizationHeader: true,
    store,
    refreshToken: refresh?.refreshToken,
    tokenRefreshFunction: refresh?.tokenRefreshFunction,
  });
  await store.startup();
  await client.startClient({ initialSyncLimit: INITIAL_SYNC_LIMIT });
  await new Promise<void>((resolve, reject) => {
    const onSync = (state: SyncState) => {
      if (state === SyncState.Prepared) {
        client.off(ClientEvent.Sync, onSync);
        resolve();
      } else if (state === SyncState.Error) {
        client.off(ClientEvent.Sync, onSync);
        reject(new Error("sync error"));
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });
  await acceptInvites(client);
  return client;
};

const acceptInvites = async (client: MatrixClient): Promise<void> => {
  const invited = client.getRooms().filter((room) => room.getMyMembership() === "invite");
  await Promise.all(invited.map((room) => client.joinRoom(room.roomId).catch(() => undefined)));
};

const previewOf = (event: MatrixEvent | undefined): Conversation["preview"] => {
  if (event?.getType() !== "m.room.message" || event.isRedacted()) return null;
  const content = event.getContent();
  if (content.msgtype === "m.image") return { kind: "photo" };
  if (typeof content.body === "string") return { kind: "text", body: content.body };
  return null;
};

const lastMessage = (room: Room): MatrixEvent | undefined =>
  [...room.getLiveTimeline().getEvents()].reverse().find((event) => event.getType() === "m.room.message");

const isMuted = (room: Room): boolean => {
  if (!room.client.pushRules) return false;
  const rule = room.client.getRoomPushRule(PUSH_RULE_SCOPE, room.roomId);
  return rule?.actions.includes(PushRuleActionName.DontNotify) ?? false;
};

export const setRoomMuted = async (client: MatrixClient, roomId: string, muted: boolean): Promise<void> => {
  await client.setRoomMutePushRule(PUSH_RULE_SCOPE, roomId, muted);
};

export const markRead = async (client: MatrixClient, roomId: string): Promise<void> => {
  const room = client.getRoom(roomId);
  const event = room ? lastMessage(room) : undefined;
  if (!event || event.status !== null) return;
  await client.sendReadReceipt(event);
};

export const conversationOf = (room: Room, myUserId: string): Conversation => {
  const members = room.getJoinedMembers();
  const others = members.filter((member) => member.userId !== myUserId);
  const isPerson = members.length < GROUP_THRESHOLD && others.length === 1;
  const other = isPerson ? others[0] : undefined;
  return {
    id: room.roomId,
    name: other?.name ?? room.name,
    kind: isPerson ? "person" : "group",
    otherUserId: other?.userId ?? null,
    preview: previewOf(lastMessage(room)),
    lastActive: room.getLastActiveTimestamp(),
    unread: room.getUnreadNotificationCount(NotificationCountType.Total),
    muted: isMuted(room),
    encrypted: room.hasEncryptionStateEvent(),
  };
};

export const conversations = (client: MatrixClient): Conversation[] => {
  const me = client.getUserId() ?? "";
  return client
    .getRooms()
    .filter((room) => room.getMyMembership() === "join")
    .map((room) => conversationOf(room, me))
    .sort((a, b) => b.lastActive - a.lastActive);
};

export const endSession = async (client: MatrixClient): Promise<void> => {
  client.stopClient();
  await client.store.deleteAllData();
  await client.store.destroy();
};
