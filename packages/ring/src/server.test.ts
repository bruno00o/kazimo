import { describe, expect, test } from "bun:test";
import { RING_PATH, type RingErrorResponse, type RingResponse, type RingResult } from "@kazimo/shared";
import { createAuthenticator } from "./auth";
import { createRateLimiter } from "./limit";
import { handleRing, type RingHandlerDeps } from "./server";

const deviceToken = "c".repeat(64);
const deploymentToken = "a-deployment-secret";

const body = {
  callee: { deviceTokens: [deviceToken] },
  caller: { name: "Vovo" },
  roomId: "!room:kazimo.dev",
  callId: "11111111-2222-3333-4444-555555555555",
};

const delivered: RingResult[] = [{ index: 0, ok: true, status: 200, reason: null, stale: false }];

const makeDeps = async (over: Partial<RingHandlerDeps> = {}): Promise<RingHandlerDeps> => ({
  auth: await createAuthenticator([{ deploymentId: "lisboa", token: deploymentToken }]),
  limiter: createRateLimiter(2),
  pusher: { push: async () => delivered },
  lifetimeSeconds: 60,
  now: () => 1_700_000_000_000,
  onLog: () => {},
  ...over,
});

const ringRequest = (payload: unknown, token: string | null = deploymentToken) =>
  new Request(`http://gateway${RING_PATH}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
    body: JSON.stringify(payload),
  });

describe("handleRing", () => {
  test("pushes an authorised ring and reports every device", async () => {
    const response = await handleRing(ringRequest(body), await makeDeps());
    expect(response.status).toBe(200);
    const result = (await response.json()) as RingResponse;
    expect(result.callId).toBe(body.callId);
    expect(result.results).toEqual(delivered);
  });

  test("hands the expiry computed from the lifetime to the pusher", async () => {
    let seen = 0;
    await handleRing(
      ringRequest(body),
      await makeDeps({
        pusher: {
          push: async (_request, expiresAt) => {
            seen = expiresAt;
            return delivered;
          },
        },
      }),
    );
    expect(seen).toBe(1_700_000_060);
  });

  test("refuses an unknown or missing deployment token", async () => {
    const deps = await makeDeps();
    expect((await handleRing(ringRequest(body, "wrong"), deps)).status).toBe(401);
    expect((await handleRing(ringRequest(body, null), deps)).status).toBe(401);
  });

  test("never reaches apns without a valid body", async () => {
    let pushed = false;
    const deps = await makeDeps({
      pusher: {
        push: async () => {
          pushed = true;
          return delivered;
        },
      },
    });
    const bad = await handleRing(ringRequest({ ...body, roomId: "not-a-room" }), deps);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as RingErrorResponse).error).toBe("invalid_request");
    expect(
      (await handleRing(ringRequest({ ...body, callee: { deviceTokens: ["short"] } }), deps)).status,
    ).toBe(400);
    expect(pushed).toBe(false);
  });

  test("stops a compromised frame at the rate limit", async () => {
    const deps = await makeDeps({ limiter: createRateLimiter(1) });
    expect((await handleRing(ringRequest(body), deps)).status).toBe(200);
    const limited = await handleRing(ringRequest(body), deps);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as RingErrorResponse).error).toBe("rate_limited");
  });

  test("counts the rate limit after authentication, never before", async () => {
    const deps = await makeDeps({ limiter: createRateLimiter(1) });
    expect((await handleRing(ringRequest(body, "wrong"), deps)).status).toBe(401);
    expect((await handleRing(ringRequest(body), deps)).status).toBe(200);
  });

  test("answers push_unavailable when the signing key cannot be used", async () => {
    const deps = await makeDeps({
      pusher: {
        push: async () => {
          throw new Error("key unusable");
        },
      },
    });
    const response = await handleRing(ringRequest(body), deps);
    expect(response.status).toBe(503);
    expect(((await response.json()) as RingErrorResponse).error).toBe("push_unavailable");
  });

  test("refuses a body too large to be a ring", async () => {
    const request = new Request(`http://gateway${RING_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${deploymentToken}`, "content-length": "99999" },
      body: JSON.stringify(body),
    });
    expect((await handleRing(request, await makeDeps())).status).toBe(400);
  });
});
