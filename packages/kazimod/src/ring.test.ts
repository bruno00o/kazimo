import { describe, expect, test } from "bun:test";
import { type Contact, parseRingRequest, type RingResponse } from "@kazimo/shared";
import type { RingConfig } from "./config";
import { postRing, ringContact, ringRequestFor, ringSummary, ringUrl } from "./ring";

const deviceToken = "f".repeat(64);
const callId = "11111111-2222-3333-4444-555555555555";

const contact: Contact = {
  userId: "@ana:kazimo.dev",
  displayName: "Ana",
  roomId: "!dm:kazimo.dev",
};

const config: RingConfig = {
  url: "https://ring.kazimo.dev",
  token: "a-deployment-secret",
  callerName: "Vovo",
  deviceTokens: { "@ana:kazimo.dev": [deviceToken] },
};

describe("ringRequestFor", () => {
  test("builds a request the gateway accepts", () => {
    const request = ringRequestFor(config, contact, callId);
    expect(request).not.toBeNull();
    expect(parseRingRequest(request)).toEqual(request as never);
  });

  test("names the frame as the caller, not the person being called", () => {
    expect(ringRequestFor(config, contact, callId)?.caller.name).toBe("Vovo");
  });

  test("stays silent for a contact with no device token", () => {
    expect(ringRequestFor(config, { ...contact, userId: "@joao:kazimo.dev" }, callId)).toBeNull();
    expect(ringRequestFor({ ...config, deviceTokens: {} }, contact, callId)).toBeNull();
  });
});

describe("ringUrl", () => {
  test("appends the ring path once, trailing slash or not", () => {
    expect(ringUrl("https://ring.kazimo.dev")).toBe("https://ring.kazimo.dev/ring");
    expect(ringUrl("https://ring.kazimo.dev/")).toBe("https://ring.kazimo.dev/ring");
  });
});

describe("postRing", () => {
  test("sends the deployment token as a bearer credential", async () => {
    let seen: Request | null = null;
    const request = ringRequestFor(config, contact, callId);
    await postRing(
      config,
      request as never,
      (async (url: string, init: RequestInit) => {
        seen = new Request(url, init);
        return Response.json({ callId, results: [] } satisfies RingResponse);
      }) as unknown as typeof fetch,
    );
    expect((seen as unknown as Request).headers.get("authorization")).toStartWith("Bearer ");
    expect((seen as unknown as Request).url).toBe("https://ring.kazimo.dev/ring");
  });

  test("reports null when the gateway refuses", async () => {
    const request = ringRequestFor(config, contact, callId);
    const response = await postRing(
      config,
      request as never,
      (async () => new Response("no", { status: 429 })) as unknown as typeof fetch,
    );
    expect(response).toBeNull();
  });
});

describe("ringSummary", () => {
  test("counts the devices that rang and points at the dead tokens by index", () => {
    const summary = ringSummary({
      callId,
      results: [
        { index: 0, ok: true, status: 200, reason: null, stale: false },
        { index: 1, ok: false, status: 410, reason: "Unregistered", stale: true },
      ],
    });
    expect(summary).toContain("1/2 devices rang");
    expect(summary).toContain("dead device tokens at 1");
  });

  test("never repeats a device token", () => {
    const summary = ringSummary({
      callId,
      results: [{ index: 0, ok: false, status: 400, reason: "BadDeviceToken", stale: true }],
    });
    expect(summary).not.toContain(deviceToken);
  });
});

describe("ringContact", () => {
  test("does nothing at all when the gateway is not configured", () => {
    expect(() => ringContact(null, contact, callId)).not.toThrow();
  });
});
