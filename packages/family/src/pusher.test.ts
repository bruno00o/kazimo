import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";

mock.module("expo-localization", () => ({
  getLocales: () => [{ languageTag: "pt-PT" }],
}));

const { stringsFor } = await import("./i18n");
const { notifyUrlOf, PUSHER_APP_ID, PUSHER_FORMAT, pusherBodyOf, pusherFingerprintOf, setPusher } =
  await import("./pusher");

const HOMESERVER = "https://matrix.example.org";
const GATEWAY = "https://push.example.org";
const PUSHKEY = "a1b2c3";

const strings = stringsFor("pt-PT");

type Call = { url: string; init: RequestInit | undefined };

const realFetch = globalThis.fetch;

let calls: Call[] = [];
let responses: Response[] = [];

const fakeClient = (accessToken: string): ClientLike =>
  ({
    session: () => ({ accessToken }),
    encryption: () => ({ backupExistsOnServer: async () => true }),
  }) as unknown as ClientLike;

beforeEach(() => {
  calls = [];
  responses = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return responses.shift() ?? new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("notify url", () => {
  test("appends the push spec path to a bare gateway", () => {
    expect(notifyUrlOf(GATEWAY)).toBe(`${GATEWAY}/_matrix/push/v1/notify`);
    expect(notifyUrlOf(`${GATEWAY}/`)).toBe(`${GATEWAY}/_matrix/push/v1/notify`);
    expect(notifyUrlOf(` ${GATEWAY} `)).toBe(`${GATEWAY}/_matrix/push/v1/notify`);
  });

  test("keeps a gateway that already names the path", () => {
    const full = `${GATEWAY}/_matrix/push/v1/notify`;
    expect(notifyUrlOf(full)).toBe(full);
  });
});

describe("pusher body", () => {
  const body = pusherBodyOf({
    gateway: GATEWAY,
    pushkey: PUSHKEY,
    deviceName: "Kazimo",
    strings,
  });

  test("follows the gateway contract", () => {
    expect(body.app_id).toBe(PUSHER_APP_ID);
    expect(body.kind).toBe("http");
    expect(body.pushkey).toBe(PUSHKEY);
    expect(body.data.format).toBe(PUSHER_FORMAT);
    expect(body.data.url).toBe(`${GATEWAY}/_matrix/push/v1/notify`);
  });

  test("ships a mutable payload the extension can rewrite", () => {
    expect(body.data.default_payload.aps["mutable-content"]).toBe(1);
    expect(body.data.default_payload.aps.alert.body).toBe(strings.newMessage);
  });

  test("does not append to another device pusher", () => {
    expect(body.append).toBe(false);
  });
});

describe("fingerprint", () => {
  test("changes with the token, the gateway and the homeserver", () => {
    const base = pusherFingerprintOf(HOMESERVER, GATEWAY, PUSHKEY);
    expect(pusherFingerprintOf(HOMESERVER, GATEWAY, PUSHKEY)).toBe(base);
    expect(pusherFingerprintOf(HOMESERVER, GATEWAY, "other")).not.toBe(base);
    expect(pusherFingerprintOf(HOMESERVER, "https://other.example.org", PUSHKEY)).not.toBe(base);
    expect(pusherFingerprintOf("https://other.example.org", GATEWAY, PUSHKEY)).not.toBe(base);
  });

  test("ignores a trailing slash on the gateway", () => {
    expect(pusherFingerprintOf(HOMESERVER, `${GATEWAY}/`, PUSHKEY)).toBe(
      pusherFingerprintOf(HOMESERVER, GATEWAY, PUSHKEY),
    );
  });
});

describe("set pusher", () => {
  const body = pusherBodyOf({ gateway: GATEWAY, pushkey: PUSHKEY, deviceName: "Kazimo", strings });

  test("posts to the homeserver with the access token", async () => {
    await setPusher(fakeClient("token"), HOMESERVER, body);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${HOMESERVER}/_matrix/client/v3/pushers/set`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(body);
  });

  test("raises when the homeserver refuses", async () => {
    responses = [new Response(null, { status: 400 })];
    expect(setPusher(fakeClient("token"), HOMESERVER, body)).rejects.toThrow("pushers/set 400");
  });
});
