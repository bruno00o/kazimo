export const APP_GROUP = "group.com.kazimo.family";

const DATA_DIR = "matrix-data";
const CACHE_DIR = "matrix-cache";

export type SessionPaths = {
  dataPath: string;
  cachePath: string;
};

export type StoreDirs = {
  document: string;
  cache: string;
  container: string | null;
  exists: (uri: string) => boolean;
  move: (uri: string, into: string) => Promise<void>;
};

export const storeSuffixOf = (userId: string): string => userId.replace(/[^a-zA-Z0-9]/g, "-");

export const storeNamesOf = (userId: string): { data: string; cache: string } => {
  const suffix = storeSuffixOf(userId);
  return { data: `${DATA_DIR}-${suffix}`, cache: `${CACHE_DIR}-${suffix}` };
};

const trimSlash = (uri: string): string => uri.replace(/\/+$/, "");

const join = (root: string, name: string): string => `${trimSlash(root)}/${name}`;

const stripScheme = (uri: string): string => trimSlash(uri).replace(/^file:\/\//, "");

const adopt = async (dirs: StoreDirs, uri: string, container: string): Promise<void> => {
  if (!dirs.exists(uri)) return;
  await dirs.move(uri, container).catch(() => undefined);
};

export const resolveSessionPaths = async (dirs: StoreDirs, userId: string): Promise<SessionPaths> => {
  const names = storeNamesOf(userId);
  const sandbox = { data: join(dirs.document, names.data), cache: join(dirs.cache, names.cache) };
  const container = dirs.container;
  if (!container) {
    return { dataPath: stripScheme(sandbox.data), cachePath: stripScheme(sandbox.cache) };
  }
  const shared = { data: join(container, names.data), cache: join(container, names.cache) };
  const paths = { dataPath: stripScheme(shared.data), cachePath: stripScheme(shared.cache) };
  if (dirs.exists(shared.data)) return paths;
  await adopt(dirs, sandbox.data, container);
  await adopt(dirs, sandbox.cache, container);
  return paths;
};
