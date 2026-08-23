/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { EventStatus, type IContent, type IEvent, type MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { localDayKey, messageOf, sendText, toChatItems } from "./timeline";

const ROOM_ID = "!room:kazimo.test";
const ME = "@avo:kazimo.test";
const RUI = "@rui:kazimo.test";

const at = (day: number, hour: number) => new Date(2026, 7, day, hour, 0, 0).getTime();

const nameOf = (userId: string) => (userId === RUI ? "Rui" : "Avo");

const redactionOf = (targetId: string): IEvent => ({
  event_id: `${targetId}-redaction`,
  room_id: ROOM_ID,
  sender: RUI,
  type: "m.room.redaction",
  origin_server_ts: 0,
  content: {},
  unsigned: {},
  redacts: targetId,
});

const eventOf = (
  id: string,
  sender: string,
  timestamp: number,
  content: IContent,
  extra: { type?: string; redacted?: boolean } = {},
) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type: extra.type ?? "m.room.message",
    origin_server_ts: timestamp,
    content,
    unsigned: extra.redacted ? { redacted_because: redactionOf(id) } : {},
  });

const textEvent = (id: string, sender: string, timestamp: number, body: string) =>
  eventOf(id, sender, timestamp, { msgtype: "m.text", body });

const messages = (items: ReturnType<typeof toChatItems>) => items.filter((item) => item.kind !== "dayMarker");

describe("messageOf", () => {
  test("maps text, emote and notice to text", () => {
    for (const msgtype of ["m.text", "m.emote", "m.notice"]) {
      const event = eventOf("$1", RUI, at(20, 9), { msgtype, body: "bom dia" });
      expect(messageOf(event)).toEqual({ kind: "text", body: "bom dia" });
    }
  });

  test("ignores non message events and unsupported msgtypes", () => {
    expect(messageOf(eventOf("$1", RUI, at(20, 9), { name: "Familia" }, { type: "m.room.name" }))).toBe(null);
    expect(messageOf(eventOf("$2", RUI, at(20, 9), { msgtype: "m.file", url: "mxc://x/y" }))).toBe(null);
  });

  test("reads blurhash and dimensions from info", () => {
    const event = eventOf("$1", RUI, at(20, 9), {
      msgtype: "m.image",
      body: "praia.jpg",
      url: "mxc://kazimo.test/praia",
      info: { w: 1600, h: 900, "xyz.amorgan.blurhash": "LEHV6nWB2yk8" },
    });
    expect(messageOf(event)).toEqual({
      kind: "image",
      mxc: "mxc://kazimo.test/praia",
      width: 1600,
      height: 900,
      blurhash: "LEHV6nWB2yk8",
      caption: null,
    });
  });

  test("missing image info yields nulls", () => {
    const event = eventOf("$1", RUI, at(20, 9), {
      msgtype: "m.image",
      body: "praia.jpg",
      url: "mxc://kazimo.test/praia",
    });
    expect(messageOf(event)).toEqual({
      kind: "image",
      mxc: "mxc://kazimo.test/praia",
      width: null,
      height: null,
      blurhash: null,
      caption: null,
    });
  });

  test("caption is the body only when filename differs from it", () => {
    const withCaption = eventOf("$1", RUI, at(20, 9), {
      msgtype: "m.image",
      body: "a praia hoje",
      filename: "praia.jpg",
      url: "mxc://kazimo.test/praia",
    });
    const withoutCaption = eventOf("$2", RUI, at(20, 9), {
      msgtype: "m.image",
      body: "praia.jpg",
      filename: "praia.jpg",
      url: "mxc://kazimo.test/praia",
    });
    expect(messageOf(withCaption)).toMatchObject({ caption: "a praia hoje" });
    expect(messageOf(withoutCaption)).toMatchObject({ caption: null });
  });

  test("an image without a url is not renderable", () => {
    expect(messageOf(eventOf("$1", RUI, at(20, 9), { msgtype: "m.image", body: "praia.jpg" }))).toBe(null);
  });

  test("skips redacted events", () => {
    const event = eventOf("$1", RUI, at(20, 9), { msgtype: "m.text", body: "apagado" }, { redacted: true });
    expect(messageOf(event)).toBe(null);
  });

  test("skips edits and reactions, which are not standalone messages", () => {
    const edit = eventOf("$edit", RUI, at(20, 9), {
      msgtype: "m.text",
      body: "* corrigido",
      "m.new_content": { msgtype: "m.text", body: "corrigido" },
      "m.relates_to": { rel_type: "m.replace", event_id: "$1" },
    });
    const reaction = eventOf(
      "$reaction",
      RUI,
      at(20, 9),
      { "m.relates_to": { rel_type: "m.annotation", event_id: "$1", key: "love" } },
      { type: "m.reaction" },
    );
    expect(messageOf(edit)).toBe(null);
    expect(messageOf(reaction)).toBe(null);
  });

  test("renders the replacement content of an edited event", () => {
    const original = textEvent("$1", RUI, at(20, 9), "bom dai");
    const edit = eventOf("$edit", RUI, at(20, 10), {
      msgtype: "m.text",
      body: "* bom dia",
      "m.new_content": { msgtype: "m.text", body: "bom dia" },
      "m.relates_to": { rel_type: "m.replace", event_id: "$1" },
    });
    original.makeReplaced(edit);
    expect(messageOf(original)).toEqual({ kind: "text", body: "bom dia" });
  });

  test("an edit can turn an image caption into a new one", () => {
    const original = eventOf("$1", RUI, at(20, 9), {
      msgtype: "m.image",
      body: "praia.jpg",
      filename: "praia.jpg",
      url: "mxc://kazimo.test/praia",
    });
    const edit = eventOf("$edit", RUI, at(20, 10), {
      msgtype: "m.image",
      body: "* a praia hoje",
      "m.new_content": {
        msgtype: "m.image",
        body: "a praia hoje",
        filename: "praia.jpg",
        url: "mxc://kazimo.test/praia",
      },
      "m.relates_to": { rel_type: "m.replace", event_id: "$1" },
    });
    original.makeReplaced(edit);
    expect(messageOf(original)).toMatchObject({ caption: "a praia hoje" });
  });
});

