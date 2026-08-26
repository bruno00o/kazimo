export const RING_PATH = "/ring";
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
