import { beforeEach, describe, expect, mock, test } from "bun:test";
import { RING_PAYLOAD_VERSION } from "@kazimo/shared";

const JOINED = "joined";

mock.module("@unomed/react-native-matrix-sdk", () => ({
  Membership: { Joined: JOINED },
  MediaSource: { fromUrl: (url: string) => ({ url }), fromJson: (json: string) => ({ json }) },
  messageEventContentFromMarkdown: (body: string) => ({ body }),
  ReceiptType: { Read: 0, ReadPrivate: 1, FullyRead: 2 },
  UploadSource: { File: class {} },
}));

mock.module("react-native", () => ({
  Platform: { OS: "ios" },
}));

type CallKeepListener = (event: { callUUID: string }) => void;

const calls = {
  displayed: [] as { uuid: string; handle: string; name: string }[],
  ended: [] as string[],
  active: [] as string[],
  endedAll: 0,
  listeners: new Map<string, CallKeepListener>(),
  buffered: [] as { name: string; data: { callUUID: string } }[],
};

mock.module("react-native-callkeep", () => ({
  AudioSessionCategoryOption: {
    allowBluetooth: 1,
    allowBluetoothA2DP: 2,
    allowAirPlay: 4,
    defaultToSpeaker: 8,
  },
  AudioSessionMode: { videoChat: "videoChat" },
  default: {
    setup: async () => undefined,
    setAvailable: () => undefined,
    displayIncomingCall: (uuid: string, handle: string, name: string) => {
      calls.displayed.push({ uuid, handle, name });
    },
    setCurrentCallActive: (uuid: string) => {
      calls.active.push(uuid);
    },
    backToForeground: () => undefined,
    endCall: (uuid: string) => {
      calls.ended.push(uuid);
    },
    endAllCalls: () => {
      calls.endedAll += 1;
    },
    addEventListener: (event: string, listener: CallKeepListener) => calls.listeners.set(event, listener),
    removeEventListener: (event: string) => calls.listeners.delete(event),
    getInitialEvents: async () => calls.buffered,
    clearInitialEvents: () => {
      calls.buffered = [];
    },
  },
}));

const { startCallCenter } = await import("./calls");
const { createPendingRingCalls } = await import("./pending-calls");
const { callUuid } = await import("./callkeep");

const ME = "@ana:kazimo.dev";
const CALLER = "@vovo:kazimo.dev";
const ROOM = "!room:kazimo.dev";
const CALL_ID = "11111111-2222-3333-4444-555555555555";
const PUSHED_UUID = CALL_ID.toUpperCase();
const NOW = Date.now();
const DEADLINE = Math.floor(NOW / 1000) + 60;

const push = (overrides: Record<string, unknown> = {}) => ({
  v: RING_PAYLOAD_VERSION,
  roomId: ROOM,
  callId: CALL_ID,
  callerName: "Vovo",
  expiresAt: DEADLINE,
  ...overrides,
});

const roomInfo = (ringing: boolean) => ({
  id: ROOM,
  membership: JOINED,
  hasRoomCall: ringing,
  activeRoomCallParticipants: ringing ? [CALLER] : [],
  heroes: [{ userId: CALLER, displayName: "Vovo" }],
  displayName: "Vovo",
});

const harness = async (pending: ReturnType<typeof createPendingRingCalls> | null) => {
  let notify: ((info: ReturnType<typeof roomInfo>) => void) | null = null;
  const room = {
    id: () => ROOM,
    subscribeToRoomInfoUpdates: ({ call }: { call: (info: ReturnType<typeof roomInfo>) => void }) => {
      notify = call;
      return { cancel: () => undefined };
    },
    roomInfo: async () => roomInfo(false),
  };
  const client = { userId: () => ME, rooms: () => [room] };
  const answers: { roomId: string; title: string }[] = [];
  const remoteEnds: string[] = [];
  const center = await startCallCenter(
    client as never,
    { onAnswer: (call) => answers.push(call), onRemoteEnd: (roomId) => remoteEnds.push(roomId) },
    {} as never,
    pending,
  );
  return {
    center,
    answers,
    remoteEnds,
    sync: (ringing: boolean) => notify?.(roomInfo(ringing)),
    answer: (uuid: string) => calls.listeners.get("answerCall")?.({ callUUID: uuid }),
    end: (uuid: string) => calls.listeners.get("endCall")?.({ callUUID: uuid }),
  };
};

