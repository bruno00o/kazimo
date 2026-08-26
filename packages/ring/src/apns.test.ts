import { describe, expect, test } from "bun:test";
import { RING_PAYLOAD_VERSION, type RingRequest } from "@kazimo/shared";
import {
  apnsHeaders,
  apnsTopic,
  apnsUrl,
  createPusher,
  payloadOf,
  reasonOf,
  resultOf,
  UNREACHABLE_STATUS,
} from "./apns";

const deviceToken = "a".repeat(64);
const otherToken = "b".repeat(64);

const ringRequest: RingRequest = {
  callee: { deviceTokens: [deviceToken] },
  caller: { name: "Vovo" },
  roomId: "!room:kazimo.dev",
  callId: "11111111-2222-3333-4444-555555555555",
};

const jwt = { token: async () => "signed.jwt.value" };

describe("apns request shape", () => {
  test("targets the voip topic and the device path", () => {
    expect(apnsTopic("dev.kazimo.family")).toBe("dev.kazimo.family.voip");
    expect(apnsUrl("https://api.push.apple.com", deviceToken)).toBe(
      `https://api.push.apple.com/3/device/${deviceToken}`,
    );
  });

  test("carries the headers a late ring must never survive", () => {
    const headers = apnsHeaders("jwt", "dev.kazimo.family.voip");
    expect(headers["apns-push-type"]).toBe("voip");
    expect(headers["apns-priority"]).toBe("10");
    expect(headers["apns-expiration"]).toBe("0");
    expect(headers.authorization).toBe("bearer jwt");
  });

  test("payload carries what callkit needs and nothing else", () => {
    expect(payloadOf(ringRequest, 1700000060)).toEqual({
      v: RING_PAYLOAD_VERSION,
      roomId: "!room:kazimo.dev",
      callId: "11111111-2222-3333-4444-555555555555",
      callerName: "Vovo",
      expiresAt: 1700000060,
    });
  });
});

describe("resultOf", () => {
  test("reads a delivery as a success", () => {
    expect(resultOf(0, 200, "")).toEqual({ index: 0, ok: true, status: 200, reason: null, stale: false });
  });

  test("flags a dead token so the daemon can purge it later", () => {
    expect(resultOf(1, 410, '{"reason":"Unregistered"}')).toEqual({
      index: 1,
      ok: false,
      status: 410,
      reason: "Unregistered",
      stale: true,
    });
    expect(resultOf(0, 400, '{"reason":"BadDeviceToken"}').stale).toBe(true);
  });

  test("keeps a transient failure out of the purge list", () => {
    expect(resultOf(0, 429, '{"reason":"TooManyRequests"}').stale).toBe(false);
    expect(resultOf(0, 500, "").reason).toBeNull();
  });

  test("survives a body apns did not write", () => {
    expect(reasonOf("<html>gateway</html>")).toBeNull();
  });
});

describe("createPusher", () => {
  test("pushes to every device and reports each one by index", async () => {
    const seen: string[] = [];
    const pusher = createPusher({
      host: "https://apns.test",
      topic: "dev.kazimo.family.voip",
      jwt,
      transport: async (url) => {
        seen.push(url);
        return url.endsWith(otherToken)
          ? new Response('{"reason":"BadDeviceToken"}', { status: 400 })
          : new Response("", { status: 200 });
      },
    });
    const results = await pusher.push(
      { ...ringRequest, callee: { deviceTokens: [deviceToken, otherToken] } },
      1700000060,
    );
    expect(seen.length).toBe(2);
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(results[1]?.stale).toBe(true);
  });

  test("reports an unreachable apns instead of throwing", async () => {
    const pusher = createPusher({
      host: "https://apns.test",
      topic: "dev.kazimo.family.voip",
      jwt,
      transport: async () => {
        throw new Error("socket closed");
      },
    });
    const results = await pusher.push(ringRequest, 1700000060);
    expect(results[0]?.status).toBe(UNREACHABLE_STATUS);
    expect(results[0]?.ok).toBe(false);
  });

  test("sends the payload once per device with the signed jwt", async () => {
    const bodies: string[] = [];
    const authorizations: string[] = [];
    const pusher = createPusher({
      host: "https://apns.test",
      topic: "dev.kazimo.family.voip",
      jwt,
      transport: async (_url, init) => {
        bodies.push(String(init.body));
        authorizations.push((init.headers as Record<string, string>).authorization as string);
        return new Response("", { status: 200 });
      },
    });
    await pusher.push(ringRequest, 1700000060);
    expect(JSON.parse(bodies[0] as string).callerName).toBe("Vovo");
    expect(authorizations[0]).toBe("bearer signed.jwt.value");
  });
});
