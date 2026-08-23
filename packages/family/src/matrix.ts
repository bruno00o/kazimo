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
  userId: string;
  deviceId: string;
};

const stripScheme = (uri: string): string => uri.replace(/^file:\/\//, "").replace(/\/$/, "");

export const sessionOf = (credentials: MatrixCredentials): Session =>
  Session.create({
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    userId: credentials.userId,
    deviceId: credentials.deviceId,
    homeserverUrl: credentials.homeserver,
    slidingSyncVersion: SlidingSyncVersion.Native,
  });

export const startMatrix = async (
  credentials: MatrixCredentials,
  options: { bootstrapIdentity: boolean },
): Promise<MatrixHandle> => {
  const suffix = credentials.userId.replace(/[^a-zA-Z0-9]/g, "-");
  let builder = new ClientBuilder()
    .homeserverUrl(credentials.homeserver)
    .sessionPaths(
      `${stripScheme(Paths.document.uri)}/${DATA_DIR}-${suffix}`,
      `${stripScheme(Paths.cache.uri)}/${CACHE_DIR}-${suffix}`,
    )
    .slidingSyncVersionBuilder(SlidingSyncVersionBuilder.Native)
    .backupDownloadStrategy(BackupDownloadStrategy.OneShot);
  if (options.bootstrapIdentity) {
    builder = builder.autoEnableCrossSigning(true).autoEnableBackups(true);
  }
  const client = await builder.build();
  await client.restoreSession(sessionOf(credentials));
  const sync = await client.syncService().finish();
  await sync.start();
  return {
    client,
    sync,
    stop: async () => {
      await sync.stop().catch(() => {});
    },
  };
};

export const accessTokenOf = (client: ClientLike): string => client.session().accessToken;
