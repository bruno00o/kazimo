import {
  RING_PAYLOAD_VERSION,
  type RingPushPayload,
  type RingRequest,
  type RingResult,
  ringTokenIsStale,
} from "@kazimo/shared";
import { createHttp2Client } from "./http2";
import type { JwtProvider } from "./jwt";

export const APNS_TIMEOUT_MS = 5000;
export const UNREACHABLE_STATUS = 0;
export const UNREACHABLE_REASON = "Unreachable";

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export const apnsTopic = (bundleId: string): string => `${bundleId}.voip`;

export const apnsUrl = (host: string, deviceToken: string): string => `${host}/3/device/${deviceToken}`;

export const apnsHeaders = (jwt: string, topic: string): Record<string, string> => ({
  authorization: `bearer ${jwt}`,
  "apns-topic": topic,
  "apns-push-type": "voip",
  "apns-priority": "10",
  "apns-expiration": "0",
  "content-type": "application/json",
});

export const reasonOf = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
};

export const resultOf = (index: number, status: number, body: string): RingResult => {
  const ok = status === 200;
  const reason = ok ? null : reasonOf(body);
  return { index, ok, status, reason, stale: ringTokenIsStale(reason) };
};

export const payloadOf = (request: RingRequest, expiresAt: number): RingPushPayload => ({
  v: RING_PAYLOAD_VERSION,
  roomId: request.roomId,
  callId: request.callId,
  callerName: request.caller.name,
  expiresAt,
});

export interface PusherOptions {
  host: string;
  topic: string;
  jwt: JwtProvider;
  transport?: Transport;
  timeoutMs?: number;
}

export interface Pusher {
  readonly push: (request: RingRequest, expiresAt: number) => Promise<RingResult[]>;
}

export const transportFor = (host: string): Transport =>
  host.startsWith("https://") ? createHttp2Client(host).send : (url, init) => fetch(url, init);

export const createPusher = (options: PusherOptions): Pusher => {
  const transport = options.transport ?? transportFor(options.host);
  const timeoutMs = options.timeoutMs ?? APNS_TIMEOUT_MS;
  return {
    push: async (request, expiresAt) => {
      const jwt = await options.jwt.token();
      const headers = apnsHeaders(jwt, options.topic);
      const body = JSON.stringify(payloadOf(request, expiresAt));
      return Promise.all(
        request.callee.deviceTokens.map(async (deviceToken, index) => {
          try {
            const response = await transport(apnsUrl(options.host, deviceToken), {
              method: "POST",
              headers,
              body,
              signal: AbortSignal.timeout(timeoutMs),
            });
            return resultOf(index, response.status, await response.text());
          } catch {
            return {
              index,
              ok: false,
              status: UNREACHABLE_STATUS,
              reason: UNREACHABLE_REASON,
              stale: false,
            } satisfies RingResult;
          }
        }),
      );
    },
  };
};
