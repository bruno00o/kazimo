import { isRingDeviceToken } from "@kazimo/shared";
import type { RateLimiter } from "./limit";
import { log } from "./log";
import { type MessageDelivery, type MessagePusher, messagePayloadOf } from "./message";

export const NOTIFY_PATH = "/_matrix/push/v1/notify";
export const MAX_NOTIFY_BODY_BYTES = 16_384;
export const MAX_PUSHKEY_LENGTH = 512;
export const MAX_APP_ID_LENGTH = 128;
export const MAX_ROOM_ID_LENGTH = 255;
export const MAX_EVENT_ID_LENGTH = 255;

const ROOM_ID_PATTERN = /^![!-~]+:[!-~]+$/;
const EVENT_ID_PATTERN = /^\$[!-~]+$/;

export interface NotifyDevice {
  appId: string;
  pushkey: string;
}

export interface Notification {
  eventId: string | null;
  roomId: string | null;
  unread: number | null;
  devices: NotifyDevice[];
}

export interface NotifyResponse {
  rejected: string[];
}

export interface MatrixErrorResponse {
  errcode: string;
  error: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRoomId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_ROOM_ID_LENGTH && ROOM_ID_PATTERN.test(value);

const isEventId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_EVENT_ID_LENGTH && EVENT_ID_PATTERN.test(value);

const unreadOf = (counts: unknown): number | null => {
  if (!isRecord(counts)) return null;
  const unread = counts.unread;
  if (typeof unread !== "number" || !Number.isFinite(unread) || unread < 0) return null;
  return Math.floor(unread);
};

const deviceOf = (value: unknown): NotifyDevice | null => {
  if (!isRecord(value)) return null;
  const appId = value.app_id;
  const pushkey = value.pushkey;
  if (typeof appId !== "string" || typeof pushkey !== "string") return null;
  if (appId.length === 0 || appId.length > MAX_APP_ID_LENGTH) return null;
  if (pushkey.length === 0 || pushkey.length > MAX_PUSHKEY_LENGTH) return null;
  return { appId, pushkey };
};

export const parseNotifyRequest = (value: unknown): Notification | null => {
  if (!isRecord(value)) return null;
  const notification = value.notification;
  if (!isRecord(notification)) return null;
  const raw = notification.devices;
  if (!Array.isArray(raw)) return null;
  const devices: NotifyDevice[] = [];
  for (const entry of raw) {
    const device = deviceOf(entry);
    if (!device) return null;
    devices.push(device);
  }
  return {
    eventId: isEventId(notification.event_id) ? notification.event_id : null,
    roomId: isRoomId(notification.room_id) ? notification.room_id : null,
    unread: unreadOf(notification.counts),
    devices,
  };
};

export interface NotifyHandlerDeps {
  appId: string;
  pusher: MessagePusher;
  limiter: RateLimiter;
  lifetimeSeconds: number;
  now?: () => number;
  onLog?: (message: string) => void;
}

const matrixError = (status: number, errcode: string, error: string): Response =>
  Response.json({ errcode, error } satisfies MatrixErrorResponse, { status });

const accepted = (rejected: string[]): Response => Response.json({ rejected } satisfies NotifyResponse);

const tooLarge = (request: Request): boolean => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  return Number.isFinite(declared) && declared > MAX_NOTIFY_BODY_BYTES;
};

const suffixOf = (rejected: number, throttled: number): string =>
  (rejected > 0 ? `, ${rejected} rejected` : "") + (throttled > 0 ? `, ${throttled} throttled` : "");

export const handleNotify = async (request: Request, deps: NotifyHandlerDeps): Promise<Response> => {
  const now = deps.now ?? Date.now;
  const write = deps.onLog ?? log;
  if (tooLarge(request)) {
    return matrixError(400, "M_TOO_LARGE", "the notification is larger than a push notification can be");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return matrixError(400, "M_NOT_JSON", "the notification is not json");
  }
  const notification = parseNotifyRequest(body);
  if (!notification) {
    write("rejected a notification that does not match the push gateway schema");
    return matrixError(400, "M_BAD_JSON", "the notification does not match the push gateway schema");
  }

  const rejected: string[] = [];
  const mine: string[] = [];
  for (const device of notification.devices) {
    if (device.appId !== deps.appId) continue;
    if (isRingDeviceToken(device.pushkey)) mine.push(device.pushkey);
    else rejected.push(device.pushkey);
  }

  const { eventId, roomId } = notification;
  if (eventId === null || roomId === null) {
    write(`notify carried no event for ${mine.length} devices, nothing to alert`);
    return accepted(rejected);
  }

  const at = now();
  const targets: string[] = [];
  let throttled = 0;
  for (const pushkey of new Set(mine)) {
    if (deps.limiter.allow(pushkey, at)) targets.push(pushkey);
    else throttled += 1;
  }
  if (targets.length === 0) {
    write(`notify ${eventId}: no device to alert${suffixOf(rejected.length, throttled)}`);
    return accepted(rejected);
  }

  const expiresAt = Math.floor(at / 1000) + deps.lifetimeSeconds;
  let deliveries: MessageDelivery[];
  try {
    deliveries = await deps.pusher.push(
      targets,
      messagePayloadOf(roomId, eventId, notification.unread),
      expiresAt,
    );
  } catch (error) {
    write(`notify unavailable: ${error instanceof Error ? error.message : "unknown"}`);
    return matrixError(502, "M_UNKNOWN", "the push service is unavailable");
  }

  for (const delivery of deliveries) {
    if (delivery.stale) rejected.push(delivery.pushkey);
  }
  const delivered = deliveries.filter((delivery) => delivery.ok).length;
  write(
    `notify ${eventId}: ${delivered}/${deliveries.length} delivered${suffixOf(rejected.length, throttled)}`,
  );
  return accepted(rejected);
};
