import type { KioskConfig, KioskState, Person, PhotoRef } from "@kazimo/shared";
import { initAsync as initCryptoWasm } from "@matrix-org/matrix-sdk-crypto-wasm";
import {
  ClientEvent,
  createClient,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomEvent,
  RoomStateEvent,
} from "matrix-js-sdk";
import { playConnected, playEnded, playMessage, startRinging, stopRinging } from "../sounds";
import { CallHost, RTC_MEMBER_TYPES } from "./call";
import { ensureCryptoIdentity, secretStorageCallbacks } from "./crypto";
import { plainMediaUrl } from "./media";
import { loadRecentPhotos, photoFromEvent } from "./photos";

const PHOTO_ROTATE_MS = 30_000;
const PHOTO_POOL_SIZE = 20;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60_000;
const RELOAD_AFTER_FAILURES = 5;

interface RuntimeConfig extends KioskConfig {
  accessToken: string;
  recoveryPassphrase: string | null;
}

export interface KioskCallbacks {
  setState: (state: KioskState) => void;
  setLang: (lang: string) => void;
}

export interface KioskHandle {
  stop: () => void;
}

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
    await matrix.startClient({ initialSyncLimit: 30 });
    await new Promise<void>((resolve) => matrix.once(ClientEvent.Sync, () => resolve()));
    if (stopped) return;

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

    const addPhotos = (incoming: PhotoRef[]) => {
      photos = [...incoming, ...photos].sort((a, b) => b.timestamp - a.timestamp).slice(0, PHOTO_POOL_SIZE);
    };

    const show = (state: KioskState) => {
      if (state.kind !== "incoming-call") stopRinging();
      mode = state.kind;
      callbacks.setState(state);
    };

    const showIdle = () => {
      show({ kind: "idle", photo: photos.length ? (photos[photoIndex % photos.length] ?? null) : null });
    };

    const personFor = async (room: Room, userId: string): Promise<Person> => {
      const member = room.getMember(userId);
      const mxc = member?.getMxcAvatarUrl();
      return {
        userId,
        displayName: member?.name ?? userId,
        avatarUrl: mxc ? await plainMediaUrl(matrix, mxc) : null,
      };
    };

    const scheduleIdleReturn = () => {
      later(() => {
        if (mode === "message") showIdle();
      }, config.idleReturnSeconds * 1000);
    };

    const answer = async (room: Room, callerId: string) => {
      const caller = await personFor(room, callerId);
      if (stopped || mode === "in-call") return;
      show({ kind: "incoming-call", caller });
      startRinging();
      later(async () => {
        if (mode !== "incoming-call" || !callHost) return;
        show({ kind: "in-call", caller });
        const container = await waitForElement("call-container");
        if (!container || stopped) {
          showIdle();
          return;
        }
        callHost.mount(room.roomId, container, () => {
          playEnded();
          if (!stopped) showIdle();
        });
        playConnected();
      }, config.autoAnswerDelayMs);
    };

    const handleMessage = async (room: Room, event: MatrixEvent) => {
      await matrix.decryptEventIfNeeded(event);
      if (event.getType() !== "m.room.message") return;
      const content = event.getContent();
      const sender = event.getSender();
      if (!sender) return;

      if (content.msgtype === "m.image") {
        const photo = await photoFromEvent(matrix, event);
        if (!photo || stopped) return;
        addPhotos([photo]);
        photoIndex = 0;
        if (mode === "idle" || mode === "message") {
          show({ kind: "message", from: await personFor(room, sender), photo });
          playMessage();
          scheduleIdleReturn();
        }
        return;
      }

      if (content.msgtype === "m.text" && (mode === "idle" || mode === "message")) {
        show({ kind: "message", from: await personFor(room, sender), text: String(content.body ?? "") });
        playMessage();
        scheduleIdleReturn();
      }
    };

    matrix.on(ClientEvent.Sync, (syncState) => {
      if (stopped) return;
      if (String(syncState) === "ERROR" && (mode === "idle" || mode === "message")) {
        show({ kind: "degraded", reason: "offline" });
      }
      if (String(syncState) === "SYNCING" && mode === "degraded") showIdle();
    });

    matrix.on(RoomStateEvent.Events, (event: MatrixEvent) => {
      if (stopped || !RTC_MEMBER_TYPES.has(event.getType())) return;
      const active = Object.keys(event.getContent()).length > 0;
      const sender = event.getSender();
      if (!active || !sender || sender === config.userId) return;
      if (callHost?.active || mode === "incoming-call" || mode === "in-call") return;
      const roomId = event.getRoomId();
      const room = roomId ? matrix.getRoom(roomId) : null;
      if (room?.getMyMembership() !== "join") return;
      void answer(room, sender);
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
      if (config.contacts && (!inviter || !config.contacts.includes(inviter))) {
        console.warn(`invite ignored from ${inviter ?? "unknown"}: ${room.roomId}`);
        return;
      }
      void matrix
        .joinRoom(room.roomId)
        .then(async (joined) => {
          reportUnencrypted(joined);
          addPhotos(await loadRecentPhotos(matrix, joined));
          if (!stopped && mode === "idle") showIdle();
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
    showIdle();

    const ongoing = ongoingCall();
    if (ongoing) void answer(ongoing.room, ongoing.sender);

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
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      void callHost?.hangup();
      client?.stopClient();
    },
  };
}
