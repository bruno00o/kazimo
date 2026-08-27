import { describe, expect, mock, test } from "bun:test";
import type { TimelineEntry } from "./timeline";

mock.module("@unomed/react-native-matrix-sdk", () => ({
  MediaSource: { fromUrl: (url: string) => ({ url }), fromJson: (json: string) => ({ json }) },
  messageEventContentFromMarkdown: (body: string) => ({ body }),
  ReceiptType: { Read: 0, ReadPrivate: 1, FullyRead: 2 },
  UploadSource: { File: class {} },
}));

const {
  applyTimelineDiff,
  bodyOf,
  chatItemsOf,
  imageInfoOf,
  latestMessageOf,
  localDayKey,
  localpartOf,
  mediaSourceJsonOf,
  readSetOf,
  readUpTo,
  receiptUserIdsOf,
  senderNameOf,
  sendStateOf,
  statusOf,
  typingNamesOf,
  uploadPathOf,
} = await import("./timeline");

const ME = "@avo:kazimo.test";
const RUI = "@rui:kazimo.test";
const MXC = "mxc://kazimo.test/praia";

const at = (day: number, hour: number) => new Date(2026, 7, day, hour, 0, 0).getTime();

const textContent = (msgType: string, body: string) => ({
  tag: "MsgLike",
  inner: {
    content: {
      kind: {
        tag: "Message",
        inner: { content: { msgType: { tag: msgType, inner: { content: { body } } }, body } },
      },
      reactions: [],
    },
  },
});

const imageContent = (
  image: Record<string, unknown>,
  source: { url?: () => string; toJson?: () => string } = { url: () => MXC },
) => ({
  tag: "MsgLike",
  inner: {
    content: {
      kind: {
        tag: "Message",
        inner: {
          content: {
            body: "praia.jpg",
            msgType: { tag: "Image", inner: { content: { source, ...image } } },
          },
        },
      },
      reactions: [],
    },
  },
});

const entry = (over: Partial<TimelineEntry> & Pick<TimelineEntry, "id">): TimelineEntry => ({
  senderId: RUI,
  senderName: "Rui",
  timestamp: at(20, 9),
  message: { kind: "text", body: "bom dia" },
  sendState: "sent",
  readByOthers: false,
  sourceJson: null,
  ...over,
});

const messages = (items: ReturnType<typeof chatItemsOf>) => items.filter((item) => item.kind !== "dayMarker");

describe("bodyOf", () => {
  test("maps text, emote and notice to text", () => {
    for (const msgType of ["Text", "Emote", "Notice"]) {
      expect(bodyOf(textContent(msgType, "bom dia"))).toEqual({ kind: "text", body: "bom dia" });
    }
  });

  test("reads dimensions and blurhash from the image info", () => {
    const content = imageContent({
      filename: "praia.jpg",
      info: { width: 1600n, height: 900n, blurhash: "LEHV6nWB2yk8" },
    });
    expect(bodyOf(content)).toEqual({
      kind: "image",
      mxc: MXC,
      width: 1600,
      height: 900,
      blurhash: "LEHV6nWB2yk8",
      caption: null,
    });
  });

  test("missing image info yields nulls", () => {
    expect(bodyOf(imageContent({ filename: "praia.jpg" }))).toEqual({
      kind: "image",
      mxc: MXC,
      width: null,
      height: null,
      blurhash: null,
      caption: null,
    });
  });

  test("the caption comes from the caption field, not the filename", () => {
    expect(bodyOf(imageContent({ filename: "praia.jpg", caption: "a praia hoje" }))).toMatchObject({
      caption: "a praia hoje",
    });
  });

  test("an image whose source has no url is not renderable", () => {
    expect(bodyOf(imageContent({ filename: "praia.jpg" }, {}))).toBe(null);
  });

  test("skips redacted messages and events we cannot decrypt", () => {
    for (const tag of ["Redacted", "UnableToDecrypt", "Poll", "Sticker", "Other"]) {
      expect(bodyOf({ tag: "MsgLike", inner: { content: { kind: { tag }, reactions: [] } } })).toBe(null);
    }
  });

  test("skips content that is not message like", () => {
    for (const tag of ["RoomMembership", "ProfileChange", "State", "CallInvite"]) {
      expect(bodyOf({ tag, inner: { content: {} } })).toBe(null);
    }
  });

  test("skips message types we do not render", () => {
    expect(bodyOf(textContent("File", "relatorio.pdf"))).toBe(null);
    expect(bodyOf(textContent("Video", "ferias.mp4"))).toBe(null);
  });

  test("survives a shape it does not recognise", () => {
    expect(bodyOf(null)).toBe(null);
    expect(bodyOf(undefined)).toBe(null);
    expect(bodyOf("MsgLike")).toBe(null);
    expect(bodyOf({ tag: "MsgLike" })).toBe(null);
    expect(bodyOf({ tag: "MsgLike", inner: { content: { kind: { tag: "Message" } } } })).toBe(null);
  });
});

