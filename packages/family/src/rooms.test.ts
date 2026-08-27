import { describe, expect, test } from "bun:test";
import {
  defaultServerFrom,
  directRoomsOf,
  isFrameInvite,
  localpartOf,
  normalizeMatrixId,
  type RoomInvite,
  rtcPowerLevelOverride,
  withDirectRoom,
} from "./rooms";

const SERVER = "matrix.example.org";

describe("normalizeMatrixId", () => {
  test("keeps a full id and lowercases the server", () => {
    expect(normalizeMatrixId("@Ana:Matrix.Example.ORG", SERVER)).toBe("@Ana:matrix.example.org");
  });

  test("adds the leading sigil", () => {
    expect(normalizeMatrixId("ana:matrix.example.org", SERVER)).toBe("@ana:matrix.example.org");
  });

  test("completes a bare localpart with the default server", () => {
    expect(normalizeMatrixId("ana", SERVER)).toBe("@ana:matrix.example.org");
    expect(normalizeMatrixId("@ana", SERVER)).toBe("@ana:matrix.example.org");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeMatrixId("  @ana:matrix.example.org  ", SERVER)).toBe("@ana:matrix.example.org");
  });

  test("keeps the localpart case", () => {
    expect(normalizeMatrixId("Ana.Maria", SERVER)).toBe("@Ana.Maria:matrix.example.org");
  });

  test("keeps an explicit port", () => {
    expect(normalizeMatrixId("ana:Example.org:8448", SERVER)).toBe("@ana:example.org:8448");
  });

  test("accepts the localpart characters allowed by the spec", () => {
    expect(normalizeMatrixId("a_b.c=d/e+f-g", SERVER)).toBe("@a_b.c=d/e+f-g:matrix.example.org");
  });

  test("accepts a server without a dot", () => {
    expect(normalizeMatrixId("ana:localhost", SERVER)).toBe("@ana:localhost");
  });

  test("rejects empty input", () => {
    expect(normalizeMatrixId("", SERVER)).toBeNull();
    expect(normalizeMatrixId("   ", SERVER)).toBeNull();
    expect(normalizeMatrixId("@", SERVER)).toBeNull();
  });

  test("rejects a missing localpart", () => {
    expect(normalizeMatrixId(":matrix.example.org", SERVER)).toBeNull();
    expect(normalizeMatrixId("@:matrix.example.org", SERVER)).toBeNull();
  });

  test("rejects a missing server", () => {
    expect(normalizeMatrixId("ana:", SERVER)).toBeNull();
    expect(normalizeMatrixId("ana", "")).toBeNull();
    expect(normalizeMatrixId("ana", "not a server")).toBeNull();
  });

  test("rejects an email shaped input", () => {
    expect(normalizeMatrixId("ana@example.org", SERVER)).toBeNull();
    expect(normalizeMatrixId("@ana@example.org", SERVER)).toBeNull();
  });

  test("rejects spaces and forbidden characters in the localpart", () => {
    expect(normalizeMatrixId("an a:matrix.example.org", SERVER)).toBeNull();
    expect(normalizeMatrixId("an,a:matrix.example.org", SERVER)).toBeNull();
  });

  test("rejects a malformed server name", () => {
    expect(normalizeMatrixId("ana:-example.org", SERVER)).toBeNull();
    expect(normalizeMatrixId("ana:example-.org", SERVER)).toBeNull();
    expect(normalizeMatrixId("ana:example..org", SERVER)).toBeNull();
    expect(normalizeMatrixId("ana:example.org/room", SERVER)).toBeNull();
    expect(normalizeMatrixId("ana:example.org:port", SERVER)).toBeNull();
  });
});

describe("defaultServerFrom", () => {
  test("reads the host of a homeserver url", () => {
    expect(defaultServerFrom("https://matrix.example.org")).toBe("matrix.example.org");
    expect(defaultServerFrom("https://Matrix.Example.org/")).toBe("matrix.example.org");
    expect(defaultServerFrom("  http://matrix.example.org/_matrix  ")).toBe("matrix.example.org");
  });

  test("keeps the port", () => {
    expect(defaultServerFrom("https://matrix.example.org:8448")).toBe("matrix.example.org:8448");
  });

  test("accepts a bare host", () => {
    expect(defaultServerFrom("matrix.example.org")).toBe("matrix.example.org");
  });

  test("rejects what is not a host", () => {
    expect(defaultServerFrom("")).toBeNull();
    expect(defaultServerFrom("https://")).toBeNull();
    expect(defaultServerFrom("https://matrix example org")).toBeNull();
  });
});

