import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";

const CACHE_URI = "file:///cache";

const stored = new Map<string, Uint8Array>();
const created: string[] = [];

class FakeDirectory {
  uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
  }
  get exists() {
    return created.includes(this.uri);
  }
  create() {
    created.push(this.uri);
  }
}

class FakeFile {
  uri: string;
  size = 0;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("/");
  }
  get exists() {
    return stored.has(this.uri);
  }
  write(bytes: Uint8Array) {
    stored.set(this.uri, bytes);
  }
}

mock.module("expo-file-system", () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { cache: { uri: CACHE_URI } },
}));
mock.module("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: () => ({}) },
  SaveFormat: { JPEG: "jpeg" },
}));
mock.module("expo-image-picker", () => ({
  getMediaLibraryPermissionsAsync: async () => ({ granted: false }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: false }),
}));
mock.module("react-native-blurhash", () => ({ Blurhash: { encode: async () => "" } }));
mock.module("@unomed/react-native-matrix-sdk", () => ({
  Membership: { Joined: "joined" },
  MediaSource: {
    fromUrl: (url: string) => ({ from: "url", url }),
    fromJson: (json: string) => ({ from: "json", json }),
  },
  messageEventContentFromMarkdown: (body: string) => ({ body }),
  ReceiptType: { Read: 0, ReadPrivate: 1, FullyRead: 2 },
  UploadSource: { File: class {} },
}));

const {
  CHAT_THUMBNAIL_EDGE,
  fitWithin,
  localPathOf,
  longEdgeResize,
  mediaCacheKey,
  photoUri,
  UPLOAD_LONG_EDGE,
} = await import("./media");

const MXC = "mxc://kazimo.test/praia";
const MAX_BUBBLE_WIDTH = 260;
const MAX_BUBBLE_HEIGHT = 340;
const THUMBNAIL_URI = `${CACHE_URI}/matrix-media/mxc-kazimo-test-praia-1024`;
const FULL_URI = `${CACHE_URI}/matrix-media/mxc-kazimo-test-praia-full`;

const bytesOf = (values: number[]) => new Uint8Array(values).buffer;

type Calls = { thumbnails: unknown[][]; files: unknown[][]; contents: unknown[][]; persisted: string[] };

const clientWith = (calls: Calls, options: { persists: boolean }): ClientLike =>
  ({
    getMediaThumbnail: async (source: unknown, width: bigint, height: bigint) => {
      calls.thumbnails.push([source, width, height]);
      return bytesOf([1, 2, 3]);
    },
    getMediaFile: async (source: unknown, ...rest: unknown[]) => {
      calls.files.push([source, ...rest]);
      return {
        path: () => "/tmp/rust-media",
        persist: (path: string) => {
          calls.persisted.push(path);
          return options.persists;
        },
      };
    },
    getMediaContent: async (source: unknown) => {
      calls.contents.push([source]);
      return bytesOf([9, 9]);
    },
  }) as unknown as ClientLike;

const noCalls = (): Calls => ({ thumbnails: [], files: [], contents: [], persisted: [] });

beforeEach(() => {
  stored.clear();
  created.length = 0;
});

describe("fitWithin", () => {
  test("a landscape photo is bound by the width", () => {
    expect(fitWithin(1600, 900, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 260, height: 146 });
  });

  test("a portrait photo is bound by the height", () => {
    expect(fitWithin(900, 1600, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 191, height: 340 });
  });

  test("a photo smaller than the bubble is never enlarged", () => {
    expect(fitWithin(120, 80, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 120, height: 80 });
  });

  test("unknown dimensions fall back to a square", () => {
    expect(fitWithin(null, null, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 260, height: 260 });
    expect(fitWithin(1600, null, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 260, height: 260 });
  });

  test("meaningless dimensions fall back to a square", () => {
    expect(fitWithin(0, 900, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 260, height: 260 });
    expect(fitWithin(1600, -1, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 260, height: 260 });
  });

  test("an extreme ratio still leaves a visible side", () => {
    expect(fitWithin(20000, 10, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)).toEqual({ width: 260, height: 1 });
  });
});

