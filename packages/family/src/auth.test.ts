import { describe, expect, mock, test } from "bun:test";
import { TokenRefreshLogoutError } from "matrix-js-sdk";
import type { SecretStore, StoredSession } from "./auth";

class FakeTokenError extends Error {}

type FakeTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  issuedAt?: number;
};

const refreshCalls: { clientId: string; refreshToken?: string; tokenEndpoint?: string }[] = [];
let refreshResult: () => FakeTokenResponse = () => {
  throw new Error("refreshResult not configured");
};

mock.module("expo-auth-session", () => ({
  AuthRequest: class {},
  CodeChallengeMethod: { S256: "S256", Plain: "plain" },
  ResponseType: { Code: "code", Token: "token" },
  TokenTypeHint: { AccessToken: "access_token", RefreshToken: "refresh_token" },
  TokenError: FakeTokenError,
  makeRedirectUri: ({ native }: { native?: string }) => native ?? "",
  exchangeCodeAsync: async () => {
    throw new Error("not used in tests");
  },
  refreshAsync: async (
    config: { clientId: string; refreshToken?: string },
    discovery: { tokenEndpoint?: string },
  ) => {
    refreshCalls.push({ ...config, tokenEndpoint: discovery.tokenEndpoint });
    return refreshResult();
  },
  revokeAsync: async () => true,
}));

mock.module("expo-crypto", () => ({
  getRandomValues: <T extends Uint8Array>(array: T): T => array.fill(7),
}));

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
  accessTokensOf,
  authMetadataOf,
  deviceIdFrom,
  discoveryDocumentOf,
  expiresAtOf,
  EXPIRY_MARGIN_MS,
  isExpiringSoon,
  normalizeHomeserver,
  REDIRECT_URI,
  refreshSession,
  scopesFor,
  sessionStoreOf,
  withTokens,
} = await import("./auth");

const ISSUER = "https://auth.kazimo.test/";

const validMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}authorize`,
  token_endpoint: `${ISSUER}oauth2/token`,
  revocation_endpoint: `${ISSUER}oauth2/revoke`,
  registration_endpoint: `${ISSUER}oauth2/registration`,
  response_modes_supported: ["query", "fragment"],
  response_types_supported: ["code"],
  grant_types_supported: [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code",
  ],
  code_challenge_methods_supported: ["S256"],
};

const sessionOf = (overrides: Partial<StoredSession> = {}): StoredSession => ({
  homeserver: "https://matrix.kazimo.test",
  issuer: ISSUER,
  tokenEndpoint: `${ISSUER}oauth2/token`,
  revocationEndpoint: `${ISSUER}oauth2/revoke`,
  clientId: "01JAYS0N5TATIC00000000CVSD",
  deviceId: "ABCDEFGHIJ",
  accessToken: "mat_old",
  refreshToken: "mar_old",
  expiresAt: 1_000_000,
  ...overrides,
});

describe("normalizeHomeserver", () => {
  test("prefixes https and strips trailing slashes", () => {
    expect(normalizeHomeserver(" matrix.kazimo.test/ ")).toBe("https://matrix.kazimo.test");
  });

  test("keeps an explicit scheme", () => {
    expect(normalizeHomeserver("http://localhost:8008")).toBe("http://localhost:8008");
  });

  test("rejects an empty input", () => {
    expect(() => normalizeHomeserver("  ")).toThrow("homeserver missing");
  });
});

describe("auth metadata", () => {
  test("accepts valid MAS metadata", () => {
    expect(authMetadataOf(validMetadata).issuer).toBe(ISSUER);
  });

  test("rejects metadata without a token endpoint", () => {
    const { token_endpoint: _, ...incomplete } = validMetadata;
    expect(() => authMetadataOf(incomplete)).toThrow("auth metadata invalid");
  });

  test("rejects metadata without S256", () => {
    expect(() => authMetadataOf({ ...validMetadata, code_challenge_methods_supported: ["plain"] })).toThrow(
      "auth metadata invalid",
    );
  });

  test("maps to an expo discovery document", () => {
    expect(discoveryDocumentOf(authMetadataOf(validMetadata))).toEqual({
      authorizationEndpoint: `${ISSUER}authorize`,
      tokenEndpoint: `${ISSUER}oauth2/token`,
      revocationEndpoint: `${ISSUER}oauth2/revoke`,
      registrationEndpoint: `${ISSUER}oauth2/registration`,
    });
  });
});

describe("scopes", () => {
  test("requests the Matrix API and device scopes", () => {
    expect(scopesFor("ABCDEFGHIJ")).toEqual([
      "urn:matrix:client:api:*",
      "urn:matrix:client:device:ABCDEFGHIJ",
    ]);
  });
});

describe("redirect uri", () => {
  test("uses the app scheme callback", () => {
    expect(REDIRECT_URI).toBe("kazimo://oidc/callback");
  });
});

describe("deviceIdFrom", () => {
  test("maps bytes to uppercase alphanumerics", () => {
    const bytes = new Uint8Array([0, 1, 25, 26, 35, 36, 71, 107, 143, 179]);
    expect(deviceIdFrom(bytes)).toBe("ABZ09A9999");
  });

  test("skips bytes that would bias the alphabet", () => {
    const bytes = new Uint8Array([252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(deviceIdFrom(bytes)).toBe("ABCDEFGHIJ");
  });

  test("throws when entropy runs out", () => {
    expect(() => deviceIdFrom(new Uint8Array([1, 2, 3]))).toThrow("not enough entropy");
  });
});

describe("token expiry", () => {
  test("derives expiresAt from issuedAt and expiresIn", () => {
    expect(expiresAtOf({ expiresIn: 300, issuedAt: 1_000 }, 999_999)).toBe(1_000 * 1000 + 300 * 1000);
  });

  test("falls back to the local clock without issuedAt", () => {
    expect(expiresAtOf({ expiresIn: 300, issuedAt: undefined }, 50_000)).toBe(50_000 + 300 * 1000);
  });

  test("is null when the server gives no lifetime", () => {
    expect(expiresAtOf({ expiresIn: undefined, issuedAt: 1_000 }, 0)).toBeNull();
  });

  test("withTokens keeps the previous refresh token when none is returned", () => {
    const next = withTokens(sessionOf(), { accessToken: "mat_new", refreshToken: undefined }, 0);
    expect(next.accessToken).toBe("mat_new");
    expect(next.refreshToken).toBe("mar_old");
    expect(next.expiresAt).toBeNull();
  });

  test("isExpiringSoon respects the margin", () => {
    expect(isExpiringSoon({ expiresAt: 100_000 + EXPIRY_MARGIN_MS + 1 }, 100_000)).toBe(false);
    expect(isExpiringSoon({ expiresAt: 100_000 + EXPIRY_MARGIN_MS - 1 }, 100_000)).toBe(true);
    expect(isExpiringSoon({ expiresAt: null }, 100_000)).toBe(false);
  });

  test("accessTokensOf matches the SDK shape", () => {
    expect(accessTokensOf(sessionOf())).toEqual({
      accessToken: "mat_old",
      refreshToken: "mar_old",
      expiry: new Date(1_000_000),
    });
    expect(accessTokensOf(sessionOf({ refreshToken: null, expiresAt: null }))).toEqual({
      accessToken: "mat_old",
      refreshToken: undefined,
      expiry: undefined,
    });
  });
});

describe("session store", () => {
  const fakeStore = (): { store: SecretStore; values: Map<string, string> } => {
    const values = new Map<string, string>();
    return {
      values,
      store: {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value);
        },
        remove: async (key) => {
          values.delete(key);
        },
      },
    };
  };

  test("round trips a session", async () => {
    const { store } = fakeStore();
    const sessions = sessionStoreOf(store);
    const session = sessionOf();
    await sessions.save(session);
    expect(await sessions.load()).toEqual(session);
  });

  test("clear removes the session", async () => {
    const { store, values } = fakeStore();
    const sessions = sessionStoreOf(store);
    await sessions.save(sessionOf());
    await sessions.clear();
    expect(values.size).toBe(0);
    expect(await sessions.load()).toBeNull();
  });

  test("returns null for missing or corrupt payloads", async () => {
    const { store, values } = fakeStore();
    const sessions = sessionStoreOf(store);
    expect(await sessions.load()).toBeNull();
    values.set("kazimo.session", "not json");
    expect(await sessions.load()).toBeNull();
    values.set("kazimo.session", JSON.stringify({ homeserver: 42 }));
    expect(await sessions.load()).toBeNull();
  });
});

describe("refreshSession", () => {
  test("persists rotated tokens", async () => {
    nativeStore.clear();
    refreshResult = () => ({ accessToken: "mat_new", refreshToken: "mar_new", expiresIn: 300 });
    const refreshed = await refreshSession(sessionOf());
    expect(refreshed.accessToken).toBe("mat_new");
    expect(refreshed.refreshToken).toBe("mar_new");
    expect(refreshCalls.at(-1)).toEqual({
      clientId: "01JAYS0N5TATIC00000000CVSD",
      refreshToken: "mar_old",
      tokenEndpoint: `${ISSUER}oauth2/token`,
    });
    const persisted = JSON.parse(nativeStore.get("kazimo.session") ?? "{}") as { accessToken?: string };
    expect(persisted.accessToken).toBe("mat_new");
  });

  test("signals logout when the refresh token is rejected", async () => {
    refreshResult = () => {
      throw new FakeTokenError("invalid_grant");
    };
    await expect(refreshSession(sessionOf())).rejects.toBeInstanceOf(TokenRefreshLogoutError);
  });

  test("signals logout when no refresh token exists", async () => {
    await expect(refreshSession(sessionOf({ refreshToken: null }))).rejects.toBeInstanceOf(
      TokenRefreshLogoutError,
    );
  });

  test("lets transient failures through for retry", async () => {
    refreshResult = () => {
      throw new Error("network request failed");
    };
    await expect(refreshSession(sessionOf())).rejects.toThrow("network request failed");
  });
});
