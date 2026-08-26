import {
  type Contact,
  RING_MAX_CALLER_NAME_LENGTH,
  RING_PATH,
  type RingRequest,
  type RingResponse,
} from "@kazimo/shared";
import type { RingConfig } from "./config";

export const RING_TIMEOUT_MS = 2000;

const log = (message: string) => console.log(`[kazimod] ${new Date().toISOString()} ring: ${message}`);

export const ringUrl = (base: string): string => `${base.replace(/\/$/, "")}${RING_PATH}`;

export const ringRequestFor = (config: RingConfig, contact: Contact, callId: string): RingRequest | null => {
  const deviceTokens = config.deviceTokens[contact.userId];
  if (!deviceTokens || deviceTokens.length === 0) return null;
  return {
    callee: { deviceTokens },
    caller: { name: config.callerName.slice(0, RING_MAX_CALLER_NAME_LENGTH) },
    roomId: contact.roomId,
    callId,
  };
};

export const postRing = async (
  config: RingConfig,
  request: RingRequest,
  send: typeof fetch = fetch,
): Promise<RingResponse | null> => {
  const response = await send(ringUrl(config.url), {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(RING_TIMEOUT_MS),
  });
  if (!response.ok) {
    log(`gateway refused the ring (${response.status})`);
    return null;
  }
  return (await response.json()) as RingResponse;
};

export const ringSummary = (response: RingResponse): string => {
  const delivered = response.results.filter((result) => result.ok).length;
  const stale = response.results.filter((result) => result.stale).map((result) => result.index);
  return (
    `${delivered}/${response.results.length} devices rang for ${response.callId}` +
    (stale.length > 0 ? `, dead device tokens at ${stale.join(", ")}` : "")
  );
};

export const ringContact = (config: RingConfig | null, contact: Contact, callId: string): void => {
  if (!config) return;
  const request = ringRequestFor(config, contact, callId);
  if (!request) {
    log(`no device token known for ${contact.displayName}`);
    return;
  }
  void postRing(config, request)
    .then((response) => {
      if (response) log(ringSummary(response));
    })
    .catch((error) => log(`gateway unreachable: ${error instanceof Error ? error.message : "unknown"}`));
};
