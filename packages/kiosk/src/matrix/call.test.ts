import { describe, expect, test } from "bun:test";
import { orphanedDelayIds } from "./call";

const ROOM = "!room:example.org";

describe("orphanedDelayIds", () => {
  test("keeps scheduled rtc member events for the room", () => {
    const scheduled = [
      { delay_id: "a", room_id: ROOM, type: "m.rtc.member" },
      { delay_id: "b", room_id: ROOM, type: "org.matrix.msc3401.call.member" },
      { delay_id: "c", room_id: ROOM, type: "io.element.rtc.member" },
    ];
    expect(orphanedDelayIds(scheduled, ROOM)).toEqual(["a", "b", "c"]);
  });

  test("ignores other rooms and other event types", () => {
    const scheduled = [
      { delay_id: "a", room_id: "!other:example.org", type: "m.rtc.member" },
      { delay_id: "b", room_id: ROOM, type: "m.room.message" },
    ];
    expect(orphanedDelayIds(scheduled, ROOM)).toEqual([]);
  });

  test("drops malformed entries", () => {
    const scheduled = [
      { room_id: ROOM, type: "m.rtc.member" },
      { delay_id: 7, room_id: ROOM, type: "m.rtc.member" },
      { delay_id: "ok", room_id: ROOM, type: "m.rtc.member" },
      { delay_id: "x", room_id: ROOM },
    ];
    expect(orphanedDelayIds(scheduled, ROOM)).toEqual(["ok"]);
  });

  test("empty list yields nothing", () => {
    expect(orphanedDelayIds([], ROOM)).toEqual([]);
  });
});
