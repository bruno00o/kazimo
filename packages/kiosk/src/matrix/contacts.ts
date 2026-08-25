import {
  CONTACT_EVENT_TYPE,
  CONTROL_ADMIN_POWER_LEVEL,
  contactOf,
  contactUserIdOf,
  type FrameContact,
  frameStatusOf,
} from "@kazimo/shared";

export interface ContactStateEntry {
  stateKey: string;
  content: unknown;
}

export interface RoomView {
  roomId: string;
  isControl: boolean;
  memberIds: readonly string[];
}

export type PowerLevelsContent = Record<string, unknown>;

const DIRECT_MEMBER_COUNT = 2;

export const desiredContacts = (entries: readonly ContactStateEntry[]): Map<string, FrameContact> => {
  const desired = new Map<string, FrameContact>();
  for (const entry of entries) {
    const contact = contactOf(entry.stateKey, entry.content);
    if (contact) desired.set(contact.userId, contact);
  }
  return desired;
};

export const removedContacts = (entries: readonly ContactStateEntry[]): Set<string> => {
  const removed = new Set<string>();
  for (const entry of entries) {
    const userId = contactUserIdOf(entry.stateKey);
    if (!userId) continue;
    if (contactOf(entry.stateKey, entry.content)) continue;
    removed.add(userId);
  }
  return removed;
};

export const directRoomsByPeer = (rooms: readonly RoomView[], selfId: string): Map<string, string> => {
  const byPeer = new Map<string, string>();
  for (const room of rooms) {
    if (room.isControl || room.memberIds.length !== DIRECT_MEMBER_COUNT) continue;
    const peer = room.memberIds.find((memberId) => memberId !== selfId);
    if (!peer || byPeer.has(peer)) continue;
    byPeer.set(peer, room.roomId);
  }
  return byPeer;
};

export const contactsToProvision = (
  desired: ReadonlyMap<string, FrameContact>,
  existing: ReadonlyMap<string, string>,
): FrameContact[] => [...desired.values()].filter((contact) => !existing.has(contact.userId));

export const repairedPowerLevels = (content: unknown): PowerLevelsContent | null => {
  const current: PowerLevelsContent =
    typeof content === "object" && content !== null ? (content as PowerLevelsContent) : {};
  const currentEvents = current.events;
  const events: Record<string, unknown> =
    typeof currentEvents === "object" && currentEvents !== null
      ? (currentEvents as Record<string, unknown>)
      : {};
  if (typeof events[CONTACT_EVENT_TYPE] === "number") return null;
  return { ...current, events: { ...events, [CONTACT_EVENT_TYPE]: CONTROL_ADMIN_POWER_LEVEL } };
};

export const adminPresent = (memberIds: readonly string[], selfId: string): boolean =>
  memberIds.some((memberId) => memberId !== selfId);

export const statusNeedsUpdate = (content: unknown, hasAdmin: boolean): boolean =>
  frameStatusOf(content) !== hasAdmin;

export const displayNameOf = (
  desired: ReadonlyMap<string, FrameContact>,
  userId: string,
  fallback: string,
): string => desired.get(userId)?.name ?? fallback;
