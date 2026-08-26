/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { isRingDeviceToken, parseRingRequest, RING_MAX_DEVICE_TOKENS, ringTokenIsStale } from "./ring";

const deviceToken = "d".repeat(64);

const valid = {
  callee: { deviceTokens: [deviceToken] },
  caller: { name: "Vovo" },
  roomId: "!room:kazimo.dev",
  callId: "11111111-2222-3333-4444-555555555555",
};

describe("parseRingRequest", () => {
  test("accepts a well formed ring", () => {
    expect(parseRingRequest(valid)).toEqual(valid);
  });

  test("trims the caller name and keeps the device order", () => {
    const parsed = parseRingRequest({
      ...valid,
      caller: { name: "  Vovo  " },
      callee: { deviceTokens: [deviceToken, "e".repeat(64)] },
    });
    expect(parsed?.caller.name).toBe("Vovo");
    expect(parsed?.callee.deviceTokens[1]).toBe("e".repeat(64));
  });

  test("refuses anything that is not an object", () => {
    for (const value of [null, "ring", 7, [], undefined]) expect(parseRingRequest(value)).toBeNull();
  });

  test("refuses a missing or malformed room id", () => {
    expect(parseRingRequest({ ...valid, roomId: "room:kazimo.dev" })).toBeNull();
    expect(parseRingRequest({ ...valid, roomId: "!nocolon" })).toBeNull();
    expect(parseRingRequest({ ...valid, roomId: 7 })).toBeNull();
  });

  test("refuses a call id that is not opaque and short", () => {
    expect(parseRingRequest({ ...valid, callId: "short" })).toBeNull();
    expect(parseRingRequest({ ...valid, callId: "a".repeat(65) })).toBeNull();
    expect(parseRingRequest({ ...valid, callId: "has spaces here" })).toBeNull();
  });

  test("refuses an empty or oversized caller name", () => {
    expect(parseRingRequest({ ...valid, caller: { name: "   " } })).toBeNull();
    expect(parseRingRequest({ ...valid, caller: { name: "n".repeat(65) } })).toBeNull();
    expect(parseRingRequest({ ...valid, caller: {} })).toBeNull();
  });

  test("refuses an empty, oversized or junk device list", () => {
    expect(parseRingRequest({ ...valid, callee: { deviceTokens: [] } })).toBeNull();
    expect(parseRingRequest({ ...valid, callee: { deviceTokens: [deviceToken, "nope"] } })).toBeNull();
    expect(
      parseRingRequest({
        ...valid,
        callee: { deviceTokens: Array.from({ length: RING_MAX_DEVICE_TOKENS + 1 }, () => deviceToken) },
      }),
    ).toBeNull();
  });
});

describe("device tokens and stale reasons", () => {
  test("accepts hexadecimal tokens of the lengths apns issues", () => {
    expect(isRingDeviceToken(deviceToken)).toBe(true);
    expect(isRingDeviceToken("A".repeat(160))).toBe(true);
    expect(isRingDeviceToken("z".repeat(64))).toBe(false);
    expect(isRingDeviceToken("d".repeat(63))).toBe(false);
  });

  test("marks only the reasons that mean the token is dead", () => {
    expect(ringTokenIsStale("BadDeviceToken")).toBe(true);
    expect(ringTokenIsStale("Unregistered")).toBe(true);
    expect(ringTokenIsStale("TooManyRequests")).toBe(false);
    expect(ringTokenIsStale(null)).toBe(false);
  });
});
