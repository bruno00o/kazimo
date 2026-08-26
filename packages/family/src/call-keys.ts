export const KEY_EVENT_TYPE = "io.element.call.encryption_keys";

export const RECEIVE_KEYS_CAPABILITY = `org.matrix.msc3819.receive.to_device:${KEY_EVENT_TYPE}`;
export const SEND_KEYS_CAPABILITY = `org.matrix.msc3819.send.to_device:${KEY_EVENT_TYPE}`;

export const RTC_APPLICATION = "m.call";
export const RTC_CALL_ID = "";
export const RTC_SCOPE = "m.room";

export const OWN_KEY_INDEX = 0;
export const OWN_KEY_LENGTH = 16;

const KEY_INDEX_LIMIT = 256;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const encodeBase64 = (bytes: Uint8Array): string => {
  let out = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] as number;
    const second = offset + 1 < bytes.length ? (bytes[offset + 1] as number) : null;
    const third = offset + 2 < bytes.length ? (bytes[offset + 2] as number) : null;
    out += BASE64_ALPHABET[first >> 2];
    out += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    out += second === null ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    out += third === null ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return out;
};

export const decodeBase64 = (value: string): Uint8Array | null => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (normalized.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((normalized.length * 3) / 4));
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (const character of normalized) {
    const digit = BASE64_ALPHABET.indexOf(character);
    if (digit < 0) return null;
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return bytes;
};

export const participantIdentity = (userId: string, deviceId: string): string => `${userId}:${deviceId}`;

export const splitIdentity = (identity: string): { userId: string; deviceId: string } | null => {
  const separator = identity.lastIndexOf(":");
  if (separator <= 0) return null;
  const userId = identity.slice(0, separator);
  const deviceId = identity.slice(separator + 1);
  if (!userId.startsWith("@") || !userId.includes(":") || deviceId.length === 0) return null;
  return { userId, deviceId };
};

export type ParticipantKey = {
  userId: string;
  deviceId: string;
  identity: string;
  index: number;
  key: Uint8Array;
};

type KeyMessage = {
  type?: unknown;
  sender?: unknown;
  encrypted?: unknown;
  content?: unknown;
};

type KeyContent = {
  room_id?: unknown;
  keys?: unknown;
  member?: unknown;
};

export const parseKeyMessage = (roomId: string, message: unknown): ParticipantKey | null => {
  if (typeof message !== "object" || message === null) return null;
  const { type, sender, encrypted, content } = message as KeyMessage;
  if (type !== KEY_EVENT_TYPE) return null;
  if (encrypted === false) return null;
  if (typeof sender !== "string" || !sender.startsWith("@")) return null;
  if (typeof content !== "object" || content === null) return null;

  const { room_id: contentRoomId, keys, member } = content as KeyContent;
  if (typeof contentRoomId === "string" && contentRoomId !== roomId) return null;
  if (typeof keys !== "object" || keys === null) return null;
  if (typeof member !== "object" || member === null) return null;

  const { index, key } = keys as { index?: unknown; key?: unknown };
  const { claimed_device_id: deviceId } = member as { claimed_device_id?: unknown };
  if (typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= KEY_INDEX_LIMIT) return null;
  if (typeof key !== "string" || key.length === 0) return null;
  if (typeof deviceId !== "string" || deviceId.length === 0) return null;

  const material = decodeBase64(key);
  if (!material || material.length === 0) return null;

  return {
    userId: sender,
    deviceId,
    identity: participantIdentity(sender, deviceId),
    index,
    key: material,
  };
};

export const ownKeyContent = (
  roomId: string,
  userId: string,
  deviceId: string,
  key: Uint8Array,
): Record<string, unknown> => ({
  keys: { index: OWN_KEY_INDEX, key: encodeBase64(key) },
  room_id: roomId,
  member: { id: participantIdentity(userId, deviceId), claimed_device_id: deviceId },
  session: { call_id: RTC_CALL_ID, application: RTC_APPLICATION, scope: RTC_SCOPE },
  sent_ts: Date.now(),
});

export type KeySink = (key: ParticipantKey) => void;

export class CallKeyStore {
  private readonly keys = new Map<string, ParticipantKey>();
  private sink: KeySink | null = null;

  add(key: ParticipantKey): void {
    this.keys.set(`${key.identity}|${key.index}`, key);
    this.sink?.(key);
  }

  attach(sink: KeySink): void {
    this.sink = sink;
    for (const key of this.keys.values()) sink(key);
  }

  detach(): void {
    this.sink = null;
  }

  get count(): number {
    return this.keys.size;
  }
}

export type MediaSession = {
  localIdentity: () => string;
  remoteIdentities: () => string[];
  watchRemotes: (onJoin: (identity: string) => void) => () => void;
  applyKey: (identity: string, key: Uint8Array, index: number) => Promise<void>;
  encryptOutgoing: () => Promise<void>;
};

export type CallKeyChannel = {
  attach: (session: MediaSession) => void;
  stop: () => void;
};
