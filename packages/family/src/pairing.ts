import {
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_QR_KIND,
} from "@kazimo/shared";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { createDirect, normalizeMatrixId } from "./rooms";
import type { TimelineSource } from "./timeline";

type Sdk = typeof import("@unomed/react-native-matrix-sdk");

export type PairingTarget = { userId: string; code: string };

export type PairingReply = { kind: "paired"; controlRoomId: string } | { kind: "failed" } | { kind: "none" };

export type PairingStage = "opening" | "sending" | "waiting" | "joining";

export type PairingOutcome = { ok: true; controlRoomId: string } | { ok: false };

const QR_KIND = PAIRING_QR_KIND;
const REQUEST_PREFIX = "kazimo-pair ";
const PAIRED_PREFIX = "kazimo-paired ";
const FAILED_MARKER = "kazimo-pair-failed";

const ROOM_ID = /^![^\s:]+:[^\s:]+(?::[0-9]{1,5})?$/;

const PAIRING_TIMEOUT_MS = 45_000;
const JOIN_ATTEMPTS = 3;
const JOIN_RETRY_DELAY_MS = 1500;

const NO_SERVER = "";
const NOT_PAIRED: PairingOutcome = { ok: false };
const REPLY_NONE: PairingReply = { kind: "none" };
const REPLY_FAILED: PairingReply = { kind: "failed" };

let pendingSdk: Promise<Sdk> | null = null;

const sdk = (): Promise<Sdk> => {
  pendingSdk ??= import("@unomed/react-native-matrix-sdk");
  return pendingSdk;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const isPairingCode = (code: string): boolean =>
  code.length === PAIRING_CODE_LENGTH &&
  code.split("").every((character) => PAIRING_CODE_ALPHABET.includes(character));

export const parsePairingQr = (raw: string): PairingTarget | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record || record.k !== QR_KIND) return null;
  if (typeof record.u !== "string" || typeof record.c !== "string") return null;
  const userId = normalizeMatrixId(record.u, NO_SERVER);
  if (!userId) return null;
  const code = normalizePairingCode(record.c);
  return isPairingCode(code) ? { userId, code } : null;
};

export const parsePairingReply = (body: string): PairingReply => {
  const trimmed = body.trim();
  if (trimmed === FAILED_MARKER || trimmed.startsWith(`${FAILED_MARKER} `)) return REPLY_FAILED;
  if (!trimmed.startsWith(PAIRED_PREFIX)) return REPLY_NONE;
  const controlRoomId = trimmed.slice(PAIRED_PREFIX.length).trim();
  return ROOM_ID.test(controlRoomId) ? { kind: "paired", controlRoomId } : REPLY_NONE;
};

type ReplyWatch = { settled: Promise<string | null>; cancel: () => void };

const watchReply = (source: TimelineSource, frameUserId: string): ReplyWatch => {
  const seen = new Set(source.items().map((item) => item.id));
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finish: (controlRoomId: string | null) => void = () => {};

  const settled = new Promise<string | null>((resolve) => {
    finish = (controlRoomId) => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      resolve(controlRoomId);
    };
  });

  const scan = () => {
    for (const item of source.items()) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.kind !== "text" || item.senderId !== frameUserId) continue;
      const reply = parsePairingReply(item.body);
      if (reply.kind === "paired") {
        finish(reply.controlRoomId);
        return;
      }
      if (reply.kind === "failed") {
        finish(null);
        return;
      }
    }
  };

  timer = setTimeout(() => finish(null), PAIRING_TIMEOUT_MS);
  unsubscribe = source.subscribe(scan);
  scan();

  return { settled, cancel: () => finish(null) };
};

const isJoined = async (client: ClientLike, roomId: string): Promise<boolean> => {
  const room = client.getRoom(roomId);
  if (!room) return false;
  const { Membership } = await sdk();
  return room.membership() === Membership.Joined;
};

const ensureJoined = async (client: ClientLike, roomId: string): Promise<boolean> => {
  for (let attempt = 0; attempt < JOIN_ATTEMPTS; attempt += 1) {
    if (await isJoined(client, roomId).catch(() => false)) return true;
    const joined = await client
      .joinRoomById(roomId)
      .then(() => true)
      .catch(() => false);
    if (joined) return true;
    await delay(JOIN_RETRY_DELAY_MS);
  }
  return isJoined(client, roomId).catch(() => false);
};

const openDirectTimeline = async (
  client: ClientLike,
  frameUserId: string,
): Promise<TimelineSource | null> => {
  try {
    const roomId = await createDirect(client, frameUserId);
    const { openTimeline } = await import("./timeline");
    return await openTimeline(client, roomId, client.userId());
  } catch {
    return null;
  }
};

export const runPairing = async (
  client: ClientLike,
  frameUserId: string,
  code: string,
  onUpdate: (stage: PairingStage) => void = () => {},
): Promise<PairingOutcome> => {
  const normalized = normalizePairingCode(code);
  if (!isPairingCode(normalized)) return NOT_PAIRED;

  onUpdate("opening");
  const source = await openDirectTimeline(client, frameUserId);
  if (!source) return NOT_PAIRED;

  try {
    const watch = watchReply(source, frameUserId);
    onUpdate("sending");
    const sent = await source
      .send(`${REQUEST_PREFIX}${normalized}`)
      .then(() => true)
      .catch(() => false);
    if (!sent) {
      watch.cancel();
      return NOT_PAIRED;
    }
    onUpdate("waiting");
    const controlRoomId = await watch.settled;
    if (controlRoomId === null) return NOT_PAIRED;
    onUpdate("joining");
    return (await ensureJoined(client, controlRoomId)) ? { ok: true, controlRoomId } : NOT_PAIRED;
  } finally {
    source.stop();
  }
};
