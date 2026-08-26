import {
  contactStateKeyOf,
  isRingDeviceToken,
  RING_EVENT_TYPE,
  type RingDevicesContent,
  ringDeviceIsCurrent,
  withRingDevice,
} from "@kazimo/shared";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { NativeModules, Platform } from "react-native";
import { frameDirectRoom, putRoomState, roomStateContent } from "./frame";
import type { PendingRingCalls } from "./pending-calls";

type VoipPush = typeof import("react-native-voip-push-notification").default;
type VoipCachedEvent = { name?: unknown; data?: unknown };

const NATIVE_MODULE_NAME = "RNVoipPushNotificationManager";
const TOKEN_TIMEOUT_MS = 10_000;
const NOTIFICATION_EVENT_NAME = "RNVoipPushRemoteNotificationReceivedEvent";

let pendingModule: Promise<VoipPush | null> | null = null;

const voipPush = (): Promise<VoipPush | null> => {
  pendingModule ??= (async () => {
    if (Platform.OS !== "ios") return null;
    if (!NativeModules[NATIVE_MODULE_NAME]) return null;
    try {
      return (await import("react-native-voip-push-notification")).default;
    } catch {
      return null;
    }
  })();
  return pendingModule;
};

export const voipToken = async (): Promise<string | null> => {
  const module = await voipPush();
  if (!module) return null;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      module.removeEventListener("register");
      resolve(token);
    };
    const timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS);
    module.addEventListener("register", (token) => {
      clearTimeout(timer);
      finish(isRingDeviceToken(token) ? token : null);
    });
    module.registerVoipToken();
  });
};

export const startVoipRings = async (pending: PendingRingCalls): Promise<() => void> => {
  const module = await voipPush();
  if (!module) return () => {};
  module.addEventListener("notification", (payload) => {
    pending.remember(payload);
  });
  module.addEventListener("didLoadWithEvents", (events) => {
    if (!Array.isArray(events)) return;
    for (const event of events as VoipCachedEvent[]) {
      if (event?.name === NOTIFICATION_EVENT_NAME) pending.remember(event.data);
    }
  });
  module.registerVoipToken();
  return () => {
    module.removeEventListener("notification");
    module.removeEventListener("didLoadWithEvents");
  };
};

export const ringUpdate = (
  current: unknown,
  deviceId: string,
  token: string,
  now: number,
): RingDevicesContent | null =>
  ringDeviceIsCurrent(current, deviceId, token)
    ? null
    : withRingDevice(current, { deviceId, token, updatedAt: now });

export const publishVoipToken = async (client: ClientLike, deviceId: string): Promise<void> => {
  if (!deviceId) return;
  const token = await voipToken();
  if (!token) return;
  const roomId = await frameDirectRoom(client);
  if (!roomId) return;
  const stateKey = contactStateKeyOf(client.userId());
  const current = await roomStateContent(client, roomId, RING_EVENT_TYPE, stateKey).catch(() => null);
  const next = ringUpdate(current, deviceId, token, Date.now());
  if (!next) return;
  await putRoomState(client, roomId, RING_EVENT_TYPE, stateKey, next);
};
