import type { MatrixClient } from "matrix-js-sdk";

export type RtcSession = ReturnType<MatrixClient["matrixRTC"]["getRoomSession"]>;

export type SfuToken = {
  url: string;
  jwt: string;
};

export type SfuClaims = {
  room: string;
  identity: string;
};

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

export const sfuToken = async (
  serviceUrl: string,
  client: MatrixClient,
  roomName: string,
): Promise<SfuToken> => {
  const openIdToken = await client.getOpenIdToken();
  const res = await fetch(`${serviceUrl}/sfu/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      room: roomName,
      openid_token: openIdToken,
      device_id: client.getDeviceId() ?? "",
    }),
  });
  if (!res.ok) throw new Error(`sfu ${res.status} ${await res.text()}`);
  const body = (await res.json()) as SfuToken;
  return { url: body.url, jwt: body.jwt };
};

export const joinRtc = (client: MatrixClient, roomId: string, serviceUrl: string): RtcSession => {
  const room = client.getRoom(roomId);
  if (!room) throw new Error(`unknown room ${roomId}`);
  const userId = client.getUserId() ?? "";
  const deviceId = client.getDeviceId() ?? "";
  const focus = { type: "livekit", livekit_service_url: serviceUrl };
  const session = client.matrixRTC.getRoomSession(room);
  session.joinRTCSession({ userId, deviceId, memberId: `${userId}:${deviceId}` }, [focus], focus, {
    manageMediaKeys: false,
  });
  return session;
};

export const leaveRtc = async (session: RtcSession): Promise<void> => {
  await session.leaveRoomSession();
};

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
