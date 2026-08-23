import {
  AuthRequest,
  CodeChallengeMethod,
  type DiscoveryDocument,
  exchangeCodeAsync,
  makeRedirectUri,
  ResponseType,
  refreshAsync,
  revokeAsync,
  TokenError,
  type TokenResponse,
  TokenTypeHint,
} from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { readOidcClientId } from "./env";
import { whoami } from "./session";

export type AuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  registration_endpoint: string;
};

export class TokenRefreshLogoutError extends Error {
  constructor(cause?: Error) {
    super(cause?.message ?? "");
    this.name = "TokenRefreshLogoutError";
  }
}

export type StoredSession = {
  homeserver: string;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

export type SecretStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type SessionStore = {
  load: () => Promise<StoredSession | null>;
  save: (session: StoredSession) => Promise<void>;
  clear: () => Promise<void>;
};

export class SignInCancelledError extends Error {
  constructor() {
    super("sign in cancelled");
  }
}

const APP_SCHEME = "kazimo";
const REDIRECT_PATH = "oidc/callback";
const NATIVE_REDIRECT_URI = `${APP_SCHEME}://${REDIRECT_PATH}`;
export const REDIRECT_URI = makeRedirectUri({
  native: NATIVE_REDIRECT_URI,
  scheme: APP_SCHEME,
  path: REDIRECT_PATH,
});

const CLIENT_METADATA = {
  client_name: "Kazimo",
  client_uri: "https://github.com/bruno00o/kazimo",
  application_type: "native",
  redirect_uris: [REDIRECT_URI],
  response_types: ["code"],
  grant_types: ["authorization_code", "refresh_token"],
  token_endpoint_auth_method: "none",
};
const MATRIX_API_SCOPE = "urn:matrix:client:api:*";
const MATRIX_DEVICE_SCOPE_PREFIX = "urn:matrix:client:device:";
const SESSION_KEY = "kazimo.session";
const DEVICE_ID_KEY = "kazimo.device";
const CLIENT_ID_KEY_PREFIX = "kazimo.oauth.client.";
const DEVICE_ID_LENGTH = 10;
const DEVICE_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEVICE_ID_ENTROPY_BYTES = DEVICE_ID_LENGTH * 2;
const SECONDS_TO_MS = 1000;
export const EXPIRY_MARGIN_MS = 60 * SECONDS_TO_MS;
const AUTH_METADATA_PATHS = [
  "/_matrix/client/v1/auth_metadata",
  "/_matrix/client/unstable/org.matrix.msc2965/auth_metadata",
];
const AUTH_ISSUER_PATH = "/_matrix/client/unstable/org.matrix.msc2965/auth_issuer";
const OPENID_CONFIGURATION_PATH = "/.well-known/openid-configuration";

export const normalizeHomeserver = (input: string): string => {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("homeserver missing");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasString = (record: Record<string, unknown>, key: string): boolean => typeof record[key] === "string";

const listIncludes = (record: Record<string, unknown>, key: string, value: string): boolean => {
  const list = record[key];
  return Array.isArray(list) && list.includes(value);
};

const REQUIRED_METADATA_STRINGS = [
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "revocation_endpoint",
  "registration_endpoint",
];

export const validateAuthMetadata = (value: unknown): value is AuthMetadata =>
  isRecord(value) &&
  REQUIRED_METADATA_STRINGS.every((key) => hasString(value, key)) &&
  listIncludes(value, "response_types_supported", "code") &&
  listIncludes(value, "code_challenge_methods_supported", "S256");

export const authMetadataOf = (json: unknown): AuthMetadata => {
  if (!validateAuthMetadata(json)) throw new Error("auth metadata invalid");
  return json;
};

export const discoveryDocumentOf = (metadata: AuthMetadata): DiscoveryDocument => ({
  authorizationEndpoint: metadata.authorization_endpoint,
  tokenEndpoint: metadata.token_endpoint,
  revocationEndpoint: metadata.revocation_endpoint,
  registrationEndpoint: metadata.registration_endpoint,
});

export const generateScope = (deviceId: string): string =>
  `${MATRIX_API_SCOPE} ${MATRIX_DEVICE_SCOPE_PREFIX}${deviceId}`;

export const scopesFor = (deviceId: string): string[] => generateScope(deviceId).split(" ");

export const deviceIdFrom = (randomBytes: Uint8Array): string => {
  const largestUnbiasedByte = 256 - (256 % DEVICE_ID_ALPHABET.length);
  let id = "";
  for (const byte of randomBytes) {
    if (id.length === DEVICE_ID_LENGTH) break;
    if (byte < largestUnbiasedByte) id += DEVICE_ID_ALPHABET[byte % DEVICE_ID_ALPHABET.length];
  }
  if (id.length < DEVICE_ID_LENGTH) throw new Error("not enough entropy for a device id");
  return id;
};

export type TokenGrant = Pick<TokenResponse, "accessToken" | "refreshToken" | "expiresIn"> & {
  issuedAt?: number;
};

export const expiresAtOf = (
  tokens: Pick<TokenGrant, "expiresIn" | "issuedAt">,
  receivedAtMs: number,
): number | null => {
  if (tokens.expiresIn === undefined) return null;
  const issuedAtMs = tokens.issuedAt ? tokens.issuedAt * SECONDS_TO_MS : receivedAtMs;
  return issuedAtMs + tokens.expiresIn * SECONDS_TO_MS;
};

export const withTokens = (
  session: StoredSession,
  tokens: TokenGrant,
  receivedAtMs: number,
): StoredSession => ({
  ...session,
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken ?? session.refreshToken,
  expiresAt: expiresAtOf(tokens, receivedAtMs),
});

export const isExpiringSoon = (session: Pick<StoredSession, "expiresAt">, nowMs: number): boolean =>
  session.expiresAt !== null && session.expiresAt - nowMs < EXPIRY_MARGIN_MS;

const isStoredSession = (value: unknown): value is StoredSession => {
  if (!isRecord(value)) return false;
  const strings = [
    "homeserver",
    "issuer",
    "tokenEndpoint",
    "revocationEndpoint",
    "clientId",
    "deviceId",
    "accessToken",
  ];
  return (
    strings.every((key) => hasString(value, key)) &&
    (value.refreshToken === null || typeof value.refreshToken === "string") &&
    (value.expiresAt === null || typeof value.expiresAt === "number")
  );
};

export const sessionStoreOf = (store: SecretStore): SessionStore => ({
  load: async () => {
    const raw = await store.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isStoredSession(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  save: (session) => store.set(SESSION_KEY, JSON.stringify(session)),
  clear: () => store.remove(SESSION_KEY),
});

const keychainOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const secureStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, keychainOptions),
  set: (key, value) => SecureStore.setItemAsync(key, value, keychainOptions),
  remove: (key) => SecureStore.deleteItemAsync(key, keychainOptions),
};

const sessions = sessionStoreOf(secureStore);

export const loadSession = (): Promise<StoredSession | null> => sessions.load();
export const saveSession = (session: StoredSession): Promise<void> => sessions.save(session);
export const clearSession = (): Promise<void> => sessions.clear();

const fetchJson = async (url: string): Promise<unknown | null> => {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return res.json();
};

const issuerOf = (body: unknown): string | null => {
  if (!isRecord(body)) return null;
  return typeof body.issuer === "string" ? body.issuer : null;
};

export const discoverAuth = async (homeserver: string): Promise<AuthMetadata> => {
  for (const path of AUTH_METADATA_PATHS) {
    const metadata = await fetchJson(`${homeserver}${path}`);
    if (metadata) return authMetadataOf(metadata);
  }
  const issuer = issuerOf(await fetchJson(`${homeserver}${AUTH_ISSUER_PATH}`));
  if (!issuer) throw new Error("homeserver does not offer OAuth 2.0 sign in");
  const configuration = await fetchJson(`${issuer.replace(/\/+$/, "")}${OPENID_CONFIGURATION_PATH}`);
  if (!configuration) throw new Error("issuer configuration unreachable");
  return authMetadataOf(configuration);
};

export const registerClient = async (metadata: AuthMetadata): Promise<string> => {
  const response = await fetch(metadata.registration_endpoint, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(CLIENT_METADATA),
  });
  if (!response.ok) throw new Error("client registration failed");
  const body: unknown = await response.json();
  if (!isRecord(body) || typeof body.client_id !== "string") {
    throw new Error("client registration invalid");
  }
  return body.client_id;
};

const ensureClientId = async (metadata: AuthMetadata): Promise<string> => {
  const configured = readOidcClientId();
  if (configured) return configured;
  const key = `${CLIENT_ID_KEY_PREFIX}${metadata.issuer}`;
  const registered = await secureStore.get(key);
  if (registered) return registered;
  const clientId = await registerClient(metadata);
  await secureStore.set(key, clientId);
  return clientId;
};

const ensureDeviceId = async (): Promise<string> => {
  const existing = await secureStore.get(DEVICE_ID_KEY);
  if (existing) return existing;
  const deviceId = deviceIdFrom(Crypto.getRandomValues(new Uint8Array(DEVICE_ID_ENTROPY_BYTES)));
  await secureStore.set(DEVICE_ID_KEY, deviceId);
  return deviceId;
};

export const signIn = async (homeserverInput: string): Promise<StoredSession> => {
  const homeserver = normalizeHomeserver(homeserverInput);
  const metadata = await discoverAuth(homeserver);
  const discovery = discoveryDocumentOf(metadata);
  const clientId = await ensureClientId(metadata);
  const deviceId = await ensureDeviceId();
  const request = new AuthRequest({
    clientId,
    redirectUri: REDIRECT_URI,
    scopes: scopesFor(deviceId),
    responseType: ResponseType.Code,
    codeChallengeMethod: CodeChallengeMethod.S256,
    usePKCE: true,
  });
  const result = await request.promptAsync(discovery);
  if (result.type === "error") throw result.error ?? new Error(result.errorCode ?? "authorization failed");
  if (result.type !== "success") throw new SignInCancelledError();
  const code = result.params.code;
  if (!code) throw new Error("authorization code missing");
  if (!request.codeVerifier) throw new Error("PKCE verifier missing");
  const tokens = await exchangeCodeAsync(
    { clientId, code, redirectUri: REDIRECT_URI, extraParams: { code_verifier: request.codeVerifier } },
    discovery,
  );
  const session = withTokens(
    {
      homeserver,
      issuer: metadata.issuer,
      tokenEndpoint: metadata.token_endpoint,
      revocationEndpoint: metadata.revocation_endpoint,
      clientId,
      deviceId,
      accessToken: "",
      refreshToken: null,
      expiresAt: null,
    },
    tokens,
    Date.now(),
  );
  const identity = await whoami(homeserver, session.accessToken);
  const confirmed = { ...session, deviceId: identity.deviceId || deviceId };
  await saveSession(confirmed);
  return confirmed;
};

export const refreshSession = async (session: StoredSession): Promise<StoredSession> => {
  if (!session.refreshToken) throw new TokenRefreshLogoutError(new Error("no refresh token"));
  try {
    const tokens = await refreshAsync(
      { clientId: session.clientId, refreshToken: session.refreshToken },
      { tokenEndpoint: session.tokenEndpoint },
    );
    const refreshed = withTokens(session, tokens, Date.now());
    await saveSession(refreshed);
    return refreshed;
  } catch (error) {
    if (error instanceof TokenError) throw new TokenRefreshLogoutError(error);
    throw error;
  }
};

export const signOut = async (session: StoredSession): Promise<void> => {
  const token = session.refreshToken ?? session.accessToken;
  const hint = session.refreshToken ? TokenTypeHint.RefreshToken : TokenTypeHint.AccessToken;
  await revokeAsync(
    { clientId: session.clientId, token, tokenTypeHint: hint },
    { revocationEndpoint: session.revocationEndpoint },
  ).catch(() => undefined);
  await clearSession();
};