describe("mediaSourceJsonOf", () => {
  test("carries the serialised media source of an image", () => {
    const content = imageContent(
      { filename: "praia.jpg" },
      { url: () => MXC, toJson: () => '{"Plain":"a"}' },
    );
    expect(mediaSourceJsonOf(content)).toBe('{"Plain":"a"}');
  });

  test("a text message has no media source", () => {
    expect(mediaSourceJsonOf(textContent("Text", "bom dia"))).toBe(null);
  });
});

describe("applyTimelineDiff", () => {
  const base = ["a", "b", "c"];

  test("appends and resets whole batches", () => {
    expect(applyTimelineDiff(base, { tag: "Append", inner: { values: ["d", "e"] } })).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(applyTimelineDiff(base, { tag: "Reset", inner: { values: ["x"] } })).toEqual(["x"]);
  });

  test("clears the whole list", () => {
    expect(applyTimelineDiff(base, { tag: "Clear" })).toEqual([]);
  });

  test("pushes at either end", () => {
    expect(applyTimelineDiff(base, { tag: "PushFront", inner: { value: "z" } })).toEqual([
      "z",
      "a",
      "b",
      "c",
    ]);
    expect(applyTimelineDiff(base, { tag: "PushBack", inner: { value: "z" } })).toEqual(["a", "b", "c", "z"]);
  });

  test("pops at either end and never underflows", () => {
    expect(applyTimelineDiff(base, { tag: "PopFront" })).toEqual(["b", "c"]);
    expect(applyTimelineDiff(base, { tag: "PopBack" })).toEqual(["a", "b"]);
    expect(applyTimelineDiff([], { tag: "PopFront" })).toEqual([]);
    expect(applyTimelineDiff([], { tag: "PopBack" })).toEqual([]);
  });

  test("inserts at an index, including one past the end", () => {
    expect(applyTimelineDiff(base, { tag: "Insert", inner: { index: 1, value: "z" } })).toEqual([
      "a",
      "z",
      "b",
      "c",
    ]);
    expect(applyTimelineDiff(base, { tag: "Insert", inner: { index: 3, value: "z" } })).toEqual([
      "a",
      "b",
      "c",
      "z",
    ]);
  });

  test("replaces at an index", () => {
    expect(applyTimelineDiff(base, { tag: "Set", inner: { index: 1, value: "z" } })).toEqual(["a", "z", "c"]);
  });

  test("removes at an index", () => {
    expect(applyTimelineDiff(base, { tag: "Remove", inner: { index: 0 } })).toEqual(["b", "c"]);
  });

  test("truncates to a length", () => {
    expect(applyTimelineDiff(base, { tag: "Truncate", inner: { length: 1 } })).toEqual(["a"]);
    expect(applyTimelineDiff(base, { tag: "Truncate", inner: { length: 9 } })).toEqual(base);
  });

  test("an out of range index leaves the list untouched", () => {
    expect(applyTimelineDiff(base, { tag: "Set", inner: { index: 9, value: "z" } })).toEqual(base);
    expect(applyTimelineDiff(base, { tag: "Remove", inner: { index: -1 } })).toEqual(base);
    expect(applyTimelineDiff(base, { tag: "Insert", inner: { index: 9, value: "z" } })).toEqual(base);
  });

  test("an unknown tag leaves the list untouched", () => {
    expect(applyTimelineDiff(base, { tag: "Something" })).toEqual(base);
  });

  test("never mutates the list it was given", () => {
    const items = ["a", "b"];
    applyTimelineDiff(items, { tag: "PushBack", inner: { value: "c" } });
    expect(items).toEqual(["a", "b"]);
  });
});

