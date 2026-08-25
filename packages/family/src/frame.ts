import {
  CONTACT_EVENT_TYPE,
  CONTROL_ADMIN_POWER_LEVEL,
  CONTROL_EVENT_TYPE,
  contactOf,
  contactStateKeyOf,
  FRAME_EVENT_TYPE,
  type FrameContact,
  frameStatusOf,
} from "@kazimo/shared";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { authorizedFetch } from "./http";

type Sdk = typeof import("@unomed/react-native-matrix-sdk");

export type FrameLink = { frameUserId: string; controlRoomId: string };

export type StateEvent = { type: string; stateKey: string; sender: string; content: unknown };

const CREATE_EVENT_TYPE = "m.room.create";
const POWER_LEVELS_EVENT_TYPE = "m.room.power_levels";
const CONTROL_MARKER_STATE_KEY = "";
const REMOVED_CONTACT_CONTENT = {};

const USER_ID = /^@[^\s:]+:[^\s:]+(?::[0-9]{1,5})?$/;
const ROOM_ID = /^![^\s:]+:[^\s:]+(?::[0-9]{1,5})?$/;

let pendingSdk: Promise<Sdk> | null = null;

const sdk = (): Promise<Sdk> => {
  pendingSdk ??= import("@unomed/react-native-matrix-sdk");
  return pendingSdk;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const frameLinkOf = (raw: string | undefined): FrameLink | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;
  const { frameUserId, controlRoomId } = record;
  if (typeof frameUserId !== "string" || typeof controlRoomId !== "string") return null;
  if (!USER_ID.test(frameUserId) || !ROOM_ID.test(controlRoomId)) return null;
  return { frameUserId, controlRoomId };
};

export const stateEventsOf = (payload: unknown): StateEvent[] => {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const type = record.type;
    const stateKey = record.state_key;
    const sender = record.sender;
    if (typeof type !== "string" || typeof stateKey !== "string") return [];
    return [{ type, stateKey, sender: typeof sender === "string" ? sender : "", content: record.content }];
  });
};

