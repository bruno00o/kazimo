import { afterEach, describe, expect, test } from "bun:test";
import { backupExistsOnServerRaw, recoveryKeyRows } from "./e2ee";

const HOMESERVER = "https://matrix.example.org";
const TOKEN = "syt_token";

const realFetch = globalThis.fetch;

type Call = { url: string; authorization: string | undefined };

const stubFetch = (status: number, calls: Call[]) => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("Authorization") ?? undefined });
    return new Response(null, { status });
  }) as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("backupExistsOnServerRaw", () => {
  test("reads the backup version endpoint with the bearer token", async () => {
    const calls: Call[] = [];
    stubFetch(200, calls);
    expect(await backupExistsOnServerRaw(HOMESERVER, TOKEN)).toBe(true);
    expect(calls).toEqual([
      {
        url: `${HOMESERVER}/_matrix/client/v3/room_keys/version`,
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
  });

  test("treats a missing version as no backup", async () => {
    stubFetch(404, []);
    expect(await backupExistsOnServerRaw(HOMESERVER, TOKEN)).toBe(false);
  });

  test("keeps the existing backup when the server answers anything else", async () => {
    stubFetch(500, []);
    expect(await backupExistsOnServerRaw(HOMESERVER, TOKEN)).toBe(true);
  });

  test("tolerates a trailing slash on the homeserver", async () => {
    const calls: Call[] = [];
    stubFetch(200, calls);
    await backupExistsOnServerRaw(`${HOMESERVER}/`, TOKEN);
    expect(calls[0]?.url).toBe(`${HOMESERVER}/_matrix/client/v3/room_keys/version`);
  });
});

describe("recoveryKeyRows", () => {
  test("splits twelve groups into rows of four", () => {
    const key = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll";
    expect(recoveryKeyRows(key)).toEqual([
      "aaaa bbbb cccc dddd",
      "eeee ffff gggg hhhh",
      "iiii jjjj kkkk llll",
    ]);
  });

  test("keeps a partial last row", () => {
    expect(recoveryKeyRows("aaaa bbbb cccc dddd eeee")).toEqual(["aaaa bbbb cccc dddd", "eeee"]);
  });

  test("ignores surrounding and repeated whitespace", () => {
    expect(recoveryKeyRows("  aaaa   bbbb  ")).toEqual(["aaaa bbbb"]);
  });

  test("returns nothing for an empty key", () => {
    expect(recoveryKeyRows("")).toEqual([]);
  });
});
