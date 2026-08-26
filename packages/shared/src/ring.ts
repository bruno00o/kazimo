export const RING_PATH = "/ring";
export const RING_EVENT_TYPE = "dev.kazimo.ring";
export const RING_PAYLOAD_VERSION = 1;
export const RING_MAX_DEVICE_TOKENS = 8;
export const RING_MAX_CALLER_NAME_LENGTH = 64;
export const RING_MAX_ROOM_ID_LENGTH = 255;
export const RING_MAX_CALL_ID_LENGTH = 64;

const DEVICE_TOKEN_PATTERN = /^[0-9a-fA-F]{64,200}$/;
const ROOM_ID_PATTERN = /^![!-~]+:[!-~]+$/;
const CALL_ID_PATTERN = /^[0-9a-zA-Z-]{8,64}$/;

export interface RingRequest {
  callee: { deviceTokens: string[] };
  caller: { name: string };
  roomId: string;
  callId: string;
}

export interface RingPushPayload {
  v: number;
  roomId: string;
  callId: string;
  callerName: string;
  expiresAt: number;
}

export interface RingResult {
  index: number;
  ok: boolean;
  status: number;
  reason: string | null;
  stale: boolean;
}

export interface RingResponse {
  callId: string;
  results: RingResult[];
}

export type RingErrorCode = "unauthorized" | "invalid_request" | "rate_limited" | "push_unavailable";

export interface RingErrorResponse {
  error: RingErrorCode;
}

export const RING_STALE_REASONS = ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"] as const;

export const ringTokenIsStale = (reason: string | null): boolean =>
  reason !== null && (RING_STALE_REASONS as readonly string[]).includes(reason);

export const isRingDeviceToken = (value: unknown): value is string =>
  typeof value === "string" && DEVICE_TOKEN_PATTERN.test(value);

const isRoomId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= RING_MAX_ROOM_ID_LENGTH && ROOM_ID_PATTERN.test(value);

const isCallId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= RING_MAX_CALL_ID_LENGTH && CALL_ID_PATTERN.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseRingRequest = (value: unknown): RingRequest | null => {
  if (!isRecord(value)) return null;
  const { callee, caller, roomId, callId } = value;
  if (!isRecord(callee) || !isRecord(caller)) return null;
  if (!isRoomId(roomId) || !isCallId(callId)) return null;
  const name = caller.name;
  if (typeof name !== "string") return null;
  const callerName = name.trim();
  if (callerName.length === 0 || callerName.length > RING_MAX_CALLER_NAME_LENGTH) return null;
  const deviceTokens = callee.deviceTokens;
  if (!Array.isArray(deviceTokens)) return null;
  if (deviceTokens.length === 0 || deviceTokens.length > RING_MAX_DEVICE_TOKENS) return null;
  if (!deviceTokens.every(isRingDeviceToken)) return null;
  return { callee: { deviceTokens }, caller: { name: callerName }, roomId, callId };
};

export interface RingDevice {
  deviceId: string;
  token: string;
  updatedAt: number;
}

export interface RingDevicesContent {
  deviceTokens: RingDevice[];
}

const RING_MAX_DEVICE_ID_LENGTH = 128;

const isDeviceId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= RING_MAX_DEVICE_ID_LENGTH;

const isUpdatedAt = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const ringDeviceOf = (value: unknown): RingDevice | null => {
  if (!isRecord(value)) return null;
  const { deviceId, token, updatedAt } = value;
  if (!isDeviceId(deviceId) || !isRingDeviceToken(token) || !isUpdatedAt(updatedAt)) return null;
  return { deviceId, token, updatedAt };
};

const byRecency = (a: RingDevice, b: RingDevice): number => b.updatedAt - a.updatedAt;

export const ringDevicesOf = (content: unknown): RingDevice[] => {
  if (!isRecord(content)) return [];
  const raw = content.deviceTokens;
  if (!Array.isArray(raw)) return [];
  const newest = new Map<string, RingDevice>();
  for (const entry of raw) {
    const device = ringDeviceOf(entry);
    if (!device) continue;
    const known = newest.get(device.deviceId);
    if (known && known.updatedAt >= device.updatedAt) continue;
    newest.set(device.deviceId, device);
  }
  return [...newest.values()].sort(byRecency).slice(0, RING_MAX_DEVICE_TOKENS);
};

export const ringTokensOf = (content: unknown): string[] => [
  ...new Set(ringDevicesOf(content).map((device) => device.token)),
];

export const ringDeviceIsCurrent = (content: unknown, deviceId: string, token: string): boolean =>
  ringDevicesOf(content).some((device) => device.deviceId === deviceId && device.token === token);

export const withRingDevice = (content: unknown, device: RingDevice): RingDevicesContent => {
  const kept = ringDevicesOf(content).filter((known) => known.deviceId !== device.deviceId);
  return { deviceTokens: [device, ...kept].sort(byRecency).slice(0, RING_MAX_DEVICE_TOKENS) };
};

export const withoutRingTokens = (content: unknown, tokens: readonly string[]): RingDevicesContent => {
  const dead = new Set(tokens);
  return { deviceTokens: ringDevicesOf(content).filter((device) => !dead.has(device.token)) };
};
