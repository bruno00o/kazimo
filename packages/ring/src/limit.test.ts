import { describe, expect, test } from "bun:test";
import { createRateLimiter, RATE_WINDOW_MS } from "./limit";

describe("createRateLimiter", () => {
  test("allows up to the limit inside one window", () => {
    const limiter = createRateLimiter(3);
    expect([1, 2, 3].map(() => limiter.allow("lisboa", 1000))).toEqual([true, true, true]);
    expect(limiter.allow("lisboa", 1000)).toBe(false);
  });

  test("counts each deployment on its own", () => {
    const limiter = createRateLimiter(1);
    expect(limiter.allow("lisboa", 1000)).toBe(true);
    expect(limiter.allow("porto", 1000)).toBe(true);
    expect(limiter.allow("lisboa", 1000)).toBe(false);
  });

  test("lets the window slide", () => {
    const limiter = createRateLimiter(2);
    expect(limiter.allow("lisboa", 1000)).toBe(true);
    expect(limiter.allow("lisboa", 2000)).toBe(true);
    expect(limiter.allow("lisboa", 3000)).toBe(false);
    expect(limiter.allow("lisboa", 1000 + RATE_WINDOW_MS + 1)).toBe(true);
  });

  test("keeps refusing while a blocked deployment keeps trying", () => {
    const limiter = createRateLimiter(1);
    expect(limiter.allow("lisboa", 1000)).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.allow("lisboa", 1000 + attempt)).toBe(false);
    }
    expect(limiter.allow("lisboa", 1000 + RATE_WINDOW_MS + 1)).toBe(true);
  });

  test("forgets keys that fell out of the window instead of growing forever", () => {
    const limiter = createRateLimiter(1, RATE_WINDOW_MS, 2);
    expect(limiter.allow("one", 1000)).toBe(true);
    expect(limiter.allow("two", 1000)).toBe(true);
    expect(limiter.allow("three", 1000)).toBe(false);
    expect(limiter.allow("three", 1000 + RATE_WINDOW_MS + 1)).toBe(true);
  });
});
