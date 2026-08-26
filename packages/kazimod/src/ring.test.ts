import { describe, expect, test } from "bun:test";
import {
  type Contact,
  parseRingRequest,
  RING_MAX_DEVICE_TOKENS,
  type RingDevices,
  type RingResponse,
} from "@kazimo/shared";
import type { RingConfig } from "./config";
import {
  mergedDeviceTokens,
  postRing,
  prunedRingDevices,
  type RingDeviceBook,
  ringContact,
  ringRequestFor,
  ringSummary,
  ringUrl,
  staleTokensOf,
} from "./ring";

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

const dynamicConfig: RingConfig = { ...config, deviceTokens: {} };
const published = "a".repeat(64);
const secondPublished = "b".repeat(64);

const silentBook = (): RingDeviceBook => ({
  tokens: () => [],
  forget: () => {},
  reportStale: () => {},
});

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

  test("rings the devices the family app published even without an env table", () => {
    const request = ringRequestFor(dynamicConfig, contact, callId, [published]);
    expect(request?.callee.deviceTokens).toEqual([published]);
    expect(parseRingRequest(request)).toEqual(request as never);
  });

  test("merges the env override with the published devices, env first, never twice", () => {
    expect(ringRequestFor(config, contact, callId, [published, deviceToken])?.callee.deviceTokens).toEqual([
      deviceToken,
      published,
    ]);
  });
});

describe("mergedDeviceTokens", () => {
  test("caps the merged list at what the gateway accepts", () => {
    const many = Array.from({ length: RING_MAX_DEVICE_TOKENS + 4 }, (_, index) =>
      index.toString(16).padStart(64, "0"),
    );
    expect(mergedDeviceTokens(dynamicConfig, contact.userId, many)).toHaveLength(RING_MAX_DEVICE_TOKENS);
  });

  test("an unknown contact has no device at all", () => {
    expect(mergedDeviceTokens(config, "@joao:kazimo.dev", [])).toEqual([]);
  });
});

describe("staleTokensOf", () => {
  test("maps the dead indexes back to the tokens that were rung", () => {
    const request = ringRequestFor(dynamicConfig, contact, callId, [published, secondPublished]);
    expect(
      staleTokensOf(request as never, {
        callId,
        results: [
          { index: 0, ok: true, status: 200, reason: null, stale: false },
          { index: 1, ok: false, status: 410, reason: "Unregistered", stale: true },
        ],
      }),
    ).toEqual([secondPublished]);
  });

  test("an index the request never had is ignored", () => {
    const request = ringRequestFor(dynamicConfig, contact, callId, [published]);
    expect(
      staleTokensOf(request as never, {
        callId,
        results: [{ index: 4, ok: false, status: 400, reason: "BadDeviceToken", stale: true }],
      }),
    ).toEqual([]);
  });
});

describe("prunedRingDevices", () => {
  test("drops the dead token and keeps the rest", () => {
    expect(
      prunedRingDevices({ [contact.userId]: [published, secondPublished] }, contact.userId, [published]),
    ).toEqual({ [contact.userId]: [secondPublished] });
  });

  test("a contact with no device left disappears from the table", () => {
    expect(prunedRingDevices({ [contact.userId]: [published] }, contact.userId, [published])).toEqual({});
  });

  test("pruning nothing known returns the very same table", () => {
    const devices = { [contact.userId]: [published] };
    expect(prunedRingDevices(devices, contact.userId, [secondPublished])).toBe(devices);
    expect(prunedRingDevices(devices, "@joao:kazimo.dev", [published])).toBe(devices);
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

const gatewayAnswering = (response: RingResponse): typeof fetch =>
  (async () => Response.json(response)) as unknown as typeof fetch;

const bookOver = (devices: RingDevices) => {
  const stale: Array<{ userId: string; tokens: string[] }> = [];
  let table = devices;
  const book: RingDeviceBook = {
    tokens: (userId) => table[userId] ?? [],
    forget: (userId, tokens) => {
      table = prunedRingDevices(table, userId, tokens);
    },
    reportStale: (userId, tokens) => {
      stale.push({ userId, tokens });
    },
  };
  return { book, stale, devices: () => table };
};

describe("ringContact", () => {
  test("does nothing at all when the gateway is not configured", () => {
    expect(() => ringContact(null, contact, callId, silentBook())).not.toThrow();
  });

  test("forgets a dead published token and tells the screen to rewrite the event", async () => {
    const kept = bookOver({ [contact.userId]: [published, secondPublished] });
    await ringContact(
      dynamicConfig,
      contact,
      callId,
      kept.book,
      gatewayAnswering({
        callId,
        results: [
          { index: 0, ok: false, status: 410, reason: "Unregistered", stale: true },
          { index: 1, ok: true, status: 200, reason: null, stale: false },
        ],
      }),
    );
    expect(kept.devices()).toEqual({ [contact.userId]: [secondPublished] });
    expect(kept.stale).toEqual([{ userId: contact.userId, tokens: [published] }]);
  });

  test("a dead token that only the env override knows is never reported to the screen", async () => {
    const kept = bookOver({});
    await ringContact(
      config,
      contact,
      callId,
      kept.book,
      gatewayAnswering({
        callId,
        results: [{ index: 0, ok: false, status: 400, reason: "BadDeviceToken", stale: true }],
      }),
    );
    expect(kept.devices()).toEqual({});
    expect(kept.stale).toEqual([]);
  });

  test("nothing is forgotten when every device rang", async () => {
    const kept = bookOver({ [contact.userId]: [published] });
    await ringContact(
      dynamicConfig,
      contact,
      callId,
      kept.book,
      gatewayAnswering({
        callId,
        results: [{ index: 0, ok: true, status: 200, reason: null, stale: false }],
      }),
    );
    expect(kept.devices()).toEqual({ [contact.userId]: [published] });
    expect(kept.stale).toEqual([]);
  });
});
