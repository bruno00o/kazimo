import * as SecureStore from "expo-secure-store";
import type { Strings } from "./i18n";
import { APP_GROUP, type SessionPaths } from "./store";

export const NSE_CREDENTIALS_KEY = "notification-session";
export const NSE_KEYCHAIN_SERVICE = "kazimo-nse";

export type NseCredentials = {
  homeserver: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  dataPath: string;
  cachePath: string;
  messageLabel: string;
  photoLabel: string;
};

const keychainOptions: SecureStore.SecureStoreOptions = {
  keychainService: NSE_KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  accessGroup: APP_GROUP,
};

export const nseCredentialsOf = (
  session: { homeserver: string; userId: string; deviceId: string; accessToken: string },
  paths: SessionPaths,
  strings: Strings,
): NseCredentials => ({
  homeserver: session.homeserver,
  userId: session.userId,
  deviceId: session.deviceId,
  accessToken: session.accessToken,
  dataPath: paths.dataPath,
  cachePath: paths.cachePath,
  messageLabel: strings.newMessage,
  photoLabel: strings.photo,
});

export const isNseCredentials = (value: unknown): value is NseCredentials => {
  if (typeof value !== "object" || value === null) return false;
  const fields: (keyof NseCredentials)[] = [
    "homeserver",
    "userId",
    "deviceId",
    "accessToken",
    "dataPath",
    "cachePath",
    "messageLabel",
    "photoLabel",
  ];
  return fields.every((field) => typeof (value as Record<string, unknown>)[field] === "string");
};

export const withAccessToken = (credentials: NseCredentials, accessToken: string): NseCredentials => ({
  ...credentials,
  accessToken,
});

export const publishNseCredentials = (credentials: NseCredentials): Promise<void> =>
  SecureStore.setItemAsync(NSE_CREDENTIALS_KEY, JSON.stringify(credentials), keychainOptions);

export const loadNseCredentials = async (): Promise<NseCredentials | null> => {
  const raw = await SecureStore.getItemAsync(NSE_CREDENTIALS_KEY, keychainOptions);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isNseCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const refreshNseAccessToken = async (accessToken: string): Promise<void> => {
  const stored = await loadNseCredentials();
  if (!stored || stored.accessToken === accessToken) return;
  await publishNseCredentials(withAccessToken(stored, accessToken));
};

export const clearNseCredentials = (): Promise<void> =>
  SecureStore.deleteItemAsync(NSE_CREDENTIALS_KEY, keychainOptions);
