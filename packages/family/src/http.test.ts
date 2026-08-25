import { afterEach, describe, expect, test } from "bun:test";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { authorizedFetch, UnauthorizedError, withBearer } from "./http";

const URL = "https://matrix.kazimo.test/_matrix/client/v3/rooms/!room/state";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Attempt = { authorization: string | undefined; method: string | undefined };

const fakeClient = (tokens: string[], onProbe: () => void): ClientLike => {
  let index = 0;
  return {
    session: () => ({ accessToken: tokens[Math.min(index, tokens.length - 1)] }),
    encryption: () => ({
      backupExistsOnServer: async () => {
        index += 1;
        onProbe();
        return true;
      },
    }),
  } as unknown as ClientLike;
};

const stubFetch = (statuses: number[], attempts: Attempt[]) => {
  let call = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    attempts.push({ authorization: headers.get("Authorization") ?? undefined, method: init?.method });
    const status = statuses[Math.min(call, statuses.length - 1)] ?? 200;
    call += 1;
    return new Response(null, { status });
  }) as typeof fetch;
};

describe("withBearer", () => {
  test("adds the token beside the caller headers", () => {
    const request = withBearer({ method: "PUT", headers: { "Content-Type": "application/json" } }, "token");
    expect(request.method).toBe("PUT");
    expect(request.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    });
  });
});

describe("authorizedFetch", () => {
  test("sends the current token and returns the first response", async () => {
    const attempts: Attempt[] = [];
    stubFetch([200], attempts);
    let probes = 0;
    const response = await authorizedFetch(
      fakeClient(["first"], () => probes++),
      URL,
    );
    expect(response.status).toBe(200);
    expect(attempts).toEqual([{ authorization: "Bearer first", method: undefined }]);
    expect(probes).toBe(0);
  });

  test("renews the token and retries once on an expired token", async () => {
    const attempts: Attempt[] = [];
    stubFetch([401, 200], attempts);
    let probes = 0;
    const response = await authorizedFetch(
      fakeClient(["stale", "renewed"], () => probes++),
      URL,
      { method: "PUT" },
    );
    expect(response.status).toBe(200);
    expect(probes).toBe(1);
    expect(attempts).toEqual([
      { authorization: "Bearer stale", method: "PUT" },
      { authorization: "Bearer renewed", method: "PUT" },
    ]);
  });

  test("gives the retried response back even when it fails again", async () => {
    const attempts: Attempt[] = [];
    stubFetch([401, 401], attempts);
    const response = await authorizedFetch(
      fakeClient(["stale", "stale"], () => undefined),
      URL,
    );
    expect(response.status).toBe(401);
    expect(attempts.length).toBe(2);
  });
});

describe("UnauthorizedError", () => {
  test("names its source and stays matchable", () => {
    const error = new UnauthorizedError("whoami");
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.name).toBe("UnauthorizedError");
    expect(error.message).toBe("whoami unauthorized");
  });
});
