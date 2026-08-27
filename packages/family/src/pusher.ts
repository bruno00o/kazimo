import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { readPushGateway } from "./env";
import { authorizedFetch } from "./http";
import type { Strings } from "./i18n";
import { devicePushToken, requestNotificationPermission } from "./notifications";

export const PUSHER_APP_ID = "com.kazimo.family";
export const PUSHER_FORMAT = "event_id_only";
export const PUSHER_APP_DISPLAY_NAME = "Kazimo";

const NOTIFY_PATH = "/_matrix/push/v1/notify";
const PUSHERS_PATH = "/_matrix/client/v3/pushers/set";

export type PusherBody = {
  app_id: string;
  app_display_name: string;
  device_display_name: string;
  kind: "http";
  lang: string;
  pushkey: string;
  append: boolean;
  data: {
    url: string;
    format: string;
    default_payload: {
      aps: {
        "mutable-content": number;
        alert: { body: string };
        sound: string;
      };
    };
  };
};

export const notifyUrlOf = (gateway: string): string => {
  const base = gateway.trim().replace(/\/+$/, "");
  return base.endsWith(NOTIFY_PATH) ? base : `${base}${NOTIFY_PATH}`;
};

export const pusherBodyOf = (input: {
  gateway: string;
  pushkey: string;
  deviceName: string;
  strings: Strings;
}): PusherBody => ({
  app_id: PUSHER_APP_ID,
  app_display_name: PUSHER_APP_DISPLAY_NAME,
  device_display_name: input.deviceName,
  kind: "http",
  lang: input.strings.locale,
  pushkey: input.pushkey,
  append: false,
  data: {
    url: notifyUrlOf(input.gateway),
    format: PUSHER_FORMAT,
    default_payload: {
      aps: {
        "mutable-content": 1,
        alert: { body: input.strings.newMessage },
        sound: "default",
      },
    },
  },
});

export const setPusher = async (client: ClientLike, homeserver: string, body: PusherBody): Promise<void> => {
  const response = await authorizedFetch(client, `${homeserver}${PUSHERS_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`pushers/set ${response.status}`);
};

export const pusherFingerprintOf = (homeserver: string, gateway: string, pushkey: string): string =>
  `${homeserver}|${notifyUrlOf(gateway)}|${pushkey}`;

let registered: string | null = null;

export const forgetMessagePusher = (): void => {
  registered = null;
};

export const registerMessagePusher = async (
  client: ClientLike,
  homeserver: string,
  deviceName: string,
  strings: Strings,
): Promise<void> => {
  const gateway = readPushGateway();
  if (!gateway) return;
  if (!(await requestNotificationPermission())) return;
  const pushkey = await devicePushToken();
  if (!pushkey) return;
  const fingerprint = pusherFingerprintOf(homeserver, gateway, pushkey);
  if (registered === fingerprint) return;
  await setPusher(client, homeserver, pusherBodyOf({ gateway, pushkey, deviceName, strings }));
  registered = fingerprint;
};
