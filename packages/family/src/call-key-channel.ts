import {
  type ClientLike,
  makeWidgetDriver,
  type WidgetCapabilities,
  WidgetEventFilter,
} from "@unomed/react-native-matrix-sdk";
import {
  type CallKeyChannel,
  CallKeyStore,
  KEY_EVENT_TYPE,
  type MediaSession,
  OWN_KEY_INDEX,
  OWN_KEY_LENGTH,
  ownKeyContent,
  parseKeyMessage,
  participantIdentity,
  RECEIVE_KEYS_CAPABILITY,
  SEND_KEYS_CAPABILITY,
  splitIdentity,
} from "./call-keys";

const WIDGET_ID = "kazimo-call-keys";
const WIDGET_URL = "https://kazimo.local/call-keys";
const TO_WIDGET = "toWidget";
const FROM_WIDGET = "fromWidget";
const CAPABILITIES_ACTION = "capabilities";
const NOTIFY_CAPABILITIES_ACTION = "notify_capabilities";
const SEND_TO_DEVICE_ACTION = "send_to_device";

const NEGOTIATION_TIMEOUT_MS = 5000;
const OUTGOING_KEY_DELAY_MS = 1000;

const ENCRYPT_OUTGOING_MEDIA = true;

const LOG = "[e2ee]";

type WidgetEnvelope = {
  api?: unknown;
  widgetId?: unknown;
  requestId?: unknown;
  action?: unknown;
  data?: unknown;
  response?: unknown;
};

const approvedCapabilities = (data: unknown): string[] => {
  if (typeof data !== "object" || data === null) return [];
  const { approved } = data as { approved?: unknown };
  return Array.isArray(approved)
    ? approved.filter((entry): entry is string => typeof entry === "string")
    : [];
};