describe("chatItemsOf", () => {
  test("carries sender identity and the resolved display name", () => {
    expect(chatItemsOf([entry({ id: "1" })], ME)).toEqual([
      { kind: "dayMarker", id: "day:2026-08-20", timestamp: at(20, 9) },
      {
        kind: "text",
        id: "1",
        senderId: RUI,
        senderName: "Rui",
        body: "bom dia",
        timestamp: at(20, 9),
        mine: false,
        delivery: "sent",
        failed: false,
      },
    ]);
  });

  test("flags my own messages", () => {
    const items = messages(chatItemsOf([entry({ id: "1", senderId: ME })], ME));
    expect(items[0]).toMatchObject({ mine: true, delivery: "sent", failed: false });
  });

  test("marks as read every message up to the newest receipt of another user", () => {
    const entries = [
      entry({ id: "1", senderId: ME }),
      entry({ id: "2", timestamp: at(20, 10), readByOthers: true }),
      entry({ id: "3", senderId: ME, timestamp: at(20, 11) }),
    ];
    const items = messages(chatItemsOf(entries, ME, readSetOf(entries)));
    expect(items.map((item) => item.delivery)).toEqual(["read", "read", "sent"]);
  });

  test("flags queued messages as pending and rejected ones as failed", () => {
    const entries = [
      entry({ id: "1", senderId: ME, sendState: "pending" }),
      entry({ id: "2", senderId: ME, sendState: "failed", timestamp: at(20, 10) }),
      entry({ id: "3", senderId: ME, timestamp: at(20, 11) }),
    ];
    const items = messages(chatItemsOf(entries, ME));
    expect(items.map((item) => ({ delivery: item.delivery, failed: item.failed }))).toEqual([
      { delivery: "pending", failed: false },
      { delivery: "sent", failed: true },
      { delivery: "sent", failed: false },
    ]);
  });

  test("a receipt never overrides a message still on its way out", () => {
    const entries = [entry({ id: "1", senderId: ME, sendState: "pending", readByOthers: true })];
    const items = messages(chatItemsOf(entries, ME, readSetOf(entries)));
    expect(items[0]).toMatchObject({ delivery: "pending" });
  });

  test("one day marker per calendar day, none within a day", () => {
    const items = chatItemsOf(
      [
        entry({ id: "1" }),
        entry({ id: "2", senderId: ME, timestamp: at(20, 21) }),
        entry({ id: "3", timestamp: at(21, 8) }),
      ],
      ME,
    );
    expect(items.map((item) => item.id)).toEqual(["day:2026-08-20", "1", "2", "day:2026-08-21", "3"]);
  });

  test("a day marker uses the local date of the first message of the day", () => {
    const justBeforeMidnight = new Date(2026, 7, 20, 23, 59, 0).getTime();
    const items = chatItemsOf([entry({ id: "1", timestamp: justBeforeMidnight })], ME);
    expect(items[0]).toEqual({ kind: "dayMarker", id: "day:2026-08-20", timestamp: justBeforeMidnight });
    expect(localDayKey(justBeforeMidnight)).toBe("2026-08-20");
  });

  test("keeps text and image side by side in one list", () => {
    const image = entry({
      id: "2",
      timestamp: at(20, 10),
      message: {
        kind: "image",
        mxc: MXC,
        width: 800,
        height: 600,
        blurhash: "LEHV6nWB2yk8",
        caption: "a praia hoje",
      },
    });
    const items = messages(chatItemsOf([entry({ id: "1" }), image], ME));
    expect(items.map((item) => item.kind)).toEqual(["text", "image"]);
    expect(items[1]).toMatchObject({ mxc: MXC, width: 800, caption: "a praia hoje", senderName: "Rui" });
  });

  test("keeps the order the timeline gave it", () => {
    const items = messages(
      chatItemsOf([entry({ id: "3", timestamp: at(21, 8) }), entry({ id: "1" }), entry({ id: "2" })], ME),
    );
    expect(items.map((item) => item.id)).toEqual(["3", "1", "2"]);
  });
});

describe("latestMessageOf", () => {
  test("finds the last real message, skipping day markers", () => {
    const items = chatItemsOf([entry({ id: "1" }), entry({ id: "2", timestamp: at(21, 8) })], ME);
    expect(latestMessageOf(items)).toMatchObject({ id: "2" });
  });

  test("an empty list has no latest message", () => {
    expect(latestMessageOf([])).toBe(null);
  });
});