describe("longEdgeResize", () => {
  test("a photo already within the limit is not resized", () => {
    expect(longEdgeResize(2048, 1200, UPLOAD_LONG_EDGE)).toBe(null);
    expect(longEdgeResize(800, 600, UPLOAD_LONG_EDGE)).toBe(null);
  });

  test("a landscape photo is capped on its width", () => {
    expect(longEdgeResize(4000, 3000, UPLOAD_LONG_EDGE)).toEqual({ width: 2048 });
  });

  test("a portrait photo is capped on its height", () => {
    expect(longEdgeResize(3000, 4000, UPLOAD_LONG_EDGE)).toEqual({ height: 2048 });
  });

  test("meaningless dimensions are left alone", () => {
    expect(longEdgeResize(0, 4000, UPLOAD_LONG_EDGE)).toBe(null);
  });
});

describe("mediaCacheKey", () => {
  test("a media id becomes a safe file name carrying its size", () => {
    expect(mediaCacheKey(MXC, CHAT_THUMBNAIL_EDGE)).toBe("mxc-kazimo-test-praia-1024");
    expect(mediaCacheKey(MXC, null)).toBe("mxc-kazimo-test-praia-full");
  });

  test("two sizes of the same photo never share a file", () => {
    expect(mediaCacheKey(MXC, 1024)).not.toBe(mediaCacheKey(MXC, 2048));
  });

  test("two photos never share a file", () => {
    expect(mediaCacheKey(MXC, 1024)).not.toBe(mediaCacheKey("mxc://kazimo.test/serra", 1024));
  });
});

describe("localPathOf", () => {
  test("the rust sdk wants a system path, not a file uri", () => {
    expect(localPathOf("file:///cache/a")).toBe("/cache/a");
    expect(localPathOf("/cache/a")).toBe("/cache/a");
  });
});

describe("photoUri", () => {
  test("a photo already in the cache is served without asking the homeserver", async () => {
    stored.set(THUMBNAIL_URI, new Uint8Array([1]));
    const calls = noCalls();
    const uri = await photoUri(clientWith(calls, { persists: true }), { mxc: MXC, json: null }, 1024);
    expect(uri).toBe(THUMBNAIL_URI);
    expect(calls.thumbnails).toEqual([]);
  });

  test("a thumbnail is fetched at the asked size and written to the cache", async () => {
    const calls = noCalls();
    const uri = await photoUri(clientWith(calls, { persists: true }), { mxc: MXC, json: null }, 1024);
    expect(uri).toBe(THUMBNAIL_URI);
    expect(calls.thumbnails).toEqual([[{ from: "url", url: MXC }, 1024n, 1024n]]);
    expect(stored.get(THUMBNAIL_URI)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("the full size photo is persisted out of the temporary file handle", async () => {
    const calls = noCalls();
    const uri = await photoUri(clientWith(calls, { persists: true }), { mxc: MXC, json: null }, null);
    expect(uri).toBe(FULL_URI);
    expect(calls.persisted).toEqual(["/cache/matrix-media/mxc-kazimo-test-praia-full"]);
    expect(calls.contents).toEqual([]);
  });

  test("a handle that refuses to persist falls back to downloading the bytes", async () => {
    const calls = noCalls();
    const uri = await photoUri(clientWith(calls, { persists: false }), { mxc: MXC, json: null }, null);
    expect(uri).toBe(FULL_URI);
    expect(calls.contents).toHaveLength(1);
    expect(stored.get(FULL_URI)).toEqual(new Uint8Array([9, 9]));
  });

  test("an encrypted photo is rebuilt from its serialised source", async () => {
    const calls = noCalls();
    await photoUri(clientWith(calls, { persists: true }), { mxc: MXC, json: '{"Encrypted":{}}' }, 1024);
    expect(calls.thumbnails[0]?.[0]).toEqual({ from: "json", json: '{"Encrypted":{}}' });
  });

  test("the cache directory is created once, on demand", async () => {
    const calls = noCalls();
    await photoUri(clientWith(calls, { persists: true }), { mxc: MXC, json: null }, 1024);
    expect(created).toEqual([`${CACHE_URI}/matrix-media`]);
  });
});
