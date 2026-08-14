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
import { CallHost, RTC_MEMBER_TYPES } from "./call";
import { plainMediaUrl } from "./media";
import { loadRecentPhotos, photoFromEvent } from "./photos";

const PHOTO_ROTATE_MS = 30_000;

interface RuntimeConfig extends KioskConfig {
  accessToken: string;
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

    await matrix.joinRoom(config.roomId).catch(() => {});
    const room = matrix.getRoom(config.roomId);
    if (!room) throw new Error(`room unavailable: ${config.roomId}`);

    callHost = new CallHost(matrix, {
      userId: config.userId,
      deviceId: config.deviceId,
      homeserverUrl: config.homeserverUrl,
      lang: config.lang,
    });

    let mode: KioskState["kind"] = "idle";
    let photos: PhotoRef[] = [];
    let photoIndex = 0;

    const show = (state: KioskState) => {
      mode = state.kind;
      callbacks.setState(state);
    };

    const showIdle = () => {
      show({ kind: "idle", photo: photos.length ? (photos[photoIndex % photos.length] ?? null) : null });
    };

    const personFor = async (userId: string): Promise<Person> => {
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

    const answer = async (callerId: string) => {
      const caller = await personFor(callerId);
      if (stopped || mode === "in-call") return;
      show({ kind: "incoming-call", caller });
      later(async () => {
        if (mode !== "incoming-call" || !callHost) return;
        show({ kind: "in-call", caller });
        const container = await waitForElement("call-container");
        if (!container || stopped) {
          showIdle();
          return;
        }
        callHost.mount(room.roomId, container, () => {
          if (!stopped) showIdle();
        });
      }, config.autoAnswerDelayMs);
    };

    const handleMessage = async (event: MatrixEvent) => {
      await matrix.decryptEventIfNeeded(event);
      if (event.getType() !== "m.room.message") return;
      const content = event.getContent();
      const sender = event.getSender();
      if (!sender) return;

      if (content.msgtype === "m.image") {
        const photo = await photoFromEvent(matrix, event);
        if (!photo || stopped) return;
        photos = [photo, ...photos];
        photoIndex = 0;
        if (mode === "idle" || mode === "message") {
          show({ kind: "message", from: await personFor(sender), photo });
          scheduleIdleReturn();
        }
        return;
      }

      if (content.msgtype === "m.text" && (mode === "idle" || mode === "message")) {
        show({ kind: "message", from: await personFor(sender), text: String(content.body ?? "") });
        scheduleIdleReturn();
      }
    };

    matrix.on(RoomStateEvent.Events, (event: MatrixEvent) => {
      if (stopped || event.getRoomId() !== room.roomId) return;
      if (!RTC_MEMBER_TYPES.has(event.getType())) return;
      const active = Object.keys(event.getContent()).length > 0;
      const sender = event.getSender();
      if (!active || !sender || sender === config.userId) return;
      if (callHost?.active || mode === "incoming-call" || mode === "in-call") return;
      void answer(sender);
    });

    matrix.on(
      RoomEvent.Timeline,
      (event: MatrixEvent, eventRoom: Room | undefined, toStartOfTimeline, _removed, data) => {
        if (stopped || eventRoom?.roomId !== room.roomId) return;
        if (toStartOfTimeline || !data.liveEvent) return;
        if (event.getSender() === config.userId) return;
        void handleMessage(event).catch(() => {});
      },
    );

    const ongoingCaller = () => {
      for (const type of RTC_MEMBER_TYPES) {
        for (const event of room.currentState.getStateEvents(type)) {
          const sender = event.getSender();
          if (sender && sender !== config.userId && Object.keys(event.getContent()).length > 0) {
            return sender;
          }
        }
      }
      return null;
    };

    photos = await loadRecentPhotos(matrix, room);
    if (stopped) return;
    showIdle();

    const caller = ongoingCaller();
    if (caller) void answer(caller);

    const rotate = setInterval(() => {
      if (stopped || mode !== "idle" || photos.length < 2) return;
      photoIndex += 1;
      showIdle();
    }, PHOTO_ROTATE_MS);
    timers.add(rotate);
  };

  void run().catch((error) => {
    if (!stopped) callbacks.setState({ kind: "degraded", reason: String(error) });
  });

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
