import {
  type Contact,
  RING_MAX_CALLER_NAME_LENGTH,
  RING_MAX_DEVICE_TOKENS,
  RING_PATH,
  type RingDevices,
  type RingRequest,
  type RingResponse,
} from "@kazimo/shared";
import type { RingConfig } from "./config";

export const RING_TIMEOUT_MS = 2000;

export interface RingDeviceBook {
  readonly tokens: (userId: string) => string[];
  readonly forget: (userId: string, tokens: readonly string[]) => void;
  readonly reportStale: (userId: string, tokens: string[]) => void;
}

const log = (message: string) => console.log(`[kazimod] ${new Date().toISOString()} ring: ${message}`);

export const ringUrl = (base: string): string => `${base.replace(/\/$/, "")}${RING_PATH}`;

export const mergedDeviceTokens = (
  config: RingConfig,
  userId: string,
  dynamic: readonly string[],
): string[] =>
  [...new Set([...(config.deviceTokens[userId] ?? []), ...dynamic])].slice(0, RING_MAX_DEVICE_TOKENS);

export const prunedRingDevices = (
  devices: RingDevices,
  userId: string,
  tokens: readonly string[],
): RingDevices => {
  const known = devices[userId];
  if (!known) return devices;
  const dead = new Set(tokens);
  const kept = known.filter((token) => !dead.has(token));
  if (kept.length === known.length) return devices;
  const next = { ...devices };
  if (kept.length === 0) delete next[userId];
  else next[userId] = kept;
  return next;
};

export const ringRequestFor = (
  config: RingConfig,
  contact: Contact,
  callId: string,
  dynamic: readonly string[] = [],
): RingRequest | null => {
  const deviceTokens = mergedDeviceTokens(config, contact.userId, dynamic);
  if (deviceTokens.length === 0) return null;
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

export const staleTokensOf = (request: RingRequest, response: RingResponse): string[] => [
  ...new Set(
    response.results
      .filter((result) => result.stale)
      .flatMap((result) => {
        const token = request.callee.deviceTokens[result.index];
        return token ? [token] : [];
      }),
  ),
];

export const ringSummary = (response: RingResponse): string => {
  const delivered = response.results.filter((result) => result.ok).length;
  const stale = response.results.filter((result) => result.stale).map((result) => result.index);
  return (
    `${delivered}/${response.results.length} devices rang for ${response.callId}` +
    (stale.length > 0 ? `, dead device tokens at ${stale.join(", ")}` : "")
  );
};

export const ringContact = (
  config: RingConfig | null,
  contact: Contact,
  callId: string,
  book: RingDeviceBook,
  send: typeof fetch = fetch,
): Promise<void> => {
  if (!config) return Promise.resolve();
  const dynamic = book.tokens(contact.userId);
  const request = ringRequestFor(config, contact, callId, dynamic);
  if (!request) {
    log(`no device token known for ${contact.displayName}`);
    return Promise.resolve();
  }
  return postRing(config, request, send)
    .then((response) => {
      if (!response) return;
      log(ringSummary(response));
      const stale = staleTokensOf(request, response);
      if (stale.length === 0) return;
      const published = stale.filter((token) => dynamic.includes(token));
      const fromEnv = stale.length - published.length;
      if (fromEnv > 0) log(`${fromEnv} dead device tokens come from the env override and stay`);
      if (published.length === 0) return;
      book.forget(contact.userId, published);
      book.reportStale(contact.userId, published);
    })
    .catch((error) => log(`gateway unreachable: ${error instanceof Error ? error.message : "unknown"}`));
};
