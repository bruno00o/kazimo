import { describe, expect, test } from "bun:test";
import { isNightHour } from "./night";

describe("isNightHour", () => {
  test("wrapping window 22-7", () => {
    expect(isNightHour(22, 22, 7)).toBe(true);
    expect(isNightHour(23, 22, 7)).toBe(true);
    expect(isNightHour(0, 22, 7)).toBe(true);
    expect(isNightHour(6, 22, 7)).toBe(true);
    expect(isNightHour(7, 22, 7)).toBe(false);
    expect(isNightHour(12, 22, 7)).toBe(false);
    expect(isNightHour(21, 22, 7)).toBe(false);
  });

  test("non wrapping window 1-5", () => {
    expect(isNightHour(0, 1, 5)).toBe(false);
    expect(isNightHour(1, 1, 5)).toBe(true);
    expect(isNightHour(4, 1, 5)).toBe(true);
    expect(isNightHour(5, 1, 5)).toBe(false);
  });

  test("empty window never night", () => {
    expect(isNightHour(3, 8, 8)).toBe(false);
  });
});
