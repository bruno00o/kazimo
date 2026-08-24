import type { ClientLike, RecoveryState } from "@unomed/react-native-matrix-sdk";

export type SecurityState = "ready" | "showKey" | "enterKey";

export type Security = { state: "ready" } | { state: "showKey"; recoveryKey: string } | { state: "enterKey" };

export type SecurityPrompt = Exclude<Security, { state: "ready" }>;

export const SECURITY_READY: Security = { state: "ready" };

const RECOVERY_ENABLED: RecoveryState = 1;

const SECURITY_DONE_KEY = "kazimo.securityDone";
const SECURITY_DONE_VALUE = "1";
const BACKUP_VERSION_PATH = "/_matrix/client/v3/room_keys/version";
const NOT_FOUND = 404;
const GROUPS_PER_ROW = 4;

const silentProgress = { onUpdate: () => undefined };

type SecureStoreModule = typeof import("expo-secure-store");

let pendingSecureStore: Promise<SecureStoreModule> | null = null;

const secureStore = (): Promise<SecureStoreModule> => {
  pendingSecureStore ??= import("expo-secure-store");
  return pendingSecureStore;
};

const keychainOptionsOf = (store: SecureStoreModule) => ({
  keychainAccessible: store.AFTER_FIRST_UNLOCK,
});

export const backupExistsOnServerRaw = async (homeserver: string, accessToken: string): Promise<boolean> => {
  const base = homeserver.replace(/\/+$/, "");
  const response = await fetch(`${base}${BACKUP_VERSION_PATH}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  return response.status !== NOT_FOUND;
};

export const assessSecurity = async (client: ClientLike): Promise<Security> => {
  const encryption = client.encryption();
  await encryption.waitForE2eeInitializationTasks();
  if (await encryption.backupExistsOnServer()) {
    return encryption.recoveryState() === RECOVERY_ENABLED ? SECURITY_READY : { state: "enterKey" };
  }
  const recoveryKey = await encryption.enableRecovery(true, undefined, silentProgress);
  await encryption.waitForBackupUploadSteadyState(silentProgress);
  return { state: "showKey", recoveryKey };
};

export const isRecoveryEnabled = async (client: ClientLike): Promise<boolean> => {
  const encryption = client.encryption();
  await encryption.waitForE2eeInitializationTasks();
  return encryption.recoveryState() === RECOVERY_ENABLED;
};

export const submitRecoveryKey = async (client: ClientLike, key: string): Promise<boolean> => {
  try {
    await client.encryption().recover(key.trim());
    return true;
  } catch {
    return false;
  }
};

export const recoveryKeyRows = (recoveryKey: string): string[] => {
  const groups = recoveryKey.trim().split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  for (let start = 0; start < groups.length; start += GROUPS_PER_ROW) {
    rows.push(groups.slice(start, start + GROUPS_PER_ROW).join(" "));
  }
  return rows;
};

export const isSecurityDone = async (): Promise<boolean> => {
  const store = await secureStore();
  const flag = await store.getItemAsync(SECURITY_DONE_KEY, keychainOptionsOf(store));
  return flag === SECURITY_DONE_VALUE;
};

export const markSecurityDone = async (): Promise<void> => {
  const store = await secureStore();
  await store.setItemAsync(SECURITY_DONE_KEY, SECURITY_DONE_VALUE, keychainOptionsOf(store));
};

export const clearSecurityDone = async (): Promise<void> => {
  const store = await secureStore();
  await store.deleteItemAsync(SECURITY_DONE_KEY, keychainOptionsOf(store));
};
