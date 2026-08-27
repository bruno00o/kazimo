import { describe, expect, test } from "bun:test";
import { createRateLimiter } from "./limit";
import type { MessageDelivery, MessagePushPayload } from "./message";
import {
  handleNotify,
  type MatrixErrorResponse,
  NOTIFY_PATH,
  type NotifyHandlerDeps,
  type NotifyResponse,
  parseNotifyRequest,
} from "./notify";

const appId = "dev.kazimo.family";
const pushkey = "1".repeat(64);
const otherPushkey = "2".repeat(64);

const notification = (over: Record<string, unknown> = {}, devices: unknown[] = []) => ({
  notification: {
    event_id: "$anEvent",
    room_id: "!room:kazimo.dev",
    counts: { unread: 2 },
    prio: "high",
    devices: devices.length > 0 ? devices : [{ app_id: appId, pushkey, pushkey_ts: 0, data: {} }],
    ...over,
  },
});

const delivered = (keys: string[]): MessageDelivery[] =>
  keys.map((key) => ({ pushkey: key, ok: true, status: 200, reason: null, stale: false }));

const makeDeps = (over: Partial<NotifyHandlerDeps> = {}): NotifyHandlerDeps => ({
  appId,
  pusher: { push: async (pushkeys) => delivered([...pushkeys]) },
  limiter: createRateLimiter(10),
  lifetimeSeconds: 86_400,
  now: () => 1_700_000_000_000,
  onLog: () => {},
  ...over,
});

