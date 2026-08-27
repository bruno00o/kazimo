import type { ClientLike, PowerLevels, RoomLike } from "@unomed/react-native-matrix-sdk";

type Sdk = typeof import("@unomed/react-native-matrix-sdk");

export type DirectRooms = Record<string, string[]>;

export type RoomInvite = {
  roomId: string;
  name: string;
  avatarUrl: string | null;
  inviterId: string;
  inviterName: string;
};

export type FrameScope = { controlRoomId: string | null; frameUserIds: readonly string[] };

const DIRECT_EVENT_TYPE = "m.direct";
const ADMIN_POWER_LEVEL = 100;
const RTC_MEMBER_POWER_LEVEL = 0;
const RTC_MEMBER_EVENT_TYPES = [
  "m.rtc.member",
  "org.matrix.msc3401.call.member",
  "io.element.rtc.member",
] as const;

const USER_ID_PREFIX = "@";
const USER_ID_SEPARATOR = ":";

const LOCALPART = /^[a-zA-Z0-9._=/+-]+$/;
const HOSTNAME_LABEL = "[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?";
const SERVER_NAME = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})*(?::[0-9]{1,5})?$`);
const HOMESERVER_HOST = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?([^/?#]+)/;

let pendingSdk: Promise<Sdk> | null = null;

const sdk = (): Promise<Sdk> => {
  pendingSdk ??= import("@unomed/react-native-matrix-sdk");
  return pendingSdk;
};

const serverName = (raw: string): string | null => {
  const server = raw.trim().toLowerCase();
  return SERVER_NAME.test(server) ? server : null;
};

export const defaultServerFrom = (homeserver: string): string | null => {
  const host = HOMESERVER_HOST.exec(homeserver.trim())?.[1];
  return host ? serverName(host) : null;
};

export const localpartOf = (userId: string): string => {
  const withoutPrefix = userId.startsWith(USER_ID_PREFIX) ? userId.slice(USER_ID_PREFIX.length) : userId;
  const separator = withoutPrefix.indexOf(USER_ID_SEPARATOR);
  return separator === -1 ? withoutPrefix : withoutPrefix.slice(0, separator);
};

export const normalizeMatrixId = (input: string, defaultServer: string): string | null => {
  const trimmed = input.trim();
  const body = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!body || body.includes("@")) return null;
  const separator = body.indexOf(":");
  const localpart = separator === -1 ? body : body.slice(0, separator);
  const server = serverName(separator === -1 ? defaultServer : body.slice(separator + 1));
  if (!server || !LOCALPART.test(localpart)) return null;
  return `@${localpart}:${server}`;
};

export const rtcPowerLevelOverride = (adminUserIds: readonly string[]): PowerLevels => ({
  users: new Map(adminUserIds.map((userId) => [userId, ADMIN_POWER_LEVEL])),
  events: new Map(RTC_MEMBER_EVENT_TYPES.map((eventType) => [eventType, RTC_MEMBER_POWER_LEVEL])),
});

export const directRoomsOf = (raw: string | undefined): DirectRooms => {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed as Record<string, unknown>).flatMap(([userId, rooms]) =>
    Array.isArray(rooms) ? [[userId, rooms.filter((room) => typeof room === "string")] as const] : [],
  );
  return Object.fromEntries(entries);
};

export const withDirectRoom = (current: DirectRooms, userId: string, roomId: string): DirectRooms => {
  const rooms = current[userId] ?? [];
  if (rooms.includes(roomId)) return current;
  return { ...current, [userId]: [...rooms, roomId] };
};

const rememberDirect = async (client: ClientLike, userId: string, roomId: string): Promise<void> => {
  const current = directRoomsOf(await client.accountData(DIRECT_EVENT_TYPE));
  const next = withDirectRoom(current, userId, roomId);
  if (next === current) return;
  await client.setAccountData(DIRECT_EVENT_TYPE, JSON.stringify(next));
};

const DIRECT_MEMBER_LIMIT = 2n;

const scanDirectRoom = async (client: ClientLike, userId: string): Promise<string | null> => {
  const { Membership } = await sdk();
  for (const room of client.rooms()) {
    if (room.membership() !== Membership.Joined) continue;
    const info = await room.roomInfo();
    const withUser = info.heroes.some((hero) => hero.userId === userId);
    if (!withUser) continue;
    if (info.isDirect || info.activeMembersCount <= DIRECT_MEMBER_LIMIT) return room.id();
  }
  return null;
};

export const existingDirectRoom = async (client: ClientLike, userId: string): Promise<string | null> => {
  const room = client.getDmRoom(userId);
  if (room) {
    const { Membership } = await sdk();
    const membership = room.membership();
    if (membership === Membership.Joined || membership === Membership.Invited) return room.id();
  }
  const scanned = await scanDirectRoom(client, userId);
  if (scanned) await rememberDirect(client, userId, scanned).catch(() => undefined);
  return scanned;
};

export const createDirect = async (client: ClientLike, userId: string): Promise<string> => {
  const existing = await existingDirectRoom(client, userId);
  if (existing) return existing;
  const { RoomPreset, RoomVisibility } = await sdk();
  const roomId = await client.createRoom({
    isDirect: true,
    isEncrypted: true,
    visibility: new RoomVisibility.Private(),
    preset: RoomPreset.TrustedPrivateChat,
    invite: [userId],
    powerLevelContentOverride: rtcPowerLevelOverride([client.userId(), userId]),
  });
  await rememberDirect(client, userId, roomId).catch(() => undefined);
  return roomId;
};

export const isFrameInvite = (invite: RoomInvite, scope: FrameScope): boolean =>
  invite.roomId === scope.controlRoomId || scope.frameUserIds.includes(invite.inviterId);

const NO_INVITER = "";

const inviteOf = async (room: RoomLike): Promise<RoomInvite> => {
  const roomId = room.id();
  const info = await room.roomInfo().catch(() => null);
  const inviterId = info?.inviter?.userId ?? NO_INVITER;
  const inviterName = info?.inviter?.displayName ?? localpartOf(inviterId);
  return {
    roomId,
    name: info?.displayName ?? roomId,
    avatarUrl: info?.avatarUrl ?? null,
    inviterId,
    inviterName,
  };
};

export const pendingInvites = async (client: ClientLike, scope: FrameScope): Promise<RoomInvite[]> => {
  const { Membership } = await sdk();
  const invited = client.rooms().filter((room) => room.membership() === Membership.Invited);
  const invites = await Promise.all(invited.map(inviteOf));
  const fromFrame = invites.filter((invite) => isFrameInvite(invite, scope));
  await Promise.all(fromFrame.map((invite) => client.joinRoomById(invite.roomId).catch(() => undefined)));
  return invites.filter((invite) => !isFrameInvite(invite, scope));
};

export const acceptInvite = async (client: ClientLike, roomId: string): Promise<void> => {
  await client.joinRoomById(roomId);
};

export const declineInvite = async (client: ClientLike, roomId: string): Promise<void> => {
  const room = client.getRoom(roomId);
  if (!room) return;
  await room.leave();
};

export const createGroup = async (
  client: ClientLike,
  name: string,
  memberIds: readonly string[],
): Promise<string> => {
  const { RoomPreset, RoomVisibility } = await sdk();
  return client.createRoom({
    name,
    isDirect: false,
    isEncrypted: true,
    visibility: new RoomVisibility.Private(),
    preset: RoomPreset.PrivateChat,
    invite: [...memberIds],
    powerLevelContentOverride: rtcPowerLevelOverride([client.userId()]),
  });
};
