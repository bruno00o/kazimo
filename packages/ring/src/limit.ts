export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX_KEYS = 10_000;

export interface RateLimiter {
  readonly allow: (key: string, now: number) => boolean;
}

export const createRateLimiter = (
  limit: number,
  windowMs: number = RATE_WINDOW_MS,
  maxKeys: number = RATE_MAX_KEYS,
): RateLimiter => {
  const hits = new Map<string, number[]>();
  const forgetOlderThan = (since: number) => {
    for (const [key, recent] of hits) {
      if ((recent[recent.length - 1] ?? 0) <= since) hits.delete(key);
    }
  };
  return {
    allow: (key, now) => {
      const since = now - windowMs;
      if (hits.size >= maxKeys && !hits.has(key)) forgetOlderThan(since);
      if (hits.size >= maxKeys && !hits.has(key)) return false;
      const recent = (hits.get(key) ?? []).filter((at) => at > since);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
};