const notifyRequest = (payload: unknown) =>
  new Request(`http://gateway${NOTIFY_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

describe("parseNotifyRequest", () => {
  test("reads the event_id_only shape the family pusher registers", () => {
    expect(parseNotifyRequest(notification())).toEqual({
      eventId: "$anEvent",
      roomId: "!room:kazimo.dev",
      unread: 2,
      devices: [{ appId, pushkey }],
    });
  });

  test("treats a notification without an event as a badge only update", () => {
    const parsed = parseNotifyRequest(notification({ event_id: undefined, room_id: undefined }));
    expect(parsed?.eventId).toBeNull();
    expect(parsed?.roomId).toBeNull();
  });

  test("refuses a body that is not a push gateway notification", () => {
    expect(parseNotifyRequest({})).toBeNull();
    expect(parseNotifyRequest({ notification: {} })).toBeNull();
    expect(parseNotifyRequest(notification({ devices: [{ pushkey }] }))).toBeNull();
    expect(parseNotifyRequest(notification({ devices: [{ app_id: appId }] }))).toBeNull();
    expect(parseNotifyRequest(notification({ devices: [{ app_id: "", pushkey }] }))).toBeNull();
  });

  test("drops ids that are not matrix ids rather than trusting them", () => {
    expect(parseNotifyRequest(notification({ room_id: "room" }))?.roomId).toBeNull();
    expect(parseNotifyRequest(notification({ event_id: "anEvent" }))?.eventId).toBeNull();
    expect(parseNotifyRequest(notification({ counts: { unread: -1 } }))?.unread).toBeNull();
    expect(parseNotifyRequest(notification({ counts: {} }))?.unread).toBeNull();
  });
});

describe("handleNotify", () => {
  test("alerts the device and rejects nothing", async () => {
    const response = await handleNotify(notifyRequest(notification()), makeDeps());
    expect(response.status).toBe(200);
    expect(((await response.json()) as NotifyResponse).rejected).toEqual([]);
  });

  test("sends only the room and the event, never any content", async () => {
    const sent: MessagePushPayload[] = [];
    let seenExpiry = 0;
    await handleNotify(
      notifyRequest(notification()),
      makeDeps({
        pusher: {
          push: async (pushkeys, payload, expiresAt) => {
            sent.push(payload);
            seenExpiry = expiresAt;
            return delivered([...pushkeys]);
          },
        },
      }),
    );
    expect(sent[0]).toEqual({
      aps: {
        "mutable-content": 1,
        alert: { title: "Kazimo", body: "New message" },
        sound: "default",
        badge: 2,
      },
      room_id: "!room:kazimo.dev",
      event_id: "$anEvent",
    });
    expect(seenExpiry).toBe(1_700_000_000 + 86_400);
  });

  test("ignores devices registered by another app id", async () => {
    let pushed: readonly string[] = [];
    const response = await handleNotify(
      notifyRequest(
        notification({}, [
          { app_id: `${appId}.voip`, pushkey: otherPushkey },
          { app_id: appId, pushkey },
        ]),
      ),
      makeDeps({
        pusher: {
          push: async (pushkeys) => {
            pushed = pushkeys;
            return delivered([...pushkeys]);
          },
        },
      }),
    );
    expect(pushed).toEqual([pushkey]);
    expect(((await response.json()) as NotifyResponse).rejected).toEqual([]);
  });

  test("rejects a pushkey apple has retired so synapse forgets the pusher", async () => {
    const response = await handleNotify(
      notifyRequest(notification({}, [{ app_id: appId, pushkey }])),
      makeDeps({
        pusher: {
          push: async (pushkeys) =>
            [...pushkeys].map((key) => ({
              pushkey: key,
              ok: false,
              status: 410,
              reason: "Unregistered",
              stale: true,
            })),
        },
      }),
    );
    expect(((await response.json()) as NotifyResponse).rejected).toEqual([pushkey]);
  });

  test("rejects a pushkey that cannot be an apns device token", async () => {
    let pushed = false;
    const response = await handleNotify(
      notifyRequest(notification({}, [{ app_id: appId, pushkey: "not-a-token" }])),
      makeDeps({
        pusher: {
          push: async (pushkeys) => {
            pushed = true;
            return delivered([...pushkeys]);
          },
        },
      }),
    );
    expect(pushed).toBe(false);
    expect(((await response.json()) as NotifyResponse).rejected).toEqual(["not-a-token"]);
  });

  test("accepts a badge only notification without waking apns", async () => {
    let pushed = false;
    const response = await handleNotify(
      notifyRequest(notification({ event_id: undefined, room_id: undefined })),
      makeDeps({
        pusher: {
          push: async (pushkeys) => {
            pushed = true;
            return delivered([...pushkeys]);
          },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(pushed).toBe(false);
    expect(((await response.json()) as NotifyResponse).rejected).toEqual([]);
  });

  test("answers a matrix error when the body is not a notification", async () => {
    const response = await handleNotify(notifyRequest({ hello: true }), makeDeps());
    expect(response.status).toBe(400);
    expect(((await response.json()) as MatrixErrorResponse).errcode).toBe("M_BAD_JSON");
  });

  test("refuses a body too large to be a notification", async () => {
    const request = new Request(`http://gateway${NOTIFY_PATH}`, {
      method: "POST",
      headers: { "content-length": "999999" },
      body: JSON.stringify(notification()),
    });
    expect((await handleNotify(request, makeDeps())).status).toBe(400);
  });

  test("lets synapse retry when the push service is unavailable", async () => {
    const response = await handleNotify(
      notifyRequest(notification()),
      makeDeps({
        pusher: {
          push: async () => {
            throw new Error("key unusable");
          },
        },
      }),
    );
    expect(response.status).toBe(502);
    expect(((await response.json()) as MatrixErrorResponse).errcode).toBe("M_UNKNOWN");
  });

  test("throttles a flood on one device without ever rejecting it", async () => {
    const deps = makeDeps({ limiter: createRateLimiter(1) });
    expect((await handleNotify(notifyRequest(notification()), deps)).status).toBe(200);
    const second = await handleNotify(notifyRequest(notification()), deps);
    expect(second.status).toBe(200);
    expect(((await second.json()) as NotifyResponse).rejected).toEqual([]);
  });

  test("pushes once when the same device is listed twice", async () => {
    let pushed: readonly string[] = [];
    await handleNotify(
      notifyRequest(
        notification({}, [
          { app_id: appId, pushkey },
          { app_id: appId, pushkey },
        ]),
      ),
      makeDeps({
        pusher: {
          push: async (pushkeys) => {
            pushed = pushkeys;
            return delivered([...pushkeys]);
          },
        },
      }),
    );
    expect(pushed).toEqual([pushkey]);
  });
});
