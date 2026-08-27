import {
  type A2uiNode,
  type ActivitySummary,
  type Announcement,
  CONTACT_EVENT_TYPE,
  CONTROL_ADMIN_POWER_LEVEL,
  CONTROL_EVENT_TYPE,
  type Contact,
  codesMatch,
  contactStateKeyOf,
  FRAME_EVENT_TYPE,
  type FrameContact,
  type HistoryMessage,
  type KioskConfig,
  type KioskState,
  type Person,
  type PhotoRef,
  type PhotosResult,
  RING_EVENT_TYPE,
  type RingDevices,
} from "@kazimo/shared";
import { initAsync as initCryptoWasm } from "@matrix-org/matrix-sdk-crypto-wasm";
import {
  ClientEvent,
  createClient,
  EventType,
  type MatrixClient,
  type MatrixEvent,
  Preset,
  type Room,
  RoomEvent,
  RoomStateEvent,
  type StateEvents,
  Visibility,
} from "matrix-js-sdk";
import {
  cleared,
  emptyActivity,
  withMissed,
  withoutMissedFrom,
  withoutUnreadFrom,
  withRinging,
  withUnread,
} from "../activity";
import { isNightAt } from "../night";
import { playConnected, playEnded, playMessage, startRinging, stopRinging } from "../sounds";
import { CallHost, type CallIntent, RTC_MEMBER_TYPES } from "./call";
import {
  adminPresent,
  type ContactStateEntry,
  contactsToProvision,
  desiredContacts,
  directRoomsByPeer,
  displayNameOf,
  type RoomView,
  removedContacts,
  repairedPowerLevels,
  statusNeedsUpdate,
} from "./contacts";
import { ensureCryptoIdentity, secretStorageCallbacks } from "./crypto";
import { plainMediaUrl } from "./media";
import { captionOf, loadRecentPhotos, photoFromEvent } from "./photos";
import { type RingStateEntry, ringContentWithoutTokens, ringDevicesByUser, ringDevicesDiffer } from "./ring";

const PHOTO_ROTATE_MS = 30_000;
const PHOTO_POOL_SIZE = 20;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60_000;
const RELOAD_AFTER_FAILURES = 5;
const NIGHT_CHECK_MS = 30_000;
const RING_TIMEOUT_MS = 90_000;
const UNREAD_BODY_MAX_CHARS = 200;
const CONTROL_ROOM_NAME = "Kazimo";
const RTC_MEMBER_POWER_LEVEL = 0;
const RECONCILE_DEBOUNCE_MS = 500;
const ENCRYPTION_ALGORITHM = "m.megolm.v1.aes-sha2";
const PAIRING_PREFIX = "kazimo-pair ";
const PAIRING_DONE_PREFIX = "kazimo-paired ";
const PAIRING_FAILED = "kazimo-pair-failed";
const PAIRING_MAX_ATTEMPTS = 5;

interface RuntimeConfig extends KioskConfig {
  accessToken: string;
  recoveryPassphrase: string | null;
}

export interface KioskCallbacks {
  setState: (state: KioskState) => void;
  setLang: (lang: string) => void;
  setNight: (night: boolean) => void;
  reportActivity: (activity: ActivitySummary) => void;
  reportContacts: (contacts: Contact[]) => void;
  reportRingDevices: (devices: RingDevices) => void;
  reportPaired: (paired: boolean) => void;
  announce: (announcement: Announcement) => void;
}

export interface KioskHandle {
  stop: () => void;
  showAssistant: (tree: A2uiNode | null) => void;
  answerCall: () => void;
  clearActivity: (what: "unread" | "missed") => void;
  placeCall: (roomId: string) => void;
  sendMessage: (roomId: string, text: string) => void;
  showPhotos: (userId: string | null) => Promise<PhotosResult>;
  history: (roomId: string, limit: number) => Promise<HistoryMessage[]>;
  dropRingTokens: (userId: string, tokens: string[]) => void;
}