beforeEach(() => {
  calls.displayed = [];
  calls.ended = [];
  calls.active = [];
  calls.endedAll = 0;
  calls.buffered = [];
  calls.listeners.clear();
});

describe("startCallCenter without a push", () => {
  test("rings a fresh uuid when the sync sees a remote call", async () => {
    const app = await harness(null);
    app.sync(true);
    expect(calls.displayed).toHaveLength(1);
    expect(calls.displayed[0]?.name).toBe("Vovo");
    app.center.stop();
  });

  test("answering drives onAnswer and hanging up remotely drives onRemoteEnd", async () => {
    const app = await harness(null);
    app.sync(true);
    const uuid = calls.displayed[0]?.uuid ?? "";
    app.answer(uuid);
    expect(app.answers).toEqual([{ roomId: ROOM, title: "Vovo" }]);
    app.sync(false);
    expect(calls.ended).toContain(uuid);
    expect(app.remoteEnds).toEqual([ROOM]);
    app.center.stop();
  });
});

describe("startCallCenter adopting a pushed call", () => {
  test("adopts the pushed uuid instead of ringing a second call", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const app = await harness(pending);
    app.sync(true);
    expect(calls.displayed).toEqual([]);
    app.answer(PUSHED_UUID);
    expect(calls.active).toEqual([PUSHED_UUID]);
    expect(app.answers).toEqual([{ roomId: ROOM, title: "Vovo" }]);
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
    app.center.stop();
  });

  test("answering before the sync catches up still opens the call", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const app = await harness(pending);
    app.answer(PUSHED_UUID);
    expect(calls.active).toEqual([PUSHED_UUID]);
    expect(app.answers).toEqual([]);
    app.sync(true);
    expect(app.answers).toEqual([{ roomId: ROOM, title: "Vovo" }]);
    expect(calls.displayed).toEqual([]);
    app.center.stop();
  });

  test("an answer buffered before the listeners were wired is replayed", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    calls.buffered = [
      { name: "RNCallKeepPerformAnswerCallAction", data: { callUUID: CALL_ID.toLowerCase() } },
    ];
    const app = await harness(pending);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.active).toEqual([PUSHED_UUID]);
    app.sync(true);
    expect(app.answers).toEqual([{ roomId: ROOM, title: "Vovo" }]);
    app.center.stop();
  });

  test("declining an unadopted pushed call only drops it locally", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const app = await harness(pending);
    app.end(PUSHED_UUID);
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
    expect(app.remoteEnds).toEqual([]);
    app.sync(true);
    expect(calls.displayed).toHaveLength(1);
    expect(calls.displayed[0]?.uuid).not.toBe(PUSHED_UUID);
    app.center.stop();
  });

  test("a push landing on a call already ringing in app ends the duplicate", async () => {
    const pending = createPendingRingCalls();
    const app = await harness(pending);
    app.sync(true);
    const uuid = calls.displayed[0]?.uuid ?? "";
    pending.remember(push(), NOW);
    expect(calls.ended).toEqual([PUSHED_UUID]);
    expect(uuid).not.toBe(PUSHED_UUID);
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
    app.center.stop();
  });

  test("the pushed uuid is dropped when the remote call goes away", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const app = await harness(pending);
    app.sync(true);
    app.sync(false);
    expect(calls.ended).toContain(PUSHED_UUID);
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
    app.center.stop();
  });
});

describe("callUuid", () => {
  test("hands out uppercase v4 uuids", () => {
    expect(callUuid()).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  });
});
