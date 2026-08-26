export const RATE_WINDOW_MS = 60_000;

export interface RateLimiter {
  readonly allow: (key: string, now: number) => boolean;
}

export const createRateLimiter = (limit: number, windowMs: number = RATE_WINDOW_MS): RateLimiter => {
  const hits = new Map<string, number[]>();
  return {
    allow: (key, now) => {
      const since = now - windowMs;
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