describe("toChatItems", () => {
  test("carries sender identity and resolves the display name", () => {
    const items = toChatItems([textEvent("$1", RUI, at(20, 9), "bom dia")], ME, nameOf);
    expect(items).toEqual([
      { kind: "dayMarker", id: "day:2026-08-20", timestamp: at(20, 9) },
      {
        kind: "text",
        id: "$1",
        senderId: RUI,
        senderName: "Rui",
        body: "bom dia",
        timestamp: at(20, 9),
        mine: false,
        pending: false,
        failed: false,
      },
    ]);
  });

  test("flags my own messages", () => {
    const items = messages(toChatItems([textEvent("$1", ME, at(20, 9), "ola")], ME, nameOf));
    expect(items[0]).toMatchObject({ mine: true, pending: false, failed: false });
  });

  test("flags local echoes as pending and rejected ones as failed", () => {
    const sending = textEvent("$1", ME, at(20, 9), "a caminho");
    sending.setStatus(EventStatus.SENDING);
    const queued = textEvent("$2", ME, at(20, 10), "na fila");
    queued.setStatus(EventStatus.QUEUED);
    const encrypting = textEvent("$3", ME, at(20, 11), "a cifrar");
    encrypting.setStatus(EventStatus.ENCRYPTING);
    const failed = textEvent("$4", ME, at(20, 12), "falhou");
    failed.setStatus(EventStatus.NOT_SENT);
    const sent = textEvent("$5", ME, at(20, 13), "entregue");
    sent.setStatus(EventStatus.SENT);

    const items = messages(toChatItems([sending, queued, encrypting, failed, sent], ME, nameOf));
    expect(items.map((item) => ({ pending: item.pending, failed: item.failed }))).toEqual([
      { pending: true, failed: false },
      { pending: true, failed: false },
      { pending: true, failed: false },
      { pending: false, failed: true },
      { pending: false, failed: false },
    ]);
  });

  test("drops redacted, edit and reaction events from the list", () => {
    const edit = eventOf("$edit", RUI, at(20, 10), {
      msgtype: "m.text",
      body: "* bom dia",
      "m.new_content": { msgtype: "m.text", body: "bom dia" },
      "m.relates_to": { rel_type: "m.replace", event_id: "$1" },
    });
    const original = textEvent("$1", RUI, at(20, 9), "bom dai");
    original.makeReplaced(edit);
    const redacted = eventOf(
      "$2",
      RUI,
      at(20, 11),
      { msgtype: "m.text", body: "apagado" },
      { redacted: true },
    );
    const reaction = eventOf(
      "$reaction",
      RUI,
      at(20, 12),
      { "m.relates_to": { rel_type: "m.annotation", event_id: "$1", key: "love" } },
      { type: "m.reaction" },
    );

    const items = messages(toChatItems([original, edit, redacted, reaction], ME, nameOf));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "$1", kind: "text", body: "bom dia" });
  });

  test("one day marker per calendar day, none within a day", () => {
    const items = toChatItems(
      [
        textEvent("$1", RUI, at(20, 9), "bom dia"),
        textEvent("$2", ME, at(20, 21), "boa noite"),
        textEvent("$3", RUI, at(21, 8), "ola"),
      ],
      ME,
      nameOf,
    );
    expect(items.map((item) => item.id)).toEqual(["day:2026-08-20", "$1", "$2", "day:2026-08-21", "$3"]);
  });

  test("a day marker uses the local date of the first message of the day", () => {
    const justBeforeMidnight = new Date(2026, 7, 20, 23, 59, 0).getTime();
    const items = toChatItems([textEvent("$1", RUI, justBeforeMidnight, "quase amanha")], ME, nameOf);
    expect(items[0]).toEqual({ kind: "dayMarker", id: "day:2026-08-20", timestamp: justBeforeMidnight });
    expect(localDayKey(justBeforeMidnight)).toBe("2026-08-20");
  });

  test("orders items chronologically whatever the input order", () => {
    const items = toChatItems(
      [
        textEvent("$3", RUI, at(21, 8), "ola"),
        textEvent("$1", RUI, at(20, 9), "bom dia"),
        textEvent("$2", ME, at(20, 21), "boa noite"),
      ],
      ME,
      nameOf,
    );
    expect(items.map((item) => item.id)).toEqual(["day:2026-08-20", "$1", "$2", "day:2026-08-21", "$3"]);
    expect(items.map((item) => item.timestamp)).toEqual([
      at(20, 9),
      at(20, 9),
      at(20, 21),
      at(21, 8),
      at(21, 8),
    ]);
  });

  test("keeps text and image side by side in one list", () => {
    const image = eventOf("$2", RUI, at(20, 10), {
      msgtype: "m.image",
      body: "a praia hoje",
      filename: "praia.jpg",
      url: "mxc://kazimo.test/praia",
      info: { w: 800, h: 600, "xyz.amorgan.blurhash": "LEHV6nWB2yk8" },
    });
    const items = messages(toChatItems([textEvent("$1", RUI, at(20, 9), "bom dia"), image], ME, nameOf));
    expect(items.map((item) => item.kind)).toEqual(["text", "image"]);
    expect(items[1]).toMatchObject({
      mxc: "mxc://kazimo.test/praia",
      width: 800,
      height: 600,
      blurhash: "LEHV6nWB2yk8",
      caption: "a praia hoje",
      senderName: "Rui",
    });
  });
});

describe("sendText", () => {
  test("delegates to the client without a thread id", async () => {
    const calls: Array<[string, string]> = [];
    const client = {
      sendTextMessage: async (roomId: string, body: string) => {
        calls.push([roomId, body]);
        return { event_id: "$sent" };
      },
    } as unknown as MatrixClient;

    await expect(sendText(client, ROOM_ID, "bom dia")).resolves.toEqual({ event_id: "$sent" });
    expect(calls).toEqual([[ROOM_ID, "bom dia"]]);
  });
});
