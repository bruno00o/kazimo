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
  unanswered: [] as { uuid: string; reason: number }[],
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
  CONSTANTS: {
    END_CALL_REASONS: {
      FAILED: 1,
      REMOTE_ENDED: 2,
      UNANSWERED: 3,
      ANSWERED_ELSEWHERE: 4,
      DECLINED_ELSEWHERE: 5,
      MISSED: 6,
    },
  },
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
    reportEndCallWithUUID: (uuid: string, reason: number) => {
      calls.unanswered.push({ uuid, reason });
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
const { callUuid, createCallEvents, replayedCallKeepEvents } = await import("./callkeep");

const ME = "@ana:kazimo.dev";
const CALLER = "@vovo:kazimo.dev";
const ROOM = "!room:kazimo.dev";
const CALL_ID = "11111111-2222-3333-4444-555555555555";
const PUSHED_UUID = CALL_ID.toUpperCase();
const NOW = Date.now();
const DEADLINE = Math.floor(NOW / 1000) + 60;
const UNANSWERED = 3;

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
  const misses: { roomId: string; title: string }[] = [];
  const audioSessions: string[] = [];
  const events = createCallEvents();
  events.start((event) => audioSessions.push(event));
  const center = await startCallCenter(
    client as never,
    {
      onAnswer: (call) => answers.push(call),
      onRemoteEnd: (roomId) => remoteEnds.push(roomId),
      onMissed: (call) => misses.push(call),
    },
    {} as never,
    pending,
    events,
  );
  return {
    center,
    answers,
    remoteEnds,
    misses,
    audioSessions,
    sync: (ringing: boolean) => notify?.(roomInfo(ringing)),
    syncWith: (participants: string[]) =>
      notify?.({
        ...roomInfo(participants.length > 0),
        activeRoomCallParticipants: participants,
      }),
    answer: (uuid: string) => calls.listeners.get("answerCall")?.({ callUUID: uuid }),
    end: (uuid: string) => calls.listeners.get("endCall")?.({ callUUID: uuid }),
  };
};

beforeEach(() => {
  calls.displayed = [];
  calls.ended = [];
  calls.unanswered = [];
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
    expect(app.misses).toEqual([]);
    expect(calls.unanswered).toEqual([]);
    app.center.stop();
  });

  test("a ring the caller gives up on ends as unanswered and is reported missed", async () => {
    const app = await harness(null);
    app.sync(true);
    const uuid = calls.displayed[0]?.uuid ?? "";
    app.sync(false);
    expect(app.misses).toEqual([{ roomId: ROOM, title: "Vovo" }]);
    expect(app.remoteEnds).toEqual([]);
    expect(calls.unanswered).toEqual([{ uuid, reason: UNANSWERED }]);
    expect(calls.ended).toEqual([]);
    app.center.stop();
  });

  test("declining on the callkit screen counts as seen and reports nothing", async () => {
    const app = await harness(null);
    app.sync(true);
    const uuid = calls.displayed[0]?.uuid ?? "";
    app.end(uuid);
    app.sync(false);
    expect(app.misses).toEqual([]);
    expect(app.remoteEnds).toEqual([]);
    expect(calls.unanswered).toEqual([]);
    app.center.stop();
  });

  test("the lingering remote after leaving a call never rings back", async () => {
    const app = await harness(null);
    app.syncWith([CALLER, ME]);
    app.syncWith([CALLER]);
    expect(calls.displayed).toEqual([]);
    expect(app.misses).toEqual([]);
    app.syncWith([]);
    app.syncWith([CALLER]);
    expect(calls.displayed).toHaveLength(1);
    app.center.stop();
  });

  test("joining an answered call is not mistaken for the caller hanging up", async () => {
    const app = await harness(null);
    app.sync(true);
    const uuid = calls.displayed[0]?.uuid ?? "";
    app.answer(uuid);
    app.syncWith([CALLER, ME]);
    expect(app.remoteEnds).toEqual([]);
    expect(app.misses).toEqual([]);
    expect(calls.ended).toEqual([]);
    app.syncWith([ME]);
    expect(app.remoteEnds).toEqual([ROOM]);
    expect(calls.ended).toEqual([uuid]);
    app.center.stop();
  });

  test("our own stale membership while ringing never reports a missed call", async () => {
    const app = await harness(null);
    app.sync(true);
    const uuid = calls.displayed[0]?.uuid ?? "";
    app.syncWith([CALLER, ME]);
    expect(app.misses).toEqual([]);
    expect(calls.unanswered).toEqual([]);
    app.syncWith([]);
    expect(app.misses).toEqual([{ roomId: ROOM, title: "Vovo" }]);
    expect(calls.unanswered).toEqual([{ uuid, reason: UNANSWERED }]);
    app.center.stop();
  });

  test("a call that never ends between two rings stops silencing the room", async () => {
    const app = await harness(null);
    app.syncWith([CALLER, ME]);
    app.syncWith([CALLER]);
    expect(calls.displayed).toEqual([]);
    app.syncWith([ME]);
    app.syncWith([CALLER]);
    expect(calls.displayed).toHaveLength(1);
    app.center.stop();
  });

  test("a declined caller who stays in the call does not ring again", async () => {
    const app = await harness(null);
    app.sync(true);
    const uuid = calls.displayed[0]?.uuid ?? "";
    app.end(uuid);
    app.sync(true);
    expect(calls.displayed).toHaveLength(1);
    app.sync(false);
    app.sync(true);
    expect(calls.displayed).toHaveLength(2);
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

  test("answering opens the call from the push payload without waiting for the sync", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push({ callerName: "Avo" }), NOW);
    const app = await harness(pending);
    app.answer(PUSHED_UUID);
    expect(calls.active).toEqual([PUSHED_UUID]);
    expect(app.answers).toEqual([{ roomId: ROOM, title: "Avo" }]);
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
    app.center.stop();
  });

  test("a sync landing after the pushed answer neither rings again nor answers twice", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const app = await harness(pending);
    app.answer(PUSHED_UUID);
    app.sync(true);
    expect(calls.displayed).toEqual([]);
    expect(app.answers).toHaveLength(1);
    app.center.stop();
  });

  test("hanging up an answered pushed call ends the callkit call", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const app = await harness(pending);
    app.answer(PUSHED_UUID);
    app.center.hangup(ROOM);
    expect(calls.ended).toEqual([PUSHED_UUID]);
    app.center.stop();
  });

  test("callkit ending an answered pushed call sends the screen back", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push(), NOW);
    const app = await harness(pending);
    app.answer(PUSHED_UUID);
    app.end(PUSHED_UUID);
    expect(app.remoteEnds).toEqual([ROOM]);
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
    expect(calls.unanswered).toEqual([{ uuid: PUSHED_UUID, reason: UNANSWERED }]);
    expect(app.misses).toEqual([{ roomId: ROOM, title: "Vovo" }]);
    expect(pending.forRoom(ROOM, NOW)).toBeNull();
    app.center.stop();
  });

  test("a pushed ring nobody adopted is reported missed when it expires", async () => {
    const pending = createPendingRingCalls();
    pending.remember(push({ callerName: "Avo", expiresAt: Math.floor(NOW / 1000) - 60 }), NOW - 120_000);
    const app = await harness(pending);
    expect(app.misses).toEqual([{ roomId: ROOM, title: "Avo" }]);
    expect(calls.unanswered).toEqual([{ uuid: PUSHED_UUID, reason: UNANSWERED }]);
    app.center.stop();
  });
});