const INTERRUPTIBLE_MODES = new Set<KioskState["kind"]>(["idle", "message", "assistant"]);

function waitForElement(id: string, timeoutMs = 2000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const el = document.getElementById(id);
      if (el) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export function startKiosk(callbacks: KioskCallbacks): KioskHandle {
  let stopped = false;
  let client: MatrixClient | null = null;
  let callHost: CallHost | null = null;
  let assistantSink: ((tree: A2uiNode | null) => void) | null = null;
  let answerSink: (() => void) | null = null;
  let clearSink: ((what: "unread" | "missed") => void) | null = null;
  let placeCallSink: ((roomId: string) => void) | null = null;
  let sendMessageSink: ((roomId: string, text: string) => void) | null = null;
  let showPhotosSink: ((userId: string | null) => Promise<PhotosResult>) | null = null;
  let historySink: ((roomId: string, limit: number) => Promise<HistoryMessage[]>) | null = null;
  let ringStaleSink: ((userId: string, tokens: string[]) => void) | null = null;
  let pairingAttempts = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) fn();
    }, ms);
    timers.add(timer);
  };

  const run = async () => {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error(`config unavailable (${res.status})`);
    const config = (await res.json()) as RuntimeConfig;
    if (stopped) return;
    callbacks.setLang(config.lang);

    const matrix = createClient({
      baseUrl: config.homeserverUrl,
      accessToken: config.accessToken,
      userId: config.userId,
      deviceId: config.deviceId,
      useAuthorizationHeader: true,
      cryptoCallbacks: secretStorageCallbacks(config.recoveryPassphrase),
    });
    client = matrix;

    await initCryptoWasm("/matrix_sdk_crypto_wasm_bg.wasm").catch((error) =>
      console.error("crypto wasm load failed", error),
    );
    await matrix
      .initRustCrypto({ cryptoDatabasePrefix: `kazimo-${config.deviceId}` })
      .catch((error) => console.error("rust crypto init failed", error));
    if (stopped) return;
    await matrix.startClient({ initialSyncLimit: 30 });
    if (stopped) {
      matrix.stopClient();
      return;
    }
    await new Promise<void>((resolve) => matrix.once(ClientEvent.Sync, () => resolve()));
    if (stopped) {
      matrix.stopClient();
      return;
    }

    await ensureCryptoIdentity(matrix, config.recoveryPassphrase).catch((error) =>
      console.error("crypto identity setup failed", error),
    );

    if (config.roomId) await matrix.joinRoom(config.roomId).catch(() => {});

    const joinedRooms = () => matrix.getRooms().filter((r) => r.getMyMembership() === "join");

    const reportUnencrypted = (room: Room) => {
      if (!room.hasEncryptionStateEvent()) {
        console.warn(`room without encryption: ${room.roomId} (${room.name})`);
      }
    };

    callHost = new CallHost(matrix, {
      userId: config.userId,
      deviceId: config.deviceId,
      homeserverUrl: config.homeserverUrl,
      lang: config.lang,
    });

    let mode: KioskState["kind"] = "idle";
    let photos: PhotoRef[] = [];
    let photoIndex = 0;
    let activity = emptyActivity();
    const pendingReads = new Map<string, MatrixEvent>();
    let night = isNightAt(new Date(), config.nightStartHour, config.nightEndHour);
    let ringing: { roomId: string; sender: string; caller: Person } | null = null;
    let controlRoomId: string | null = null;
    let namedContacts = new Map<string, FrameContact>();
    let hiddenContacts = new Set<string>();

    const findControlRoom = () =>
      joinedRooms().find((room) => room.currentState.getStateEvents(CONTROL_EVENT_TYPE, "") !== null)
        ?.roomId ?? null;

    const setControlRoom = (roomId: string | null) => {
      if (roomId === controlRoomId) return;
      controlRoomId = roomId;
      callbacks.reportPaired(controlRoomId !== null);
    };

    const contactStateEntries = (): ContactStateEntry[] => {
      const room = controlRoomId ? matrix.getRoom(controlRoomId) : null;
      if (!room) return [];
      return room.currentState.getStateEvents(CONTACT_EVENT_TYPE).map((event) => ({
        stateKey: event.getStateKey() ?? "",
        content: event.getContent(),
      }));
    };

    const refreshNamedContacts = () => {
      const entries = contactStateEntries();
      namedContacts = desiredContacts(entries);
      hiddenContacts = removedContacts(entries);
    };

    const nameOf = (userId: string, fallback: string) => displayNameOf(namedContacts, userId, fallback);

    const createControlRoom = async () => {
      const created = await matrix.createRoom({
        preset: Preset.TrustedPrivateChat,
        visibility: Visibility.Private,
        name: CONTROL_ROOM_NAME,
        initial_state: [{ type: CONTROL_EVENT_TYPE, state_key: "", content: {} }],
        power_level_content_override: { events: { [CONTACT_EVENT_TYPE]: CONTROL_ADMIN_POWER_LEVEL } },
      });
      return created.room_id;
    };

    const pair = async (room: Room, sender: string, attempt: string) => {
      const reply = (text: string) =>
        matrix
          .sendTextMessage(room.roomId, text)
          .catch((error) => console.error("pairing reply failed", error));
      const code = config.pairing?.code;
      const allowed = pairingAttempts < PAIRING_MAX_ATTEMPTS;
      pairingAttempts += 1;
      if (!allowed || !code || !codesMatch(attempt, code)) {
        await reply(PAIRING_FAILED);
        return;
      }
      const roomId = controlRoomId ?? (await createControlRoom());
      setControlRoom(roomId);
      await matrix.invite(roomId, sender).catch((error) => console.error("control invite failed", error));
      await matrix
        .setPowerLevel(roomId, sender, CONTROL_ADMIN_POWER_LEVEL)
        .catch((error) => console.error("control power level failed", error));
      await reply(`${PAIRING_DONE_PREFIX}${roomId}`);
      scheduleReconcile();
    };

    const isNightNow = () => isNightAt(new Date(), config.nightStartHour, config.nightEndHour);

    const addPhotos = (incoming: PhotoRef[]) => {
      photos = [...incoming, ...photos].sort((a, b) => b.timestamp - a.timestamp).slice(0, PHOTO_POOL_SIZE);
    };

    const show = (state: KioskState) => {
      if (state.kind !== "incoming-call") stopRinging();
      mode = state.kind;
      callbacks.setState(state);
    };

    const showIdle = () => {
      show({
        kind: "idle",
        photo: photos.length ? (photos[photoIndex % photos.length] ?? null) : null,
        activity,
      });
    };

    const setActivity = (next: ActivitySummary) => {
      activity = next;
      callbacks.reportActivity(activity);
      if (mode === "idle") showIdle();
    };

    callbacks.setNight(night);
    callbacks.reportActivity(activity);
    const nightTimer = setInterval(() => {
      if (stopped) return;
      const now = isNightNow();
      if (now !== night) {
        night = now;
        callbacks.setNight(night);
      }
    }, NIGHT_CHECK_MS);
    timers.add(nightTimer);

    const personFor = async (room: Room, userId: string): Promise<Person> => {
      const member = room.getMember(userId);
      const mxc = member?.getMxcAvatarUrl();
      return {
        userId,
        displayName: nameOf(userId, member?.name ?? userId),
        avatarUrl: mxc ? await plainMediaUrl(matrix, mxc) : null,
      };
    };

    const scheduleIdleReturn = () => {
      later(() => {
        if (mode === "message" || mode === "assistant") showIdle();
      }, config.idleReturnSeconds * 1000);
    };

    assistantSink = (tree) => {
      if (stopped) return;
      if (!tree) {
        if (mode === "assistant") showIdle();
        return;
      }
      if (!INTERRUPTIBLE_MODES.has(mode)) return;
      show({ kind: "assistant", tree });
      scheduleIdleReturn();
    };

    const mountCall = async (room: Room, person: Person, intent: CallIntent) => {
      if (!callHost) return false;
      show({ kind: "in-call", caller: person });
      const container = await waitForElement("call-container");
      if (!container || stopped) {
        showIdle();
        return false;
      }
      callHost.mount(
        room.roomId,
        container,
        () => {
          playEnded();
          if (!stopped) showIdle();
        },
        intent,
      );
      return true;
    };

    const connect = async (room: Room, caller: Person) => {
      if (stopped || !callHost || mode === "in-call") return;
      ringing = null;
      setActivity(withRinging(withoutMissedFrom(activity, caller.userId), null));
      if (await mountCall(room, caller, "join_existing_dm")) playConnected();
    };

    const placeCall = async (roomId: string) => {
      if (stopped || !callHost || callHost.active || !INTERRUPTIBLE_MODES.has(mode)) return;
      const room = matrix.getRoom(roomId);
      if (room?.getMyMembership() !== "join") return;
      const calleeId = room
        .getJoinedMembers()
        .map((member) => member.userId)
        .find((id) => id !== config.userId);
      if (!calleeId) return;
      await mountCall(room, await personFor(room, calleeId), "start_call_dm");
    };

    placeCallSink = (roomId) => void placeCall(roomId);

    sendMessageSink = (roomId, text) => {
      void matrix.sendTextMessage(roomId, text).catch((error) => console.error("send message failed", error));
    };

    const miss = () => {
      if (!ringing) return;
      const { caller } = ringing;
      ringing = null;
      stopRinging();
      setActivity(
        withRinging(
          withMissed(activity, { userId: caller.userId, from: caller.displayName, timestamp: Date.now() }),
          null,
        ),
      );
      if (mode === "incoming-call") showIdle();
    };

    const ring = async (room: Room, callerId: string) => {
      const caller = await personFor(room, callerId);
      if (stopped || mode === "in-call") return;
      ringing = { roomId: room.roomId, sender: callerId, caller };
      show({ kind: "incoming-call", caller });
      startRinging();
      setActivity(withRinging(activity, caller.displayName));
      if (!isNightNow()) {
        later(() => {
          if (ringing?.roomId === room.roomId && mode === "incoming-call") void connect(room, caller);
        }, config.autoAnswerDelayMs);
      }
      later(() => {
        if (ringing?.roomId === room.roomId && mode === "incoming-call") miss();
      }, RING_TIMEOUT_MS);
    };

    answerSink = () => {
      if (stopped || !ringing || mode !== "incoming-call") return;
      const room = matrix.getRoom(ringing.roomId);
      if (room) void connect(room, ringing.caller);
    };

    clearSink = (what) => {
      if (stopped) return;
      if (what === "unread") {
        for (const event of pendingReads.values()) {
          void matrix.sendReadReceipt(event).catch(() => {});
        }
        pendingReads.clear();
      }
      setActivity(cleared(activity, what));
    };

    showPhotosSink = async (userId) => {
      const nothing: PhotosResult = { shown: 0, from: null, timestamp: null };
      if (stopped || !INTERRUPTIBLE_MODES.has(mode)) return nothing;
      const pool = userId ? photos.filter((photo) => photo.sender === userId) : photos;
      const photo = pool.find((candidate) => candidate.sender !== null);
      const sender = photo?.sender;
      if (!photo || !sender) return nothing;
      const room = joinedRooms().find((candidate) => candidate.getMember(sender));
      const from = room
        ? await personFor(room, sender)
        : { userId: sender, displayName: sender, avatarUrl: null };
      show({ kind: "message", from, photo });
      scheduleIdleReturn();
      return { shown: 1, from: from.displayName, timestamp: photo.timestamp };
    };

    historySink = async (roomId, limit) => {
      const room = matrix.getRoom(roomId);
      if (room?.getMyMembership() !== "join") return [];
      const events = room.getLiveTimeline().getEvents();
      const messages: HistoryMessage[] = [];
      let latestRead: MatrixEvent | null = null;
      const senders = new Set<string>();
      for (const event of [...events].reverse()) {
        if (messages.length >= limit) break;
        const sender = event.getSender();
        if (!sender || sender === config.userId) continue;
        await matrix.decryptEventIfNeeded(event);
        if (event.getType() !== "m.room.message") continue;
        const content = event.getContent();
        const from = nameOf(sender, room.getMember(sender)?.name ?? sender);
        if (content.msgtype === "m.text") {
          messages.push({
            from,
            kind: "text",
            body: String(content.body ?? "").slice(0, UNREAD_BODY_MAX_CHARS),
            timestamp: event.getTs(),
          });
        } else if (content.msgtype === "m.image") {
          messages.push({
            from,
            kind: "photo",
            body: captionOf(content.body as string | undefined),
            timestamp: event.getTs(),
          });
        } else {
          continue;
        }
        latestRead ??= event;
        senders.add(sender);
      }
      if (latestRead) {
        void matrix.sendReadReceipt(latestRead).catch(() => {});
        pendingReads.delete(roomId);
      }
      let remaining = activity;
      for (const sender of senders) remaining = withoutUnreadFrom(remaining, sender);
      if (remaining !== activity) setActivity(remaining);
      return messages.reverse();
    };

    const handleMessage = async (room: Room, event: MatrixEvent) => {
      await matrix.decryptEventIfNeeded(event);
      if (event.getType() !== "m.room.message") return;
      const content = event.getContent();
      const sender = event.getSender();
      if (!sender) return;

      const text = content.msgtype === "m.text" ? String(content.body ?? "") : "";
      if (text.startsWith(PAIRING_PREFIX)) {
        await pair(room, sender, text.slice(PAIRING_PREFIX.length));
        return;
      }

      const recordUnread = (kind: "text" | "photo", body: string | null) => {
        pendingReads.set(room.roomId, event);
        setActivity(
          withUnread(activity, {
            userId: sender,
            from: nameOf(sender, room.getMember(sender)?.name ?? sender),
            kind,
            body: body ? body.slice(0, UNREAD_BODY_MAX_CHARS) : null,
            timestamp: Date.now(),
          }),
        );
      };

      const display = async (kind: "text" | "photo", body: string | null, photo?: PhotoRef) => {
        const from = await personFor(room, sender);
        show(photo ? { kind: "message", from, photo } : { kind: "message", from, text: body ?? "" });
        playMessage();
        scheduleIdleReturn();
        void matrix.sendReadReceipt(event).catch(() => {});
        callbacks.announce({ from: from.displayName, kind, body });
      };

      if (content.msgtype === "m.image") {
        const photo = await photoFromEvent(matrix, event);
        if (!photo || stopped) return;
        addPhotos([photo]);
        photoIndex = 0;
        if (night || !INTERRUPTIBLE_MODES.has(mode)) {
          recordUnread("photo", photo.caption);
        } else {
          await display("photo", photo.caption, photo);
        }
        return;
      }

      if (content.msgtype === "m.text") {
        const body = String(content.body ?? "");
        if (night || !INTERRUPTIBLE_MODES.has(mode)) {
          recordUnread("text", body);
        } else {
          await display("text", body);
        }
      }
    };

    let lastContacts = "";
    const reportContacts = () => {
      refreshNamedContacts();
      const byUser = new Map<string, { contact: Contact; lastActive: number }>();
      for (const room of joinedRooms()) {
        const members = room.getJoinedMembers();
        if (members.length !== 2) continue;
        const other = members.find((member) => member.userId !== config.userId);
        if (!other || hiddenContacts.has(other.userId)) continue;
        const lastActive = room.getLastActiveTimestamp();
        const known = byUser.get(other.userId);
        if (known && known.lastActive >= lastActive) continue;
        byUser.set(other.userId, {
          contact: {
            userId: other.userId,
            displayName: nameOf(other.userId, other.name),
            roomId: room.roomId,
          },
          lastActive,
        });
      }
      const snapshot = [...byUser.values()].map((entry) => entry.contact);
      const encoded = JSON.stringify(snapshot);
      if (encoded === lastContacts) return;
      lastContacts = encoded;
      callbacks.reportContacts(snapshot);
    };

    const roomViews = (): RoomView[] =>
      joinedRooms().map((room) => ({
        roomId: room.roomId,
        isControl: room.currentState.getStateEvents(CONTROL_EVENT_TYPE, "") !== null,
        memberIds: room
          .getMembers()
          .filter((member) => member.membership === "join" || member.membership === "invite")
          .map((member) => member.userId),
      }));

    const ringStateEntries = (): RingStateEntry[] => {
      const entries: RingStateEntry[] = [];
      for (const [peerUserId, roomId] of directRoomsByPeer(roomViews(), config.userId)) {
        const room = matrix.getRoom(roomId);
        if (!room) continue;
        for (const event of room.currentState.getStateEvents(RING_EVENT_TYPE)) {
          entries.push({ peerUserId, stateKey: event.getStateKey() ?? "", content: event.getContent() });
        }
      }
      return entries;
    };

    let ringDevices: RingDevices = {};
    const reportRingDevices = () => {
      const next = ringDevicesByUser(ringStateEntries());
      if (!ringDevicesDiffer(ringDevices, next)) return;
      ringDevices = next;
      callbacks.reportRingDevices(next);
    };

    ringStaleSink = (userId, tokens) => {
      const roomId = directRoomsByPeer(roomViews(), config.userId).get(userId);
      const room = roomId ? matrix.getRoom(roomId) : null;
      if (!room || !roomId) return;
      const stateKey = contactStateKeyOf(userId);
      const current = room.currentState.getStateEvents(RING_EVENT_TYPE, stateKey)?.getContent();
      const next = ringContentWithoutTokens(current, tokens);
      if (!next) return;
      void matrix
        .sendStateEvent(
          roomId,
          RING_EVENT_TYPE as keyof StateEvents,
          next as unknown as StateEvents[keyof StateEvents],
          stateKey,
        )
        .then(() => reportRingDevices())
        .catch((error) => console.error(`ring device pruning failed for ${userId}`, error));
    };

    const repairControlPowerLevels = async () => {
      const room = controlRoomId ? matrix.getRoom(controlRoomId) : null;
      const current = room?.currentState.getStateEvents(EventType.RoomPowerLevels, "");
      if (!room || !current) return;
      const repaired = repairedPowerLevels(current.getContent());
      if (!repaired) return;
      await matrix
        .sendStateEvent(
          room.roomId,
          EventType.RoomPowerLevels,
          repaired as StateEvents[EventType.RoomPowerLevels],
        )
        .catch((error) => console.error("control power levels repair failed", error));
    };

    const createContactRoom = (contact: FrameContact) =>
      matrix.createRoom({
        preset: Preset.TrustedPrivateChat,
        visibility: Visibility.Private,
        is_direct: true,
        invite: [contact.userId],
        initial_state: [
          { type: EventType.RoomEncryption, state_key: "", content: { algorithm: ENCRYPTION_ALGORITHM } },
          { type: FRAME_EVENT_TYPE, state_key: "", content: { hasAdmin: true } },
        ],
        power_level_content_override: {
          users: {
            [config.userId]: CONTROL_ADMIN_POWER_LEVEL,
            [contact.userId]: CONTROL_ADMIN_POWER_LEVEL,
          },
          events: Object.fromEntries([...RTC_MEMBER_TYPES].map((type) => [type, RTC_MEMBER_POWER_LEVEL])),
        },
      });

    const controlMemberIds = (): string[] => {
      const room = controlRoomId ? matrix.getRoom(controlRoomId) : null;
      if (!room) return [];
      return room
        .getMembers()
        .filter((member) => member.membership === "join" || member.membership === "invite")
        .map((member) => member.userId);
    };

    const publishFrameStatus = async () => {
      const hasAdmin = adminPresent(controlMemberIds(), config.userId);
      for (const roomId of directRoomsByPeer(roomViews(), config.userId).values()) {
        const room = matrix.getRoom(roomId);
        if (!room) continue;
        const current = room.currentState.getStateEvents(FRAME_EVENT_TYPE, "")?.getContent();
        if (!statusNeedsUpdate(current, hasAdmin)) continue;
        await matrix
          .sendStateEvent(
            roomId,
            FRAME_EVENT_TYPE as keyof StateEvents,
            { hasAdmin } as unknown as StateEvents[keyof StateEvents],
          )
          .catch((error) => console.error(`frame status publish failed for ${roomId}`, error));
      }
    };

    const provisionedRooms = new Map<string, string>();
    let reconciling = false;
    let reconcileRequested = false;

    const provision = async (contact: FrameContact) => {
      try {
        await matrix.getProfileInfo(contact.userId);
        const created = await createContactRoom(contact);
        provisionedRooms.set(contact.userId, created.room_id);
      } catch (error) {
        console.error(`contact provisioning failed for ${contact.userId}`, error);
      }
    };

    const reconcileContacts = async () => {
      if (reconciling) {
        reconcileRequested = true;
        return;
      }
      reconciling = true;
      try {
        do {
          reconcileRequested = false;
          refreshNamedContacts();
          await repairControlPowerLevels();
          const existing = directRoomsByPeer(roomViews(), config.userId);
          for (const [userId, roomId] of provisionedRooms) {
            if (!existing.has(userId)) existing.set(userId, roomId);
          }
          for (const contact of contactsToProvision(namedContacts, existing)) {
            if (stopped) return;
            await provision(contact);
          }
          await publishFrameStatus();
          reportContacts();
          reportRingDevices();
        } while (reconcileRequested && !stopped);
      } finally {
        reconciling = false;
      }
    };

    let reconcileScheduled = false;
    const scheduleReconcile = () => {
      if (reconcileScheduled) return;
      reconcileScheduled = true;
      later(() => {
        reconcileScheduled = false;
        void reconcileContacts();
      }, RECONCILE_DEBOUNCE_MS);
    };

    matrix.on(RoomStateEvent.Members, (event: MatrixEvent) => {
      if (stopped) return;
      if (event.getRoomId() === controlRoomId) scheduleReconcile();
      reportContacts();
      reportRingDevices();
    });

    matrix.on(ClientEvent.Sync, (syncState) => {
      if (stopped) return;
      if (String(syncState) === "ERROR" && INTERRUPTIBLE_MODES.has(mode)) {
        show({ kind: "degraded", reason: "offline" });
      }
      if (String(syncState) === "SYNCING" && mode === "degraded") showIdle();
    });

    matrix.on(RoomStateEvent.Events, (event: MatrixEvent) => {
      if (stopped) return;
      if (event.getType() === CONTACT_EVENT_TYPE) {
        if (event.getRoomId() === controlRoomId) scheduleReconcile();
        return;
      }
      if (event.getType() === RING_EVENT_TYPE) {
        reportRingDevices();
        return;
      }
      if (!RTC_MEMBER_TYPES.has(event.getType())) return;
      const active = Object.keys(event.getContent()).length > 0;
      const sender = event.getSender();
      if (!sender || sender === config.userId) return;
      if (!active) {
        if (ringing && ringing.sender === sender && ringing.roomId === event.getRoomId()) miss();
        return;
      }
      if (callHost?.active || mode === "incoming-call" || mode === "in-call") return;
      const roomId = event.getRoomId();
      const room = roomId ? matrix.getRoom(roomId) : null;
      if (room?.getMyMembership() !== "join") return;
      void ring(room, sender);
    });

    matrix.on(
      RoomEvent.Timeline,
      (event: MatrixEvent, eventRoom: Room | undefined, toStartOfTimeline, _removed, data) => {
        if (stopped || !eventRoom || eventRoom.getMyMembership() !== "join") return;
        if (toStartOfTimeline || !data.liveEvent) return;
        if (event.getSender() === config.userId) return;
        void handleMessage(eventRoom, event).catch(() => {});
      },
    );

    matrix.on(RoomEvent.MyMembership, (room: Room, membership: string) => {
      if (stopped || membership !== "invite") return;
      const inviter = room.getMember(config.userId)?.events.member?.getSender();
      const pairingOpen = config.pairing !== null && controlRoomId === null;
      if (!pairingOpen && config.contacts && (!inviter || !config.contacts.includes(inviter))) {
        console.warn(`invite ignored from ${inviter ?? "unknown"}: ${room.roomId}`);
        return;
      }
      void matrix
        .joinRoom(room.roomId)
        .then(async (joined) => {
          reportUnencrypted(joined);
          addPhotos(await loadRecentPhotos(matrix, joined));
          if (stopped) return;
          const found = findControlRoom();
          if (found) {
            setControlRoom(found);
            scheduleReconcile();
          }
          reportContacts();
          reportRingDevices();
          if (mode === "idle") showIdle();
        })
        .catch((error) => console.error(`auto-join failed for ${room.roomId}`, error));
    });

    const ongoingCall = () => {
      for (const room of joinedRooms()) {
        for (const type of RTC_MEMBER_TYPES) {
          for (const event of room.currentState.getStateEvents(type)) {
            const sender = event.getSender();
            if (sender && sender !== config.userId && Object.keys(event.getContent()).length > 0) {
              return { room, sender };
            }
          }
        }
      }
      return null;
    };

    for (const room of joinedRooms()) {
      reportUnencrypted(room);
      addPhotos(await loadRecentPhotos(matrix, room));
      if (stopped) return;
    }
    controlRoomId = findControlRoom();
    callbacks.reportPaired(controlRoomId !== null);
    reportContacts();
    reportRingDevices();
    showIdle();
    if (controlRoomId) void reconcileContacts();

    const ongoing = ongoingCall();
    if (ongoing) void ring(ongoing.room, ongoing.sender);

    const rotate = setInterval(() => {
      if (stopped || mode !== "idle" || photos.length < 2) return;
      photoIndex += 1;
      showIdle();
    }, PHOTO_ROTATE_MS);
    timers.add(rotate);
  };

  let failures = 0;
  const start = () => {
    void run()
      .then(() => {
        failures = 0;
      })
      .catch((error) => {
        if (stopped) return;
        callbacks.setState({ kind: "degraded", reason: String(error) });
        client?.stopClient();
        client = null;
        callHost = null;
        failures += 1;
        if (failures >= RELOAD_AFTER_FAILURES) {
          location.reload();
          return;
        }
        later(start, Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS));
      });
  };
  start();

  return {
    stop() {
      stopped = true;
      assistantSink = null;
      answerSink = null;
      clearSink = null;
      placeCallSink = null;
      sendMessageSink = null;
      showPhotosSink = null;
      historySink = null;
      ringStaleSink = null;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      void callHost?.hangup();
      client?.stopClient();
    },
    showAssistant(tree) {
      assistantSink?.(tree);
    },
    answerCall() {
      answerSink?.();
    },
    clearActivity(what) {
      clearSink?.(what);
    },
    placeCall(roomId) {
      placeCallSink?.(roomId);
    },
    sendMessage(roomId, text) {
      sendMessageSink?.(roomId, text);
    },
    showPhotos(userId) {
      return showPhotosSink
        ? showPhotosSink(userId)
        : Promise.resolve({ shown: 0, from: null, timestamp: null });
    },
    history(roomId, limit) {
      return historySink ? historySink(roomId, limit) : Promise.resolve([]);
    },
    dropRingTokens(userId, tokens) {
      ringStaleSink?.(userId, tokens);
    },
  };
}
