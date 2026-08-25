import {
  BackupDownloadStrategy,
  ClientBuilder,
  type ClientLike,
  Session,
  SlidingSyncVersion,
  SlidingSyncVersionBuilder,
  type SyncServiceLike,
} from "@unomed/react-native-matrix-sdk";
import { Paths } from "expo-file-system";
import { oidcSessionDataOf, type RotatedTokens, sessionDelegateOf } from "./auth";

const DATA_DIR = "matrix-data";
const CACHE_DIR = "matrix-cache";

export type MatrixHandle = {
  client: ClientLike;
  sync: SyncServiceLike;
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

const stripScheme = (uri: string): string => uri.replace(/^file:\/\//, "").replace(/\/$/, "");

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
  const suffix = credentials.userId.replace(/[^a-zA-Z0-9]/g, "-");
  const restored = sessionOf(credentials);
  const delegate = sessionDelegateOf(restored, (tokens) => defer(() => options.watchers.onRotation(tokens)));
  let builder = new ClientBuilder()
    .homeserverUrl(credentials.homeserver)
    .sessionPaths(
      `${stripScheme(Paths.document.uri)}/${DATA_DIR}-${suffix}`,
      `${stripScheme(Paths.cache.uri)}/${CACHE_DIR}-${suffix}`,
    )
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
    stop: async () => {
      authWatch?.cancel();
      await sync.stop().catch(() => {});
    },
  };
};
