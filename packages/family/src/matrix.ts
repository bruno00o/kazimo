import {
  BackupDownloadStrategy,
  ClientBuilder,
  type ClientLike,
  Session,
  SlidingSyncVersion,
  SlidingSyncVersionBuilder,
  type SyncServiceLike,
} from "@unomed/react-native-matrix-sdk";
import { Directory, Paths } from "expo-file-system";
import { oidcSessionDataOf, type RotatedTokens, sessionDelegateOf } from "./auth";
import { APP_GROUP, resolveSessionPaths, type SessionPaths, type StoreDirs } from "./store";

const MAIN_PROCESS_HOLDER = "main-app";

const containerUri = (): string | null => {
  try {
    return Paths.appleSharedContainers[APP_GROUP]?.uri ?? null;
  } catch {
    return null;
  }
};

const expoDirs = (): StoreDirs => ({
  document: Paths.document.uri,
  cache: Paths.cache.uri,
  container: containerUri(),
  exists: (uri) => new Directory(uri).exists,
  move: async (uri, into) => {
    await new Directory(uri).move(new Directory(into));
  },
});

export type MatrixHandle = {
  client: ClientLike;
  sync: SyncServiceLike;
  paths: SessionPaths;
  stop: () => Promise<void>;
};

export type MatrixCredentials = {
  homeserver: string;
  accessToken: string;
  refreshToken?: string;
  oidcClientId?: string;
  userId: string;
  deviceId: string;
};

export type MatrixWatchers = {
  onRotation: (tokens: RotatedTokens) => void;
  onAuthError: () => void;
};

const defer = (run: () => void): void => {
  setTimeout(run, 0);
};

export const sessionOf = (credentials: MatrixCredentials): Session =>
  Session.create({
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    oidcData: credentials.oidcClientId ? oidcSessionDataOf(credentials.oidcClientId) : undefined,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
    homeserverUrl: credentials.homeserver,
    slidingSyncVersion: SlidingSyncVersion.Native,
  });

export const startMatrix = async (
  credentials: MatrixCredentials,
  options: { bootstrapIdentity: boolean; watchers: MatrixWatchers },
): Promise<MatrixHandle> => {
  const paths = await resolveSessionPaths(expoDirs(), credentials.userId);
  const restored = sessionOf(credentials);
  const delegate = sessionDelegateOf(restored, (tokens) => defer(() => options.watchers.onRotation(tokens)));
  let builder = new ClientBuilder()
    .homeserverUrl(credentials.homeserver)
    .sessionPaths(paths.dataPath, paths.cachePath)
    .crossProcessStoreLocksHolderName(MAIN_PROCESS_HOLDER)
    .slidingSyncVersionBuilder(SlidingSyncVersionBuilder.Native)
    .backupDownloadStrategy(BackupDownloadStrategy.OneShot)
    .setSessionDelegate(delegate);
  if (options.bootstrapIdentity) {
    builder = builder.autoEnableCrossSigning(true).autoEnableBackups(true);
  }
  const client = await builder.build();
  await client.restoreSession(restored);
  const authWatch = client.setDelegate({
    didReceiveAuthError: () => defer(options.watchers.onAuthError),
  });
  const sync = await client.syncService().finish();
  await sync.start();
  return {
    client,
    sync,
    paths,
    stop: async () => {
      authWatch?.cancel();
      await sync.stop().catch(() => {});
    },
  };
};
