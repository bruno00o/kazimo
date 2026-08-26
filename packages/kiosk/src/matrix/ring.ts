import {
  contactUserIdOf,
  RING_MAX_DEVICE_TOKENS,
  type RingDevices,
  type RingDevicesContent,
  ringDevicesOf,
  ringTokensOf,
  withoutRingTokens,
} from "@kazimo/shared";

export interface RingStateEntry {
  peerUserId: string;
  stateKey: string;
  content: unknown;
}

export const ringDevicesByUser = (entries: readonly RingStateEntry[]): RingDevices => {
  const byUser = new Map<string, string[]>();
  for (const entry of entries) {
    const userId = contactUserIdOf(entry.stateKey);
    if (!userId || userId !== entry.peerUserId) continue;
    const tokens = ringTokensOf(entry.content);
    if (tokens.length === 0) continue;
    const known = byUser.get(userId) ?? [];
    byUser.set(userId, [...new Set([...known, ...tokens])].slice(0, RING_MAX_DEVICE_TOKENS));
  }
  return Object.fromEntries([...byUser].sort(([left], [right]) => left.localeCompare(right)));
};

export const ringDevicesDiffer = (left: RingDevices, right: RingDevices): boolean =>
  JSON.stringify(left) !== JSON.stringify(right);

export const ringContentWithoutTokens = (
  content: unknown,
  tokens: readonly string[],
): RingDevicesContent | null => {
  const before = ringDevicesOf(content).length;
  const after = withoutRingTokens(content, tokens);
  return after.deviceTokens.length === before ? null : after;
};
