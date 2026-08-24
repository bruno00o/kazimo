import { describe, expect, test } from "bun:test";
import { CONTACT_EVENT_TYPE, CONTROL_ADMIN_POWER_LEVEL, contactStateKeyOf } from "@kazimo/shared";
import {
  contactsToProvision,
  desiredContacts,
  directRoomsByPeer,
  displayNameOf,
  removedContacts,
  repairedPowerLevels,
} from "./contacts";

const FRAME = "@kazimo:example.org";
const MARIA = "@maria:example.org";
const JOAO = "@joao:example.org";

describe("desiredContacts", () => {
  test("keeps named contacts and drops emptied or invalid ones", () => {
    const desired = desiredContacts([
      { stateKey: contactStateKeyOf(MARIA), content: { name: "Maria" } },
      { stateKey: contactStateKeyOf(JOAO), content: {} },
      { stateKey: "not-a-user", content: { name: "Nobody" } },
      { stateKey: "ana:example.org", content: { name: "   " } },
      { stateKey: "@rita:example.org", content: { name: "Rita" } },
    ]);
    expect([...desired.keys()]).toEqual([MARIA]);
    expect(desired.get(MARIA)).toEqual({ userId: MARIA, name: "Maria" });
  });

  test("last event for a user id wins", () => {
    const desired = desiredContacts([
      { stateKey: contactStateKeyOf(MARIA), content: { name: "Maria" } },
      { stateKey: contactStateKeyOf(MARIA), content: { name: "Mae" } },
    ]);
    expect(desired.get(MARIA)?.name).toBe("Mae");
  });
});

describe("removedContacts", () => {
  test("emptied contact events are removals, named ones are not", () => {
    const removed = removedContacts([
      { stateKey: contactStateKeyOf(MARIA), content: { name: "Maria" } },
      { stateKey: contactStateKeyOf(JOAO), content: {} },
      { stateKey: "", content: {} },
    ]);
    expect([...removed]).toEqual([JOAO]);
  });
});

describe("directRoomsByPeer", () => {
  test("maps two member rooms to their peer, ignoring control and group rooms", () => {
    const rooms = directRoomsByPeer(
      [
        { roomId: "!dm-maria", isControl: false, memberIds: [FRAME, MARIA] },
        { roomId: "!control", isControl: true, memberIds: [FRAME, JOAO] },
        { roomId: "!group", isControl: false, memberIds: [FRAME, MARIA, JOAO] },
      ],
      FRAME,
    );
    expect(rooms.get(MARIA)).toBe("!dm-maria");
    expect(rooms.has(JOAO)).toBe(false);
  });

  test("first room wins when a peer has several direct rooms", () => {
    const rooms = directRoomsByPeer(
      [
        { roomId: "!first", isControl: false, memberIds: [FRAME, MARIA] },
        { roomId: "!second", isControl: false, memberIds: [MARIA, FRAME] },
      ],
      FRAME,
    );
    expect(rooms.get(MARIA)).toBe("!first");
  });
});

describe("contactsToProvision", () => {
  test("only contacts without a direct room", () => {
    const desired = desiredContacts([
      { stateKey: contactStateKeyOf(MARIA), content: { name: "Maria" } },
      { stateKey: contactStateKeyOf(JOAO), content: { name: "Joao" } },
    ]);
    const existing = directRoomsByPeer(
      [{ roomId: "!dm", isControl: false, memberIds: [FRAME, MARIA] }],
      FRAME,
    );
    expect(contactsToProvision(desired, existing)).toEqual([{ userId: JOAO, name: "Joao" }]);
  });

  test("nothing to do when every contact has a room", () => {
    const desired = desiredContacts([{ stateKey: contactStateKeyOf(MARIA), content: { name: "Maria" } }]);
    const existing = directRoomsByPeer(
      [{ roomId: "!dm", isControl: false, memberIds: [FRAME, MARIA] }],
      FRAME,
    );
    expect(contactsToProvision(desired, existing)).toEqual([]);
  });
});

describe("repairedPowerLevels", () => {
  test("adds the contact entry without touching the rest", () => {
    const repaired = repairedPowerLevels({
      users: { [FRAME]: 100 },
      events: { "m.room.name": 50 },
      state_default: 50,
      notifications: { room: 50 },
    });
    expect(repaired).toEqual({
      users: { [FRAME]: 100 },
      events: { "m.room.name": 50, [CONTACT_EVENT_TYPE]: CONTROL_ADMIN_POWER_LEVEL },
      state_default: 50,
      notifications: { room: 50 },
    });
  });

  test("no repair when the entry is already present", () => {
    expect(repairedPowerLevels({ events: { [CONTACT_EVENT_TYPE]: 100 } })).toBeNull();
    expect(repairedPowerLevels({ events: { [CONTACT_EVENT_TYPE]: 50 } })).toBeNull();
  });

  test("repair of a missing or malformed events map", () => {
    expect(repairedPowerLevels({})).toEqual({ events: { [CONTACT_EVENT_TYPE]: CONTROL_ADMIN_POWER_LEVEL } });
    expect(repairedPowerLevels(null)).toEqual({
      events: { [CONTACT_EVENT_TYPE]: CONTROL_ADMIN_POWER_LEVEL },
    });
    expect(repairedPowerLevels({ events: "broken" })).toEqual({
      events: { [CONTACT_EVENT_TYPE]: CONTROL_ADMIN_POWER_LEVEL },
    });
  });

  test("repairing twice is a no operation", () => {
    const first = repairedPowerLevels({ events: { "m.room.name": 50 } });
    expect(repairedPowerLevels(first)).toBeNull();
  });
});

describe("displayNameOf", () => {
  test("the control room name overrides the matrix display name", () => {
    const desired = desiredContacts([{ stateKey: contactStateKeyOf(MARIA), content: { name: "Maria" } }]);
    expect(displayNameOf(desired, MARIA, "maria.silva")).toBe("Maria");
    expect(displayNameOf(desired, JOAO, "Joao Silva")).toBe("Joao Silva");
  });
});