describe("callUuid", () => {
  test("hands out uppercase v4 uuids", () => {
    expect(callUuid()).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  });
});

describe("replayedCallKeepEvents", () => {
  test("maps the native names and uppercases the uuid", () => {
    expect(
      replayedCallKeepEvents([
        { name: "RNCallKeepDidActivateAudioSession" },
        { name: "RNCallKeepPerformAnswerCallAction", data: { callUUID: CALL_ID.toLowerCase() } },
        { name: "RNCallKeepPerformEndCallAction", data: { callUUID: CALL_ID.toLowerCase() } },
        { name: "RNCallKeepDidDeactivateAudioSession" },
      ]),
    ).toEqual([
      { audioSession: "didActivateAudioSession" },
      { call: { event: "answerCall", uuid: PUSHED_UUID } },
      { call: { event: "endCall", uuid: PUSHED_UUID } },
      { audioSession: "didDeactivateAudioSession" },
    ]);
  });

  test("drops entries that carry no usable uuid", () => {
    expect(
      replayedCallKeepEvents([
        { name: "RNCallKeepPerformAnswerCallAction" },
        { name: "RNCallKeepDidDisplayIncomingCall", data: { callUUID: CALL_ID } },
        { name: 7, data: { callUUID: CALL_ID } },
      ]),
    ).toEqual([]);
  });
});

describe("createCallEvents", () => {
  test("hands the audio session straight to the handoff and holds the call events", async () => {
    const events = createCallEvents();
    const audioSessions: string[] = [];
    const seen: { event: string; uuid: string }[] = [];
    events.start((event) => audioSessions.push(event));
    calls.listeners.get("didActivateAudioSession")?.({ callUUID: "" });
    calls.listeners.get("answerCall")?.({ callUUID: CALL_ID.toLowerCase() });
    expect(audioSessions).toEqual(["didActivateAudioSession"]);
    expect(seen).toEqual([]);
    const off = events.take((call) => seen.push(call));
    expect(seen).toEqual([{ event: "answerCall", uuid: PUSHED_UUID }]);
    calls.listeners.get("endCall")?.({ callUUID: CALL_ID.toLowerCase() });
    expect(seen).toHaveLength(2);
    off();
    calls.listeners.get("endCall")?.({ callUUID: CALL_ID.toLowerCase() });
    expect(seen).toHaveLength(2);
    await Promise.resolve();
  });

  test("replays what callkeep buffered before the bundle was running", async () => {
    calls.buffered = [
      { name: "RNCallKeepPerformAnswerCallAction", data: { callUUID: CALL_ID.toLowerCase() } },
    ];
    const events = createCallEvents();
    events.start(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.buffered).toEqual([]);
    const seen: { event: string; uuid: string }[] = [];
    events.take((call) => seen.push(call));
    expect(seen).toEqual([{ event: "answerCall", uuid: PUSHED_UUID }]);
  });
});
