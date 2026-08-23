import {
  ClientEvent,
  createClient,
  type MatrixClient,
  type MatrixEvent,
  NotificationCountType,
  type Room,
  SyncState,
} from "matrix-js-sdk";

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
};

const GROUP_THRESHOLD = 3;

export const whoami = async (homeserver: string, token: string): Promise<Identity> => {
  const res = await fetch(`${homeserver}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`whoami ${res.status}`);
  const body = (await res.json()) as { user_id: string; device_id?: string };
  return { userId: body.user_id, deviceId: body.device_id ?? "" };
};

export const startSession = async (
  homeserver: string,
  token: string,
  identity: Identity,
): Promise<MatrixClient> => {
  const client = createClient({
    baseUrl: homeserver,
    accessToken: token,
    userId: identity.userId,
    deviceId: identity.deviceId || undefined,
    useAuthorizationHeader: true,
  });
  await client.startClient({ initialSyncLimit: 20 });
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