const responseError = (response: unknown): string | null => {
  if (typeof response !== "object" || response === null) return null;
  const { error } = response as { error?: unknown };
  if (typeof error !== "object" || error === null) return null;
  const { message } = error as { message?: unknown };
  return typeof message === "string" ? message : "widget request failed";
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const randomKey = (): Uint8Array => {
  const bytes = new Uint8Array(OWN_KEY_LENGTH);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const startCallKeys = async (client: ClientLike, roomId: string): Promise<CallKeyChannel | null> => {
  const room = (() => {
    try {
      return client.getRoom(roomId);
    } catch {
      return undefined;
    }
  })();
  if (!room) {
    console.log(`${LOG} no room for the key channel`, roomId);
    return null;
  }

  const { userId, deviceId } = client.session();
  const ownIdentity = participantIdentity(userId, deviceId);
  const ownKey = randomKey();
  const ownContent = ownKeyContent(roomId, userId, deviceId, ownKey);

  const store = new CallKeyStore();
  const controller = new AbortController();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const keyedPeers = new Set<string>();

  let session: MediaSession | null = null;
  let unwatch: (() => void) | null = null;
  let outgoingStarted = false;
  let requestCount = 0;
  let markNegotiated: (() => void) | null = null;
  const negotiated = new Promise<void>((resolve) => {
    markNegotiated = resolve;
  });

  const { driver, handle } = makeWidgetDriver({
    widgetId: WIDGET_ID,
    initAfterContentLoad: false,
    rawUrl: WIDGET_URL,
  });

  const keyFilter = new WidgetEventFilter.ToDevice({ eventType: KEY_EVENT_TYPE });
  const capabilities: WidgetCapabilities = {
    read: [keyFilter],
    send: [keyFilter],
    requiresClient: false,
    updateDelayedEvent: false,
    sendDelayedEvent: false,
  };

  const post = (message: object): Promise<boolean> =>
    handle.send(JSON.stringify(message), { signal: controller.signal });

  const ask = async (action: string, data: unknown): Promise<unknown> => {
    requestCount += 1;
    const requestId = `${WIDGET_ID}-${requestCount}`;
    const answered = new Promise<unknown>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
    });
    await post({ api: FROM_WIDGET, widgetId: WIDGET_ID, requestId, action, data });
    return answered;
  };

  const enableOutgoing = async (): Promise<void> => {
    if (!ENCRYPT_OUTGOING_MEDIA || outgoingStarted) return;
    const media = session;
    if (!media || keyedPeers.size === 0) return;
    const identity = media.localIdentity();
    if (identity.length === 0) return;
    outgoingStarted = true;
    try {
      await media.applyKey(identity, ownKey, OWN_KEY_INDEX);
      await wait(OUTGOING_KEY_DELAY_MS);
      await media.encryptOutgoing();
      console.log(`${LOG} outgoing encryption enabled`, identity, OWN_KEY_INDEX);
    } catch (error) {
      outgoingStarted = false;
      console.log(`${LOG} outgoing encryption failed`, String(error));
    }
  };

  const shareOwnKey = async (peerUserId: string, peerDeviceId: string): Promise<void> => {
    if (peerUserId === userId && peerDeviceId === deviceId) return;
    const peer = participantIdentity(peerUserId, peerDeviceId);
    if (keyedPeers.has(peer)) return;
    keyedPeers.add(peer);
    try {
      await ask(SEND_TO_DEVICE_ACTION, {
        type: KEY_EVENT_TYPE,
        encrypted: true,
        messages: { [peerUserId]: { [peerDeviceId]: ownContent } },
      });
      console.log(`${LOG} own key shared`, peer, OWN_KEY_INDEX);
      await enableOutgoing();
    } catch (error) {
      keyedPeers.delete(peer);
      console.log(`${LOG} own key share failed`, peer, String(error));
    }
  };

  const shareWithIdentity = (identity: string): void => {
    const peer = splitIdentity(identity);
    if (!peer) {
      console.log(`${LOG} unparsable remote identity`, identity);
      return;
    }
    void shareOwnKey(peer.userId, peer.deviceId).then(enableOutgoing);
  };

  const receive = (data: unknown): void => {
    const key = parseKeyMessage(roomId, data);
    if (!key) return;
    console.log(`${LOG} key received`, key.identity, key.index);
    store.add(key);
    void shareOwnKey(key.userId, key.deviceId);
  };

  const settle = (envelope: WidgetEnvelope): void => {
    const requestId = typeof envelope.requestId === "string" ? envelope.requestId : "";
    const waiter = pending.get(requestId);
    if (!waiter) return;
    pending.delete(requestId);
    const failure = responseError(envelope.response);
    if (failure) waiter.reject(new Error(failure));
    else waiter.resolve(envelope.response);
  };

  const answer = async (envelope: WidgetEnvelope): Promise<void> => {
    const action = envelope.action;
    let data: Record<string, unknown> = {};
    if (action === CAPABILITIES_ACTION) {
      data = { capabilities: [RECEIVE_KEYS_CAPABILITY, SEND_KEYS_CAPABILITY] };
    } else if (action === SEND_TO_DEVICE_ACTION) {
      receive(envelope.data);
    }
    await post({ ...envelope, response: data });
    if (action === NOTIFY_CAPABILITIES_ACTION) {
      console.log(`${LOG} capabilities granted`, approvedCapabilities(envelope.data));
      markNegotiated?.();
      markNegotiated = null;
    }
  };

  const pump = async (): Promise<void> => {
    for (;;) {
      const raw = await handle.recv({ signal: controller.signal });
      if (raw === undefined) return;
      let envelope: WidgetEnvelope;
      try {
        envelope = JSON.parse(raw) as WidgetEnvelope;
      } catch {
        continue;
      }
      if (envelope.api === FROM_WIDGET || envelope.response !== undefined) {
        settle(envelope);
        continue;
      }
      if (envelope.api !== TO_WIDGET) continue;
      await answer(envelope);
    }
  };

  void driver
    .run(room, { acquireCapabilities: () => capabilities }, { signal: controller.signal })
    .catch(() => undefined);
  void pump().catch(() => undefined);

  console.log(`${LOG} key channel started`, roomId, ownIdentity);
  await Promise.race([negotiated, wait(NEGOTIATION_TIMEOUT_MS)]);

  return {
    attach: (media) => {
      unwatch?.();
      session = media;
      store.attach((key) => {
        void media
          .applyKey(key.identity, key.key, key.index)
          .then(() => console.log(`${LOG} key applied`, key.identity, key.index))
          .catch((error) => console.log(`${LOG} key apply failed`, key.identity, String(error)));
      });
      const remotes = media.remoteIdentities();
      console.log(`${LOG} media session attached`, remotes);
      for (const identity of remotes) shareWithIdentity(identity);
      unwatch = media.watchRemotes(shareWithIdentity);
    },
    stop: () => {
      store.detach();
      unwatch?.();
      unwatch = null;
      session = null;
      for (const waiter of pending.values()) waiter.reject(new Error("key channel stopped"));
      pending.clear();
      controller.abort();
      console.log(`${LOG} key channel stopped`, roomId, store.count);
    },
  };
};
