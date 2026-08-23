import { ClientEvent, createClient, type MatrixClient, SyncState } from "matrix-js-sdk";

export type Identity = {
  userId: string;
  deviceId: string;
};

export type RoomSummary = {
  id: string;
  name: string;
  members: number;
};

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

export const roomSummaries = (client: MatrixClient): RoomSummary[] =>
  client
    .getRooms()
    .filter((room) => room.getMyMembership() === "join")
    .map((room) => ({ id: room.roomId, name: room.name, members: room.getJoinedMemberCount() }))
    .sort((a, b) => a.name.localeCompare(b.name));
