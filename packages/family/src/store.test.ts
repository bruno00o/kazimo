import { beforeEach, describe, expect, test } from "bun:test";
import { resolveSessionPaths, type StoreDirs, storeNamesOf, storeSuffixOf } from "./store";

const GROUP_URI = "file:///group";
const DOCUMENT_URI = "file:///docs";
const CACHE_URI = "file:///cache";

const USER = "@maria:example.org";
const names = storeNamesOf(USER);

let present: Set<string>;
let moves: { uri: string; into: string }[];

const dirsWith = (container: string | null): StoreDirs => ({
  document: DOCUMENT_URI,
  cache: CACHE_URI,
  container,
  exists: (uri) => present.has(uri),
  move: async (uri, into) => {
    moves.push({ uri, into });
    present.delete(uri);
    present.add(`${into}/${uri.split("/").pop()}`);
  },
});

beforeEach(() => {
  present = new Set<string>();
  moves = [];
});

describe("store names", () => {
  test("keeps one store per user", () => {
    expect(storeSuffixOf(USER)).toBe("-maria-example-org");
    expect(names.data).toBe("matrix-data--maria-example-org");
    expect(names.cache).toBe("matrix-cache--maria-example-org");
  });
});

describe("session paths", () => {
  test("falls back to the sandbox when no shared container exists", async () => {
    const paths = await resolveSessionPaths(dirsWith(null), USER);
    expect(paths.dataPath).toBe(`/docs/${names.data}`);
    expect(paths.cachePath).toBe(`/cache/${names.cache}`);
    expect(moves).toHaveLength(0);
  });

  test("uses the shared container when nothing was stored before", async () => {
    const paths = await resolveSessionPaths(dirsWith(GROUP_URI), USER);
    expect(paths.dataPath).toBe(`/group/${names.data}`);
    expect(paths.cachePath).toBe(`/group/${names.cache}`);
    expect(moves).toHaveLength(0);
  });

  test("tolerates a container uri with a trailing slash", async () => {
    const paths = await resolveSessionPaths(dirsWith(`${GROUP_URI}/`), USER);
    expect(paths.dataPath).toBe(`/group/${names.data}`);
  });

  test("moves an existing sandbox store into the shared container", async () => {
    present.add(`${DOCUMENT_URI}/${names.data}`);
    present.add(`${CACHE_URI}/${names.cache}`);
    const paths = await resolveSessionPaths(dirsWith(GROUP_URI), USER);
    expect(paths.dataPath).toBe(`/group/${names.data}`);
    expect(present.has(`${GROUP_URI}/${names.data}`)).toBe(true);
    expect(present.has(`${GROUP_URI}/${names.cache}`)).toBe(true);
    expect(present.has(`${DOCUMENT_URI}/${names.data}`)).toBe(false);
  });

  test("moves the data store even when no sandbox cache exists", async () => {
    present.add(`${DOCUMENT_URI}/${names.data}`);
    await resolveSessionPaths(dirsWith(GROUP_URI), USER);
    expect(moves).toHaveLength(1);
    expect(present.has(`${GROUP_URI}/${names.data}`)).toBe(true);
  });

  test("leaves an already migrated store alone", async () => {
    present.add(`${GROUP_URI}/${names.data}`);
    present.add(`${DOCUMENT_URI}/${names.data}`);
    await resolveSessionPaths(dirsWith(GROUP_URI), USER);
    expect(moves).toHaveLength(0);
    expect(present.has(`${DOCUMENT_URI}/${names.data}`)).toBe(true);
  });

  test("keeps the shared paths when the move fails", async () => {
    present.add(`${DOCUMENT_URI}/${names.data}`);
    const dirs: StoreDirs = {
      ...dirsWith(GROUP_URI),
      move: async () => {
        throw new Error("no room left");
      },
    };
    const paths = await resolveSessionPaths(dirs, USER);
    expect(paths.dataPath).toBe(`/group/${names.data}`);
  });
});
