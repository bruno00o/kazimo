import { afterEach, describe, expect, mock, test } from "bun:test";
import { type MatrixClient, MsgType } from "matrix-js-sdk";

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

const {
  authenticatedImageSource,
  CHAT_THUMBNAIL_EDGE,
  fitWithin,
  longEdgeResize,
  photoContent,
  sendPhoto,
  UPLOAD_LONG_EDGE,
} = await import("./media");

const ROOM_ID = "!room:kazimo.test";
const MXC = "mxc://kazimo.test/praia";
const TOKEN = "syt_token";
const MAX_BUBBLE_WIDTH = 260;
const MAX_BUBBLE_HEIGHT = 340;

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

describe("authenticatedImageSource", () => {
  const clientWith = (
    calls: unknown[][],
    { uri, token }: { uri: string | null; token: string | null },
  ): MatrixClient =>
    ({
      mxcUrlToHttp: (...args: unknown[]) => {
        calls.push(args);
        return uri;
      },
      getAccessToken: () => token,
    }) as unknown as MatrixClient;

  test("asks for an authenticated thumbnail and carries the bearer token", () => {
    const calls: unknown[][] = [];
    const client = clientWith(calls, { uri: "https://kazimo.test/thumbnail", token: TOKEN });
    const source = authenticatedImageSource(client, MXC, CHAT_THUMBNAIL_EDGE, CHAT_THUMBNAIL_EDGE);
    expect(calls).toEqual([[MXC, 1024, 1024, "scale", false, undefined, true]]);
    expect(source).toEqual({
      uri: "https://kazimo.test/thumbnail",
      headers: { Authorization: `Bearer ${TOKEN}` },
      cacheKey: `${MXC}:1024x1024`,
    });
  });

  test("the cache key survives a token refresh", () => {
    const calls: unknown[][] = [];
    const first = authenticatedImageSource(
      clientWith(calls, { uri: "https://kazimo.test/a", token: "one" }),
      MXC,
      2048,
      2048,
    );
    const second = authenticatedImageSource(
      clientWith(calls, { uri: "https://kazimo.test/a", token: "two" }),
      MXC,
      2048,
      2048,
    );
    expect(first.cacheKey).toBe(second.cacheKey as string);
    expect(second.headers).toEqual({ Authorization: "Bearer two" });
  });

  test("an unusable mxc url and a missing token yield an empty source", () => {
    const source = authenticatedImageSource(
      clientWith([], { uri: null, token: null }),
      MXC,
      CHAT_THUMBNAIL_EDGE,
      CHAT_THUMBNAIL_EDGE,
    );
    expect(source.uri).toBe(undefined);
    expect(source.headers).toBe(undefined);
  });
});

describe("photoContent", () => {
  test("describes the image with its dimensions and blurhash", () => {
    expect(
      photoContent(MXC, 4096, { uri: "file:///a.jpg", width: 2048, height: 1536, blurhash: "LEHV6" }),
    ).toEqual({
      msgtype: MsgType.Image,
      body: "photo.jpg",
      url: MXC,
      info: {
        mimetype: "image/jpeg",
        size: 4096,
        w: 2048,
        h: 1536,
        "xyz.amorgan.blurhash": "LEHV6",
      },
    });
  });

  test("omits the blurhash key when there is none", () => {
    const content = photoContent(MXC, 4096, {
      uri: "file:///a.jpg",
      width: 2048,
      height: 1536,
      blurhash: null,
    });
    expect(content.info).toEqual({ mimetype: "image/jpeg", size: 4096, w: 2048, h: 1536 });
    expect("xyz.amorgan.blurhash" in content.info).toBe(false);
  });
});

describe("sendPhoto", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const stubFetch = (blob: Blob) => {
    globalThis.fetch = (async () => new Response(blob)) as unknown as typeof fetch;
  };

  test("uploads with an explicit type and name, then sends the image event", async () => {
    stubFetch(new Blob([new Uint8Array(12)]));
    const uploads: unknown[][] = [];
    const sends: unknown[][] = [];
    const client = {
      uploadContent: async (file: unknown, opts: unknown) => {
        uploads.push([file, opts]);
        return { content_uri: MXC };
      },
      sendMessage: async (roomId: string, content: unknown) => {
        sends.push([roomId, content]);
        return { event_id: "$sent" };
      },
    } as unknown as MatrixClient;

    const sent = await sendPhoto(client, ROOM_ID, {
      uri: "file:///a.jpg",
      width: 2048,
      height: 1536,
      blurhash: "LEHV6",
    });

    expect(sent).toEqual({ event_id: "$sent" });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.[1]).toMatchObject({ type: "image/jpeg", name: "photo.jpg" });
    expect(sends[0]?.[0]).toBe(ROOM_ID);
    expect(sends[0]?.[1]).toMatchObject({
      msgtype: "m.image",
      url: MXC,
      info: { size: 12, w: 2048, h: 1536, "xyz.amorgan.blurhash": "LEHV6" },
    });
  });

  test("reports the upload progress as a fraction", async () => {
    stubFetch(new Blob([new Uint8Array(4)]));
    const fractions: number[] = [];
    const client = {
      uploadContent: async (_file: unknown, opts: { progressHandler?: (p: unknown) => void }) => {
        opts.progressHandler?.({ loaded: 2, total: 4 });
        opts.progressHandler?.({ loaded: 4, total: 4 });
        opts.progressHandler?.({ loaded: 0, total: 0 });
        return { content_uri: MXC };
      },
      sendMessage: async () => ({ event_id: "$sent" }),
    } as unknown as MatrixClient;

    await sendPhoto(
      client,
      ROOM_ID,
      { uri: "file:///a.jpg", width: 10, height: 10, blurhash: null },
      (fraction) => fractions.push(fraction),
    );

    expect(fractions).toEqual([0.5, 1, 0]);
  });

  test("leaves no progress handler when nobody listens", async () => {
    stubFetch(new Blob([new Uint8Array(4)]));
    const seen: unknown[] = [];
    const client = {
      uploadContent: async (_file: unknown, opts: { progressHandler?: unknown }) => {
        seen.push(opts.progressHandler);
        return { content_uri: MXC };
      },
      sendMessage: async () => ({ event_id: "$sent" }),
    } as unknown as MatrixClient;

    await sendPhoto(client, ROOM_ID, { uri: "file:///a.jpg", width: 10, height: 10, blurhash: null });
    expect(seen).toEqual([undefined]);
  });
});
