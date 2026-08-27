import { describe, expect, test } from "bun:test";
import type { Strings } from "./i18n";
import { missedCallContent, roomIdOfNotificationResponse } from "./notifications";

const ROOM = "!room:kazimo.dev";
const strings = { missedCall: "Chamada perdida" } as Strings;

const response = (data: unknown) => ({ notification: { request: { content: { data } } } });

describe("missedCallContent", () => {
  test("carries the caller as the body and the room as the payload", () => {
    expect(missedCallContent(strings, "Vovo", ROOM)).toEqual({
      title: "Chamada perdida",
      body: "Vovo",
      data: { roomId: ROOM },
    });
  });
});

describe("roomIdOfNotificationResponse", () => {
  test("digs the room out of a real response", () => {
    expect(roomIdOfNotificationResponse(response({ roomId: ROOM }))).toBe(ROOM);
  });

  test("stays null when the payload carries no room", () => {
    expect(roomIdOfNotificationResponse(response({}))).toBeNull();
    expect(roomIdOfNotificationResponse(response({ roomId: "" }))).toBeNull();
    expect(roomIdOfNotificationResponse({ notification: {} })).toBeNull();
  });

  test("survives garbage without throwing", () => {
    expect(roomIdOfNotificationResponse(null)).toBeNull();
    expect(roomIdOfNotificationResponse(undefined)).toBeNull();
    expect(roomIdOfNotificationResponse(7)).toBeNull();
    expect(roomIdOfNotificationResponse("nope")).toBeNull();
    expect(roomIdOfNotificationResponse(response({ roomId: 42 }))).toBeNull();
    expect(roomIdOfNotificationResponse({ notification: { request: "gone" } })).toBeNull();
  });
});
