import { describe, expect, mock, test } from "bun:test";

mock.module("react-native", () => ({
  NativeModules: {},
  Platform: { OS: "android" },
}));

const { ringUpdate, startVoipRings, voipToken } = await import("./pushkit");
const { createPendingRingCalls } = await import("./pending-calls");

const PHONE = "PHONE";
const token = "a".repeat(64);
const otherToken = "b".repeat(64);
const NOW = 1_700_000_000_000;

const tablet = { deviceId: "TABLET", token: otherToken, updatedAt: 1000 };

describe("ringUpdate", () => {
  test("publishes the first token of this device", () => {
    expect(ringUpdate(null, PHONE, token, NOW)).toEqual({
      deviceTokens: [{ deviceId: PHONE, token, updatedAt: NOW }],
    });
  });

  test("stays silent when the event already carries this token", () => {
    const current = { deviceTokens: [{ deviceId: PHONE, token, updatedAt: 1 }] };
    expect(ringUpdate(current, PHONE, token, NOW)).toBeNull();
  });

  test("publishes again when apns handed out a new token", () => {
    const current = { deviceTokens: [{ deviceId: PHONE, token: otherToken, updatedAt: 1 }] };
    expect(ringUpdate(current, PHONE, token, NOW)).toEqual({
      deviceTokens: [{ deviceId: PHONE, token, updatedAt: NOW }],
    });
  });

  test("never drops the other devices of the same person", () => {
    const current = { deviceTokens: [tablet] };
    expect(ringUpdate(current, PHONE, token, NOW)).toEqual({
      deviceTokens: [{ deviceId: PHONE, token, updatedAt: NOW }, tablet],
    });
  });

  test("a junk event is replaced by a clean one rather than trusted", () => {
    expect(ringUpdate({ deviceTokens: "gone" }, PHONE, token, NOW)).toEqual({
      deviceTokens: [{ deviceId: PHONE, token, updatedAt: NOW }],
    });
  });
});

describe("voipToken", () => {
  test("no token and no crash where pushkit does not exist", async () => {
    expect(await voipToken()).toBeNull();
  });
});

describe("startVoipRings", () => {
  test("no subscription and no crash where pushkit does not exist", async () => {
    const pending = createPendingRingCalls();
    const stop = await startVoipRings(pending);
    stop();
    expect(pending.forRoom("!room:kazimo.dev")).toBeNull();
  });
});
