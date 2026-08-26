/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  isRingDeviceToken,
  parseRingRequest,
  RING_MAX_DEVICE_TOKENS,
  ringDeviceIsCurrent,
  ringDevicesOf,
  ringTokenIsStale,
  ringTokensOf,
  withoutRingTokens,
  withRingDevice,
} from "./ring";

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

const phone = { deviceId: "PHONE", token: "a".repeat(64), updatedAt: 2000 };
const tablet = { deviceId: "TABLET", token: "b".repeat(64), updatedAt: 1000 };

describe("ringDevicesOf", () => {
  test("keeps well formed entries newest first", () => {
    expect(ringDevicesOf({ deviceTokens: [tablet, phone] })).toEqual([phone, tablet]);
  });

  test("drops invalid entries silently", () => {
    expect(
      ringDevicesOf({
        deviceTokens: [
          phone,
          { deviceId: "BAD", token: "nope", updatedAt: 1 },
          { deviceId: "", token: deviceToken, updatedAt: 1 },
          { deviceId: "NOTIME", token: deviceToken },
          { deviceId: "NEGATIVE", token: deviceToken, updatedAt: -1 },
          "junk",
          null,
        ],
      }),
    ).toEqual([phone]);
  });

  test("one entry per device id, the freshest wins", () => {
    const stale = { deviceId: "PHONE", token: "c".repeat(64), updatedAt: 1 };
    expect(ringDevicesOf({ deviceTokens: [stale, phone] })).toEqual([phone]);
    expect(ringDevicesOf({ deviceTokens: [phone, stale] })).toEqual([phone]);
  });

  test("caps the list the gateway would refuse", () => {
    const many = Array.from({ length: RING_MAX_DEVICE_TOKENS + 3 }, (_, index) => ({
      deviceId: `DEVICE${index}`,
      token: deviceToken,
      updatedAt: index,
    }));
    expect(ringDevicesOf({ deviceTokens: many })).toHaveLength(RING_MAX_DEVICE_TOKENS);
  });

  test("an empty or absent list means no devices", () => {
    expect(ringDevicesOf({})).toEqual([]);
    expect(ringDevicesOf({ deviceTokens: [] })).toEqual([]);
    expect(ringDevicesOf({ deviceTokens: "none" })).toEqual([]);
    expect(ringDevicesOf(null)).toEqual([]);
    expect(ringDevicesOf(undefined)).toEqual([]);
  });
});

describe("ringTokensOf", () => {
  test("tokens newest first, never the same one twice", () => {
    expect(ringTokensOf({ deviceTokens: [tablet, phone] })).toEqual([phone.token, tablet.token]);
    expect(ringTokensOf({ deviceTokens: [phone, { ...tablet, token: phone.token }] })).toEqual([phone.token]);
  });
});

describe("ringDeviceIsCurrent", () => {
  test("true only when this device already publishes this token", () => {
    const content = { deviceTokens: [phone, tablet] };
    expect(ringDeviceIsCurrent(content, phone.deviceId, phone.token)).toBe(true);
    expect(ringDeviceIsCurrent(content, phone.deviceId, tablet.token)).toBe(false);
    expect(ringDeviceIsCurrent(content, "OTHER", phone.token)).toBe(false);
    expect(ringDeviceIsCurrent({}, phone.deviceId, phone.token)).toBe(false);
  });
});

describe("withRingDevice", () => {
  test("replaces only this device and leaves the others alone", () => {
    const renewed = { ...phone, token: "e".repeat(64), updatedAt: 3000 };
    expect(withRingDevice({ deviceTokens: [phone, tablet] }, renewed)).toEqual({
      deviceTokens: [renewed, tablet],
    });
  });

  test("adds a device to an empty or missing list", () => {
    expect(withRingDevice({}, phone)).toEqual({ deviceTokens: [phone] });
    expect(withRingDevice(null, phone)).toEqual({ deviceTokens: [phone] });
  });

  test("stays within the cap by dropping the oldest device", () => {
    const many = Array.from({ length: RING_MAX_DEVICE_TOKENS }, (_, index) => ({
      deviceId: `DEVICE${index}`,
      token: deviceToken,
      updatedAt: index + 10,
    }));
    const next = withRingDevice({ deviceTokens: many }, phone);
    expect(next.deviceTokens).toHaveLength(RING_MAX_DEVICE_TOKENS);
    expect(next.deviceTokens.some((device) => device.deviceId === "DEVICE0")).toBe(false);
  });
});

describe("withoutRingTokens", () => {
  test("removes the dead tokens and keeps the rest", () => {
    expect(withoutRingTokens({ deviceTokens: [phone, tablet] }, [tablet.token])).toEqual({
      deviceTokens: [phone],
    });
  });

  test("removing nothing known leaves the list as it stands", () => {
    expect(withoutRingTokens({ deviceTokens: [phone] }, ["f".repeat(64)])).toEqual({
      deviceTokens: [phone],
    });
    expect(withoutRingTokens({}, [phone.token])).toEqual({ deviceTokens: [] });
  });
});