describe("rtcPowerLevelOverride", () => {
  test("sets the three rtc member event types to zero", () => {
    const levels = rtcPowerLevelOverride([]);
    expect([...levels.events.entries()].sort()).toEqual([
      ["io.element.rtc.member", 0],
      ["m.rtc.member", 0],
      ["org.matrix.msc3401.call.member", 0],
    ]);
  });

  test("keeps the given users at the admin level", () => {
    const levels = rtcPowerLevelOverride(["@me:example.org", "@ana:example.org"]);
    expect([...levels.users.entries()]).toEqual([
      ["@me:example.org", 100],
      ["@ana:example.org", 100],
    ]);
  });
});

describe("directRoomsOf", () => {
  test("reads a stored map", () => {
    expect(directRoomsOf('{"@ana:example.org":["!a:example.org"]}')).toEqual({
      "@ana:example.org": ["!a:example.org"],
    });
  });

  test("falls back to an empty map", () => {
    expect(directRoomsOf(undefined)).toEqual({});
    expect(directRoomsOf("")).toEqual({});
    expect(directRoomsOf("not json")).toEqual({});
    expect(directRoomsOf("[]")).toEqual({});
    expect(directRoomsOf("null")).toEqual({});
  });

  test("drops entries that are not room lists", () => {
    expect(
      directRoomsOf('{"@ana:example.org":"!a:example.org","@bo:example.org":["!b:example.org",7]}'),
    ).toEqual({ "@bo:example.org": ["!b:example.org"] });
  });
});

describe("withDirectRoom", () => {
  test("adds a first room for a user", () => {
    expect(withDirectRoom({}, "@ana:example.org", "!a:example.org")).toEqual({
      "@ana:example.org": ["!a:example.org"],
    });
  });

  test("keeps the rooms of the other users", () => {
    const current = { "@bo:example.org": ["!b:example.org"] };
    expect(withDirectRoom(current, "@ana:example.org", "!a:example.org")).toEqual({
      "@bo:example.org": ["!b:example.org"],
      "@ana:example.org": ["!a:example.org"],
    });
    expect(current).toEqual({ "@bo:example.org": ["!b:example.org"] });
  });

  test("appends to the rooms already known for that user", () => {
    const current = { "@ana:example.org": ["!a:example.org"] };
    expect(withDirectRoom(current, "@ana:example.org", "!second:example.org")).toEqual({
      "@ana:example.org": ["!a:example.org", "!second:example.org"],
    });
  });

  test("returns the same map when the room is already known", () => {
    const current = { "@ana:example.org": ["!a:example.org"] };
    expect(withDirectRoom(current, "@ana:example.org", "!a:example.org")).toBe(current);
  });
});

describe("localpartOf", () => {
  test("strips the sigil and the server", () => {
    expect(localpartOf("@ana:matrix.example.org")).toBe("ana");
    expect(localpartOf("ana:matrix.example.org")).toBe("ana");
    expect(localpartOf("ana")).toBe("ana");
  });
});

describe("isFrameInvite", () => {
  const FRAME = "@frame:example.org";
  const CONTROL_ROOM = "!control:example.org";

  const invite = (roomId: string, inviterId: string): RoomInvite => ({
    roomId,
    name: "Kazimo",
    avatarUrl: null,
    inviterId,
    inviterName: "Kazimo",
  });

  const scope = { controlRoomId: CONTROL_ROOM, frameUserIds: [FRAME] };

  test("accepts the control room whoever invited", () => {
    expect(isFrameInvite(invite(CONTROL_ROOM, "@ana:example.org"), scope)).toBe(true);
  });

  test("accepts any room the frame invited to", () => {
    expect(isFrameInvite(invite("!dm:example.org", FRAME), scope)).toBe(true);
  });

  test("leaves the invites of other people to the user", () => {
    expect(isFrameInvite(invite("!group:example.org", "@rui:example.org"), scope)).toBe(false);
  });

  test("asks for everything when no frame is known", () => {
    const unpaired = { controlRoomId: null, frameUserIds: [] };
    expect(isFrameInvite(invite("!dm:example.org", FRAME), unpaired)).toBe(false);
  });
});
