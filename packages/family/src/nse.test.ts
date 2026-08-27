import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Strings } from "./i18n";

const nativeStore = new Map<string, string>();

mock.module("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 0,
  getItemAsync: async (key: string) => nativeStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    nativeStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    nativeStore.delete(key);
  },
}));

const {
  clearNseCredentials,
  isNseCredentials,
  loadNseCredentials,
  nseCredentialsOf,
  publishNseCredentials,
  refreshNseAccessToken,
  withAccessToken,
} = await import("./nse");

const paths = { dataPath: "/group/matrix-data", cachePath: "/group/matrix-cache" };

const strings = { newMessage: "Nova mensagem", photo: "Foto" } as Strings;

const labels = { messageLabel: strings.newMessage, photoLabel: strings.photo };

const session = {
  homeserver: "https://matrix.example.org",
  userId: "@maria:example.org",
  deviceId: "ABCDEF",
  accessToken: "first",
};

beforeEach(() => {
  nativeStore.clear();
});

describe("credentials shape", () => {
  test("carries what the extension needs to reopen the session", () => {
    expect(nseCredentialsOf(session, paths, strings)).toEqual({ ...session, ...paths, ...labels });
  });

  test("rejects anything missing a field", () => {
    expect(isNseCredentials(nseCredentialsOf(session, paths, strings))).toBe(true);
    expect(isNseCredentials({ ...nseCredentialsOf(session, paths, strings), accessToken: undefined })).toBe(
      false,
    );
    expect(isNseCredentials(null)).toBe(false);
    expect(isNseCredentials("nope")).toBe(false);
  });

  test("swaps the access token without touching the paths", () => {
    expect(withAccessToken(nseCredentialsOf(session, paths, strings), "second")).toEqual({
      ...session,
      ...paths,
      ...labels,
      accessToken: "second",
    });
  });
});

describe("shared keychain", () => {
  test("round trips", async () => {
    await publishNseCredentials(nseCredentialsOf(session, paths, strings));
    expect(await loadNseCredentials()).toEqual({ ...session, ...paths, ...labels });
  });

  test("reads nothing when the store is empty", async () => {
    expect(await loadNseCredentials()).toBeNull();
  });

  test("ignores a corrupted entry", async () => {
    await publishNseCredentials(nseCredentialsOf(session, paths, strings));
    for (const key of nativeStore.keys()) nativeStore.set(key, "{oops");
    expect(await loadNseCredentials()).toBeNull();
  });

  test("follows a rotated access token", async () => {
    await publishNseCredentials(nseCredentialsOf(session, paths, strings));
    await refreshNseAccessToken("second");
    expect((await loadNseCredentials())?.accessToken).toBe("second");
  });

  test("does not resurrect credentials after sign out", async () => {
    await publishNseCredentials(nseCredentialsOf(session, paths, strings));
    await clearNseCredentials();
    await refreshNseAccessToken("second");
    expect(await loadNseCredentials()).toBeNull();
  });
});
