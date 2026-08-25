import { describe, expect, test } from "bun:test";
import {
  adminSignalOf,
  contactsOf,
  frameLinkFromState,
  frameLinkOf,
  stateEventsOf,
} from "./frame";

const FRAME = "@frame:matrix.example.org";
const ME = "@ana:matrix.example.org";
const CONTROL_ROOM = "!control:matrix.example.org";

const stateEvent = (type: string, stateKey: string, content: unknown, sender = FRAME) => ({
  type,
  state_key: stateKey,
  sender,
  content,
  event_id: `$${type}${stateKey}`,
  room_id: CONTROL_ROOM,
  origin_server_ts: 1,
});

const created = () => stateEvent("m.room.create", "", { room_version: "11" });
const marker = () => stateEvent("dev.kazimo.control", "", {});
const contact = (userId: string, name: string) => stateEvent("dev.kazimo.contact", userId.slice(1), { name });

describe("frameLinkOf", () => {
  test("reads a stored link", () => {
    expect(frameLinkOf(JSON.stringify({ frameUserId: FRAME, controlRoomId: CONTROL_ROOM }))).toEqual({
      frameUserId: FRAME,
      controlRoomId: CONTROL_ROOM,
    });
  });

  test("ignores extra fields", () => {
    expect(
      frameLinkOf(JSON.stringify({ frameUserId: FRAME, controlRoomId: CONTROL_ROOM, paired: 12 })),
    ).toEqual({ frameUserId: FRAME, controlRoomId: CONTROL_ROOM });
  });

  test("rejects an absent or unreadable value", () => {
    expect(frameLinkOf(undefined)).toBeNull();
    expect(frameLinkOf("")).toBeNull();
    expect(frameLinkOf("not json")).toBeNull();
    expect(frameLinkOf("null")).toBeNull();
    expect(frameLinkOf("[]")).toBeNull();
  });

  test("rejects identifiers that are not a user and a room", () => {
    expect(frameLinkOf(JSON.stringify({ frameUserId: FRAME }))).toBeNull();
    expect(frameLinkOf(JSON.stringify({ controlRoomId: CONTROL_ROOM }))).toBeNull();
    expect(frameLinkOf(JSON.stringify({ frameUserId: "frame", controlRoomId: CONTROL_ROOM }))).toBeNull();
    expect(frameLinkOf(JSON.stringify({ frameUserId: FRAME, controlRoomId: "control" }))).toBeNull();
    expect(
      frameLinkOf(JSON.stringify({ frameUserId: FRAME, controlRoomId: CONTROL_ROOM.slice(1) })),
    ).toBeNull();
    expect(frameLinkOf(JSON.stringify({ frameUserId: 1, controlRoomId: 2 }))).toBeNull();
  });
});

describe("stateEventsOf", () => {
  test("keeps the fields the frame protocol relies on", () => {
    expect(stateEventsOf([marker()])).toEqual([
      { type: "dev.kazimo.control", stateKey: "", sender: FRAME, content: {} },
    ]);
  });

  test("drops entries without a type or a state key", () => {
    expect(stateEventsOf([{ type: "m.room.message", content: {} }, { state_key: "" }, null, 3])).toEqual([]);
  });

  test("tolerates a payload that is not a list", () => {
    expect(stateEventsOf(undefined)).toEqual([]);
    expect(stateEventsOf({ rooms: [] })).toEqual([]);
  });
});

describe("contactsOf", () => {
  test("maps the contact state events, sorted by name", () => {
    expect(
      contactsOf([created(), marker(), contact("@zeca:s.org", "Zeca"), contact("@ana:s.org", "Ana")]),
    ).toEqual([
      { userId: "@ana:s.org", name: "Ana" },
      { userId: "@zeca:s.org", name: "Zeca" },
    ]);
  });

  test("treats an emptied content as removed", () => {
    expect(
      contactsOf([contact("@ana:s.org", "Ana"), stateEvent("dev.kazimo.contact", "zeca:s.org", {})]),
    ).toEqual([{ userId: "@ana:s.org", name: "Ana" }]);
  });

  test("trims the name and drops a blank one", () => {
    expect(contactsOf([contact("@ana:s.org", "  Ana  "), contact("@zeca:s.org", "   ")])).toEqual([
      { userId: "@ana:s.org", name: "Ana" },
    ]);
  });

  test("ignores a state key that is not a user id", () => {
    expect(
      contactsOf([
        stateEvent("dev.kazimo.contact", "ana", { name: "Ana" }),
        stateEvent("dev.kazimo.contact", "@ana:s.org", { name: "Ana" }),
      ]),
    ).toEqual([]);
  });

  test("ignores every other state event", () => {
    expect(contactsOf([created(), marker(), stateEvent("m.room.name", "", { name: "Kazimo" })])).toEqual([]);
  });
});

describe("frameLinkFromState", () => {
  test("reads the frame from the room creator of a marked room", () => {
    expect(frameLinkFromState(CONTROL_ROOM, [created(), marker()], ME)).toEqual({
      frameUserId: FRAME,
      controlRoomId: CONTROL_ROOM,
    });
  });

  test("ignores a room without the control marker", () => {
    expect(frameLinkFromState(CONTROL_ROOM, [created()], ME)).toBeNull();
    expect(
      frameLinkFromState(CONTROL_ROOM, [created(), stateEvent("dev.kazimo.control", "extra", {})], ME),
    ).toBeNull();
  });

  test("ignores a marked room this account created itself", () => {
    expect(
      frameLinkFromState(CONTROL_ROOM, [stateEvent("m.room.create", "", {}, ME), marker()], ME),
    ).toBeNull();
  });

  test("ignores a marked room with no readable creator", () => {
    expect(frameLinkFromState(CONTROL_ROOM, [marker()], ME)).toBeNull();
    expect(
      frameLinkFromState(CONTROL_ROOM, [stateEvent("m.room.create", "", {}, "frame"), marker()], ME),
    ).toBeNull();
  });

  test("ignores an identifier that is not a room", () => {
    expect(frameLinkFromState("control", [created(), marker()], ME)).toBeNull();
  });
});

describe("adminSignalOf", () => {
  test("true only for a root frame status event marking an admin", () => {
    expect(adminSignalOf([stateEvent("dev.kazimo.frame", "", { hasAdmin: true })])).toBe(true);
    expect(adminSignalOf([stateEvent("dev.kazimo.frame", "", { hasAdmin: false })])).toBe(false);
    expect(adminSignalOf([stateEvent("dev.kazimo.frame", "", {})])).toBe(false);
    expect(adminSignalOf([stateEvent("dev.kazimo.frame", "extra", { hasAdmin: true })])).toBe(false);
    expect(adminSignalOf([created(), marker()])).toBe(false);
    expect(adminSignalOf(undefined)).toBe(false);
  });
});
