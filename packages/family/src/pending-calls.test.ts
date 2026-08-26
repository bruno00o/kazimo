import { describe, expect, test } from "bun:test";
import { RING_PAYLOAD_VERSION } from "@kazimo/shared";
import { createPendingRingCalls, pendingRingCallOf } from "./pending-calls";

const ROOM = "!room:kazimo.dev";
const OTHER_ROOM = "!other:kazimo.dev";
const CALL_ID = "11111111-2222-3333-4444-555555555555";
const NOW = 1_700_000_000_000;
const DEADLINE = 1_700_000_060;

const push = (overrides: Record<string, unknown> = {}) => ({
  v: RING_PAYLOAD_VERSION,
  roomId: ROOM,
  callId: CALL_ID,
  callerName: "Vovo",
  expiresAt: DEADLINE,
  ...overrides,
});

describe("pendingRingCallOf", () => {
  test("uppercases the call id so it matches the callkit uuid", () => {
    expect(pendingRingCallOf(push())).toEqual({
      uuid: CALL_ID.toUpperCase(),
      roomId: ROOM,
      callerName: "Vovo",
      expiresAt: DEADLINE,
    });
  });

  test("a malformed payload is nothing to adopt", () => {
    expect(pendingRingCallOf(push({ v: 2 }))).toBeNull();
    expect(pendingRingCallOf(push({ roomId: "nope" }))).toBeNull();
    expect(pendingRingCallOf("junk")).toBeNull();
  });
});

describe("createPendingRingCalls", () => {
  test("remembers a live push and finds it by room and by uuid", () => {
    const pending = createPendingRingCalls();
    const call = pending.remember(push(), NOW);
    expect(call?.uuid).toBe(CALL_ID.toUpperCase());
    expect(pending.forRoom(ROOM, NOW)).toEqual(call);
    expect(pending.forUuid(CALL_ID.toUpperCase(), NOW)).toEqual(call);
  });

  test("refuses a malformed payload", () => {
    const pending = createPendingRingCalls();
    expect(pending.remember(push({ callerName: "" }), NOW)).toBeNull();
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
  });

  test("refuses a push that is already past its deadline", () => {
    const pending = createPendingRingCalls();
    expect(pending.remember(push(), DEADLINE * 1000)).toBeNull();
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
  });

  test("keeps only the most recent push per room", () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const second = pending.remember(push({ callId: "99999999-2222-3333-4444-555555555555" }), NOW);
    expect(pending.forRoom(ROOM, NOW)).toEqual(second);
    expect(pending.forUuid(CALL_ID.toUpperCase(), NOW)).toBeNull();
  });

  test("an entry past its deadline is gone on read", () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    expect(pending.forRoom(ROOM, DEADLINE * 1000)).toBeNull();
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
  });

  test("expire hands back the dead entries once and drops them", () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    pending.remember(push({ roomId: OTHER_ROOM, expiresAt: DEADLINE + 60 }), NOW);
    expect(pending.expire(DEADLINE * 1000)).toEqual([
      { uuid: CALL_ID.toUpperCase(), roomId: ROOM, callerName: "Vovo", expiresAt: DEADLINE },
    ]);
    expect(pending.expire(DEADLINE * 1000)).toEqual([]);
    expect(pending.forRoom(OTHER_ROOM, DEADLINE * 1000)).not.toBeNull();
  });

  test("forget and clear drop what the call center has taken over", () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    pending.forget(ROOM);
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
    pending.remember(push(), NOW);
    pending.clear();
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
  });

  test("watchers hear every live push until they unsubscribe", () => {
    const pending = createPendingRingCalls();
    const seen: string[] = [];
    const off = pending.watch((call) => seen.push(call.roomId));
    pending.remember(push(), NOW);
    pending.remember(push({ roomId: "nope" }), NOW);
    off();
    pending.remember(push({ roomId: OTHER_ROOM }), NOW);
    expect(seen).toEqual([ROOM]);
  });
});
