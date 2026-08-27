import { describe, expect, test } from "bun:test";
import {
  createMessagePusher,
  deliveryOf,
  MESSAGE_BODY,
  MESSAGE_TITLE,
  type MessagePushPayload,
  messageHeaders,
  messagePayloadOf,
} from "./message";

const pushkey = "d".repeat(64);
const otherPushkey = "e".repeat(64);
const jwt = { token: async () => "signed.jwt.value" };

const payload = messagePayloadOf("!room:kazimo.dev", "$anEvent", null);

describe("messagePayloadOf", () => {
  test("carries the ids the extension needs and never the message itself", () => {
    expect(payload).toEqual({
      aps: {
        "mutable-content": 1,
        alert: { title: MESSAGE_TITLE, body: MESSAGE_BODY },
        sound: "default",
      },
      room_id: "!room:kazimo.dev",
      event_id: "$anEvent",
    } satisfies MessagePushPayload);
    expect(Object.keys(payload).sort()).toEqual(["aps", "event_id", "room_id"]);
  });

  test("asks for a mutable alert so the extension can replace it", () => {
    expect(payload.aps["mutable-content"]).toBe(1);
  });

  test("badges the app when the homeserver counted unread messages", () => {
    expect(messagePayloadOf("!room:kazimo.dev", "$anEvent", 3).aps.badge).toBe(3);
    expect(messagePayloadOf("!room:kazimo.dev", "$anEvent", 0).aps.badge).toBe(0);
    expect(payload.aps.badge).toBeUndefined();
  });
});

describe("messageHeaders", () => {
  test("sends an alert on the bare bundle topic, never the voip one", () => {
    const headers = messageHeaders("jwt", "dev.kazimo.family", 1700086400);
    expect(headers["apns-topic"]).toBe("dev.kazimo.family");
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-priority"]).toBe("10");
    expect(headers["apns-expiration"]).toBe("1700086400");
    expect(headers.authorization).toBe("bearer jwt");
  });
});

describe("deliveryOf", () => {
  test("keeps the pushkey next to its outcome", () => {
    expect(deliveryOf(pushkey, 200, "")).toEqual({
      pushkey,
      ok: true,
      status: 200,
      reason: null,
      stale: false,
    });
  });

  test("flags the tokens apple says are gone for good", () => {
    expect(deliveryOf(pushkey, 410, '{"reason":"Unregistered"}').stale).toBe(true);
    expect(deliveryOf(pushkey, 400, '{"reason":"BadDeviceToken"}').stale).toBe(true);
    expect(deliveryOf(pushkey, 400, '{"reason":"DeviceTokenNotForTopic"}').stale).toBe(true);
  });

  test("leaves a transient failure alone", () => {
    expect(deliveryOf(pushkey, 429, '{"reason":"TooManyRequests"}').stale).toBe(false);
    expect(deliveryOf(pushkey, 503, "").stale).toBe(false);
  });
});

describe("createMessagePusher", () => {
  test("pushes once per device and reports each pushkey", async () => {
    const seen: string[] = [];
    const pusher = createMessagePusher({
      host: "https://apns.test",
      topic: "dev.kazimo.family",
      jwt,
      transport: async (url) => {
        seen.push(url);
        return url.endsWith(otherPushkey)
          ? new Response('{"reason":"Unregistered"}', { status: 410 })
          : new Response("", { status: 200 });
      },
    });
    const deliveries = await pusher.push([pushkey, otherPushkey], payload, 1700086400);
    expect(seen).toEqual([
      `https://apns.test/3/device/${pushkey}`,
      `https://apns.test/3/device/${otherPushkey}`,
    ]);
    expect(deliveries.map((delivery) => delivery.pushkey)).toEqual([pushkey, otherPushkey]);
    expect(deliveries[1]?.stale).toBe(true);
  });

  test("sends the signed jwt with the alert body", async () => {
    const bodies: string[] = [];
    const authorizations: string[] = [];
    const pusher = createMessagePusher({
      host: "https://apns.test",
      topic: "dev.kazimo.family",
      jwt,
      transport: async (_url, init) => {
        bodies.push(String(init.body));
        authorizations.push((init.headers as Record<string, string>).authorization as string);
        return new Response("", { status: 200 });
      },
    });
    await pusher.push([pushkey], payload, 1700086400);
    expect(JSON.parse(bodies[0] as string).event_id).toBe("$anEvent");
    expect(authorizations[0]).toBe("bearer signed.jwt.value");
  });

  test("reports an unreachable apns instead of throwing", async () => {
    const pusher = createMessagePusher({
      host: "https://apns.test",
      topic: "dev.kazimo.family",
      jwt,
      transport: async () => {
        throw new Error("socket closed");
      },
    });
    const deliveries = await pusher.push([pushkey], payload, 1700086400);
    expect(deliveries[0]?.ok).toBe(false);
    expect(deliveries[0]?.stale).toBe(false);
  });
});
