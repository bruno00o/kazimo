import { describe, expect, test } from "bun:test";
import { contactStateKeyOf } from "@kazimo/shared";
import { ringContentWithoutTokens, ringDevicesByUser, ringDevicesDiffer } from "./ring";

const MARIA = "@maria:example.org";
const JOAO = "@joao:example.org";

const phone = { deviceId: "PHONE", token: "a".repeat(64), updatedAt: 2000 };
const tablet = { deviceId: "TABLET", token: "b".repeat(64), updatedAt: 1000 };
const laptop = { deviceId: "LAPTOP", token: "c".repeat(64), updatedAt: 3000 };

describe("ringDevicesByUser", () => {
  test("maps a contact to the tokens published in the direct room, newest first", () => {
    expect(
      ringDevicesByUser([
        {
          peerUserId: MARIA,
          stateKey: contactStateKeyOf(MARIA),
          content: { deviceTokens: [tablet, phone] },
        },
      ]),
    ).toEqual({ [MARIA]: [phone.token, tablet.token] });
  });

  test("ignores a state key that does not belong to the room peer", () => {
    expect(
      ringDevicesByUser([
        { peerUserId: MARIA, stateKey: contactStateKeyOf(JOAO), content: { deviceTokens: [phone] } },
        { peerUserId: MARIA, stateKey: "not-a-user", content: { deviceTokens: [phone] } },
        { peerUserId: MARIA, stateKey: `@${contactStateKeyOf(MARIA)}`, content: { deviceTokens: [phone] } },
      ]),
    ).toEqual({});
  });

  test("an emptied or malformed event means the contact has no device", () => {
    expect(
      ringDevicesByUser([
        { peerUserId: MARIA, stateKey: contactStateKeyOf(MARIA), content: {} },
        { peerUserId: JOAO, stateKey: contactStateKeyOf(JOAO), content: { deviceTokens: "gone" } },
      ]),
    ).toEqual({});
  });

  test("merges the rooms a contact appears in without repeating a token", () => {
    expect(
      ringDevicesByUser([
        { peerUserId: MARIA, stateKey: contactStateKeyOf(MARIA), content: { deviceTokens: [phone] } },
        {
          peerUserId: MARIA,
          stateKey: contactStateKeyOf(MARIA),
          content: { deviceTokens: [phone, laptop] },
        },
      ]),
    ).toEqual({ [MARIA]: [phone.token, laptop.token] });
  });

  test("the map is ordered by user id so an unchanged reconcile stays silent", () => {
    const first = ringDevicesByUser([
      { peerUserId: MARIA, stateKey: contactStateKeyOf(MARIA), content: { deviceTokens: [phone] } },
      { peerUserId: JOAO, stateKey: contactStateKeyOf(JOAO), content: { deviceTokens: [tablet] } },
    ]);
    const second = ringDevicesByUser([
      { peerUserId: JOAO, stateKey: contactStateKeyOf(JOAO), content: { deviceTokens: [tablet] } },
      { peerUserId: MARIA, stateKey: contactStateKeyOf(MARIA), content: { deviceTokens: [phone] } },
    ]);
    expect(ringDevicesDiffer(first, second)).toBe(false);
  });
});

describe("ringDevicesDiffer", () => {
  test("a new token or a dropped contact is a change", () => {
    expect(ringDevicesDiffer({}, { [MARIA]: [phone.token] })).toBe(true);
    expect(ringDevicesDiffer({ [MARIA]: [phone.token] }, { [MARIA]: [tablet.token] })).toBe(true);
    expect(ringDevicesDiffer({ [MARIA]: [phone.token] }, { [MARIA]: [phone.token] })).toBe(false);
  });
});

describe("ringContentWithoutTokens", () => {
  test("rewrites the event without the dead token", () => {
    expect(ringContentWithoutTokens({ deviceTokens: [phone, tablet] }, [tablet.token])).toEqual({
      deviceTokens: [phone],
    });
  });

  test("no rewrite when the dead token is already gone", () => {
    expect(ringContentWithoutTokens({ deviceTokens: [phone] }, [tablet.token])).toBeNull();
    expect(ringContentWithoutTokens({}, [phone.token])).toBeNull();
  });
});