describe("readUpTo", () => {
  test("everything before the newest receipt is read, nothing after it", () => {
    expect([...readUpTo(["1", "2", "3", "4"], ["1", "3"])]).toEqual(["1", "2", "3"]);
  });

  test("no receipt means nothing is read", () => {
    expect([...readUpTo(["1", "2"], [])]).toEqual([]);
  });

  test("a receipt on an item outside the window is ignored", () => {
    expect([...readUpTo(["1", "2"], ["older"])]).toEqual([]);
  });

  test("an empty timeline yields an empty set", () => {
    expect([...readUpTo([], ["1"])]).toEqual([]);
  });
});

describe("sendStateOf", () => {
  test("maps the send state of a local echo", () => {
    expect(sendStateOf({ tag: "NotSentYet", inner: { progress: undefined } })).toBe("pending");
    expect(sendStateOf({ tag: "SendingFailed", inner: { isRecoverable: true } })).toBe("failed");
    expect(sendStateOf({ tag: "Sent", inner: { eventId: "$1" } })).toBe("sent");
  });

  test("a remote event has no send state and counts as sent", () => {
    expect(sendStateOf(undefined)).toBe("sent");
  });
});

describe("senderNameOf", () => {
  test("prefers the display name of a ready profile", () => {
    const profile = { tag: "Ready", inner: { displayName: "Rui", displayNameAmbiguous: false } };
    expect(senderNameOf(RUI, profile)).toBe("Rui");
  });

  test("falls back to the localpart when the profile is not there yet", () => {
    expect(senderNameOf(RUI, { tag: "Pending" })).toBe("rui");
    expect(senderNameOf(RUI, { tag: "Ready", inner: { displayName: undefined } })).toBe("rui");
    expect(localpartOf("@rui:kazimo.test")).toBe("rui");
    expect(localpartOf("rui")).toBe("rui");
  });
});

describe("receiptUserIdsOf", () => {
  test("reads the user ids of a receipt map", () => {
    expect(receiptUserIdsOf(new Map([[RUI, { timestamp: 1n }]]))).toEqual([RUI]);
  });

  test("reads them from a plain record too", () => {
    expect(receiptUserIdsOf({ [RUI]: {} })).toEqual([RUI]);
  });

  test("no receipt at all yields nothing", () => {
    expect(receiptUserIdsOf(undefined)).toEqual([]);
  });
});

describe("typingNamesOf", () => {
  const nameOf = (userId: string) => (userId === RUI ? "Rui" : "Ana");

  test("keeps the names of the others who are typing", () => {
    expect(typingNamesOf([RUI, "@ana:kazimo.test"], ME, nameOf)).toEqual(["Rui", "Ana"]);
  });

  test("never reports myself", () => {
    expect(typingNamesOf([ME, RUI], ME, nameOf)).toEqual(["Rui"]);
  });
});

describe("imageInfoOf", () => {
  test("describes the photo with its dimensions and blurhash", () => {
    expect(
      imageInfoOf({ uri: "file:///a.jpg", width: 2048, height: 1536, size: 4096, blurhash: "LEHV6" }),
    ).toEqual({
      width: 2048n,
      height: 1536n,
      size: 4096n,
      mimetype: "image/jpeg",
      blurhash: "LEHV6",
    });
  });

  test("leaves the blurhash out when there is none", () => {
    const info = imageInfoOf({
      uri: "file:///a.jpg",
      width: 10,
      height: 10,
      size: 12,
      blurhash: null,
    });
    expect(info.blurhash).toBe(undefined);
  });
});

describe("uploadPathOf", () => {
  test("the rust sdk wants a system path, not a file uri", () => {
    expect(uploadPathOf("file:///var/photo.jpg")).toBe("/var/photo.jpg");
    expect(uploadPathOf("/var/photo.jpg")).toBe("/var/photo.jpg");
  });
});

describe("statusOf", () => {
  const statuses = (entries: Parameters<typeof chatItemsOf>[0]) =>
    messages(chatItemsOf(entries, ME)).map(statusOf);

  test("a failed message never reads as delivered", () => {
    expect(statuses([entry({ id: "1", senderId: ME, sendState: "failed" })])).toEqual(["failed"]);
  });

  test("follows the delivery state of the other outgoing messages", () => {
    const entries = [
      entry({ id: "1", senderId: ME, sendState: "pending" }),
      entry({ id: "2", senderId: ME, timestamp: at(20, 10) }),
    ];
    expect(statuses(entries)).toEqual(["pending", "sent"]);
  });

  test("nothing to show on a message received or on a day marker", () => {
    expect(statuses([entry({ id: "1" })])).toEqual([null]);
    expect(chatItemsOf([entry({ id: "1" })], ME).map(statusOf)[0]).toBe(null);
  });
});
