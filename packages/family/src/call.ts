import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { authorizedFetch } from "./http";

export type SfuToken = {
  url: string;
  jwt: string;
};

export type SfuClaims = {
  room: string;
  identity: string;
};

const RTC_MEMBER_EVENT_TYPE = "org.matrix.msc3401.call.member";
const RTC_APPLICATION = "m.call";
const RTC_ROOM_CALL_ID = "";
const RTC_ROOM_SCOPE = "m.room";
const LIVEKIT_FOCUS_TYPE = "livekit";
const OLDEST_MEMBERSHIP_SELECTION = "oldest_membership";
const MEMBERSHIP_EXPIRY_MS = 4 * 60 * 60 * 1000;
const CLEARED_MEMBERSHIP = {};

const csApiBase = (client: ClientLike): string => client.session().homeserverUrl.replace(/\/+$/, "");

export const rtcFocusUrl = async (homeserver: string): Promise<string> => {
  const res = await fetch(`${homeserver}/.well-known/matrix/client`);
  if (!res.ok) throw new Error(`well-known ${res.status}`);
  const body = (await res.json()) as {
    "org.matrix.msc4143.rtc_foci"?: Array<{ type: string; livekit_service_url?: string }>;
  };
  const focus = body["org.matrix.msc4143.rtc_foci"]?.find(
    (entry) => entry.type === "livekit" && typeof entry.livekit_service_url === "string",
  );
  if (!focus?.livekit_service_url) throw new Error("no livekit focus advertised");
  return focus.livekit_service_url;
};

const openIdToken = async (client: ClientLike): Promise<unknown> => {
  const userId = client.session().userId;
  const base = csApiBase(client);
  const res = await authorizedFetch(
    client,
    `${base}/_matrix/client/v3/user/${encodeURIComponent(userId)}/openid/request_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) throw new Error(`openid ${res.status} ${await res.text()}`);
  return res.json();
};

export const sfuToken = async (
  serviceUrl: string,
  client: ClientLike,
  roomName: string,
): Promise<SfuToken> => {
  const res = await fetch(`${serviceUrl}/sfu/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      room: roomName,
      openid_token: await openIdToken(client),
      device_id: client.deviceId(),
    }),
  });
  if (!res.ok) throw new Error(`sfu ${res.status} ${await res.text()}`);
  const body = (await res.json()) as SfuToken;
  return { url: body.url, jwt: body.jwt };
};

const membershipStateKey = (userId: string, deviceId: string): string =>
  `_${userId}_${deviceId}_${RTC_APPLICATION}`;

const putMembership = async (client: ClientLike, roomId: string, content: unknown): Promise<void> => {
  const { userId, deviceId } = client.session();
  const stateKey = membershipStateKey(userId, deviceId);
  const res = await authorizedFetch(
    client,
    `${csApiBase(client)}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${RTC_MEMBER_EVENT_TYPE}/${encodeURIComponent(stateKey)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    },
  );
  if (!res.ok) throw new Error(`rtc membership ${res.status} ${await res.text()}`);
};

export const joinRtc = async (client: ClientLike, roomId: string, serviceUrl: string): Promise<void> => {
  const { userId, deviceId } = client.session();
  await putMembership(client, roomId, {
    application: RTC_APPLICATION,
    call_id: RTC_ROOM_CALL_ID,
    scope: RTC_ROOM_SCOPE,
    device_id: deviceId,
    membershipID: `${userId}:${deviceId}`,
    expires: MEMBERSHIP_EXPIRY_MS,
    focus_active: { type: LIVEKIT_FOCUS_TYPE, focus_selection: OLDEST_MEMBERSHIP_SELECTION },
    foci_preferred: [{ type: LIVEKIT_FOCUS_TYPE, livekit_service_url: serviceUrl, livekit_alias: roomId }],
  });
};

export const leaveRtc = (client: ClientLike, roomId: string): Promise<void> =>
  putMembership(client, roomId, CLEARED_MEMBERSHIP);

export const sfuClaims = (jwt: string): SfuClaims | null => {
  try {
    const [, payload] = jwt.split(".");
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      video?: { room?: string };
      sub?: string;
    };
    return { room: decoded.video?.room ?? "", identity: decoded.sub ?? "" };
  } catch {
    return null;
  }
};