export const contactsOf = (payload: unknown): FrameContact[] =>
  stateEventsOf(payload)
    .filter((event) => event.type === CONTACT_EVENT_TYPE)
    .flatMap((event) => {
      const contact = contactOf(event.stateKey, event.content);
      return contact ? [contact] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

export const frameLinkFromState = (roomId: string, payload: unknown, me: string): FrameLink | null => {
  if (!ROOM_ID.test(roomId)) return null;
  const events = stateEventsOf(payload);
  const marked = events.some(
    (event) => event.type === CONTROL_EVENT_TYPE && event.stateKey === CONTROL_MARKER_STATE_KEY,
  );
  if (!marked) return null;
  const creator = events.find((event) => event.type === CREATE_EVENT_TYPE)?.sender;
  if (!creator || creator === me || !USER_ID.test(creator)) return null;
  return { frameUserId: creator, controlRoomId: roomId };
};

const csApiBase = (client: ClientLike): string => client.session().homeserverUrl.replace(/\/+$/, "");

const roomState = async (client: ClientLike, roomId: string): Promise<unknown> => {
  const res = await authorizedFetch(
    client,
    `${csApiBase(client)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`,
  );
  if (!res.ok) throw new Error(`room state ${res.status}`);
  return res.json();
};

const putRoomState = async (
  client: ClientLike,
  roomId: string,
  eventType: string,
  stateKey: string,
  content: unknown,
): Promise<void> => {
  const res = await authorizedFetch(
    client,
    `${csApiBase(client)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    },
  );
  if (!res.ok) throw new Error(`room state write ${res.status}`);
};

const rememberFrame = (client: ClientLike, link: FrameLink): Promise<void> =>
  client.setAccountData(FRAME_EVENT_TYPE, JSON.stringify(link));

const discoverFrame = async (client: ClientLike): Promise<FrameLink | null> => {
  const { Membership } = await sdk();
  const me = client.userId();
  for (const room of client.rooms()) {
    if (room.membership() !== Membership.Joined) continue;
    const info = await room.roomInfo().catch(() => null);
    if (!info || info.isDirect) continue;
    const state = await roomState(client, room.id()).catch(() => null);
    if (state === null) continue;
    const link = frameLinkFromState(room.id(), state, me);
    if (link) return link;
  }
  return null;
};

export const linkFrame = async (client: ClientLike, link: FrameLink): Promise<void> => {
  await rememberFrame(client, link).catch(() => undefined);
};

export const frameLink = async (client: ClientLike): Promise<FrameLink | null> => {
  const stored = frameLinkOf(await client.accountData(FRAME_EVENT_TYPE).catch(() => undefined));
  if (stored) return stored;
  const discovered = await discoverFrame(client);
  if (discovered) await rememberFrame(client, discovered).catch(() => undefined);
  return discovered;
};

export const frameContacts = async (client: ClientLike, controlRoomId: string): Promise<FrameContact[]> =>
  contactsOf(await roomState(client, controlRoomId));

export const setFrameContact = (
  client: ClientLike,
  controlRoomId: string,
  userId: string,
  name: string,
): Promise<void> =>
  putRoomState(client, controlRoomId, CONTACT_EVENT_TYPE, contactStateKeyOf(userId), {
    name: name.trim(),
  });

export const removeFrameContact = (
  client: ClientLike,
  controlRoomId: string,
  userId: string,
): Promise<void> =>
  putRoomState(client, controlRoomId, CONTACT_EVENT_TYPE, contactStateKeyOf(userId), REMOVED_CONTACT_CONTENT);

export const withAdminPower = (content: unknown, userId: string): Record<string, unknown> => {
  const current = asRecord(content) ?? {};
  const users = asRecord(current.users) ?? {};
  return { ...current, users: { ...users, [userId]: CONTROL_ADMIN_POWER_LEVEL } };
};

const inviteUser = async (client: ClientLike, roomId: string, userId: string): Promise<void> => {
  const res = await authorizedFetch(
    client,
    `${csApiBase(client)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    },
  );
  if (!res.ok) throw new Error(`invite ${res.status}`);
};

const roomStateContent = async (
  client: ClientLike,
  roomId: string,
  eventType: string,
  stateKey: string,
): Promise<unknown> => {
  const res = await authorizedFetch(
    client,
    `${csApiBase(client)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(eventType)}/${encodeURIComponent(stateKey)}`,
  );
  if (!res.ok) throw new Error(`room state read ${res.status}`);
  return res.json();
};

export const promoteAdmin = async (
  client: ClientLike,
  controlRoomId: string,
  userId: string,
): Promise<void> => {
  await inviteUser(client, controlRoomId, userId).catch((error) =>
    console.error("control invite failed", error),
  );
  const levels = await roomStateContent(client, controlRoomId, POWER_LEVELS_EVENT_TYPE, "");
  await putRoomState(client, controlRoomId, POWER_LEVELS_EVENT_TYPE, "", withAdminPower(levels, userId));
};

export const adminSignalOf = (payload: unknown): boolean =>
  stateEventsOf(payload).some(
    (event) => event.type === FRAME_EVENT_TYPE && event.stateKey === "" && frameStatusOf(event.content),
  );

const managedElsewhere = async (client: ClientLike): Promise<boolean> => {
  const { Membership } = await sdk();
  for (const room of client.rooms()) {
    if (room.membership() !== Membership.Joined) continue;
    const info = await room.roomInfo().catch(() => null);
    if (!info?.isDirect) continue;
    const state = await roomState(client, room.id()).catch(() => null);
    if (state !== null && adminSignalOf(state)) return true;
  }
  return false;
};

export type FrameAccess = { link: FrameLink | null; adminElsewhere: boolean };

export const frameAccess = async (client: ClientLike): Promise<FrameAccess> => {
  const link = await frameLink(client);
  if (link) return { link, adminElsewhere: false };
  return { link: null, adminElsewhere: await managedElsewhere(client) };
};

export const profileName = async (client: ClientLike, userId: string): Promise<string> => {
  const profile = await client.getProfile(userId).catch(() => null);
  return profile?.displayName ?? "";
};
