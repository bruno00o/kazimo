import { ringTokenIsStale } from "@kazimo/shared";
import {
  APNS_TIMEOUT_MS,
  apnsUrl,
  reasonOf,
  type Transport,
  transportFor,
  UNREACHABLE_REASON,
  UNREACHABLE_STATUS,
} from "./apns";
import type { JwtProvider } from "./jwt";

export const MESSAGE_TITLE = "Kazimo";
export const MESSAGE_BODY = "New message";
export const MESSAGE_SOUND = "default";

export interface MessageAlert {
  title: string;
  body: string;
}

export interface MessagePushPayload {
  aps: {
    "mutable-content": 1;
    alert: MessageAlert;
    sound: string;
    badge?: number;
  };
  room_id: string;
  event_id: string;
}

export const messagePayloadOf = (
  roomId: string,
  eventId: string,
  unread: number | null,
): MessagePushPayload => ({
  aps: {
    "mutable-content": 1,
    alert: { title: MESSAGE_TITLE, body: MESSAGE_BODY },
    sound: MESSAGE_SOUND,
    ...(unread === null ? {} : { badge: unread }),
  },
  room_id: roomId,
  event_id: eventId,
});

export const messageHeaders = (jwt: string, topic: string, expiresAt: number): Record<string, string> => ({
  authorization: `bearer ${jwt}`,
  "apns-topic": topic,
  "apns-push-type": "alert",
  "apns-priority": "10",
  "apns-expiration": String(expiresAt),
  "content-type": "application/json",
});

export interface MessageDelivery {
  pushkey: string;
  ok: boolean;
  status: number;
  reason: string | null;
  stale: boolean;
}

export const deliveryOf = (pushkey: string, status: number, body: string): MessageDelivery => {
  const ok = status === 200;
  const reason = ok ? null : reasonOf(body);
  return { pushkey, ok, status, reason, stale: ringTokenIsStale(reason) };
};

export interface MessagePusherOptions {
  host: string;
  topic: string;
  jwt: JwtProvider;
  transport?: Transport;
  timeoutMs?: number;
}

export interface MessagePusher {
  readonly push: (
    pushkeys: readonly string[],
    payload: MessagePushPayload,
    expiresAt: number,
  ) => Promise<MessageDelivery[]>;
}

export const createMessagePusher = (options: MessagePusherOptions): MessagePusher => {
  const transport = options.transport ?? transportFor(options.host);
  const timeoutMs = options.timeoutMs ?? APNS_TIMEOUT_MS;
  return {
    push: async (pushkeys, payload, expiresAt) => {
      const jwt = await options.jwt.token();
      const headers = messageHeaders(jwt, options.topic, expiresAt);
      const body = JSON.stringify(payload);
      return Promise.all(
        pushkeys.map(async (pushkey) => {
          try {
            const response = await transport(apnsUrl(options.host, pushkey), {
              method: "POST",
              headers,
              body,
              signal: AbortSignal.timeout(timeoutMs),
            });
            return deliveryOf(pushkey, response.status, await response.text());
          } catch {
            return {
              pushkey,
              ok: false,
              status: UNREACHABLE_STATUS,
              reason: UNREACHABLE_REASON,
              stale: false,
            } satisfies MessageDelivery;
          }
        }),
      );
    },
  };
};
