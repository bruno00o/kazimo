export { A2UI_ICONS, type A2uiIcon, type A2uiNode } from "./a2ui";
export {
  CONTACT_EVENT_TYPE,
  CONTROL_ADMIN_POWER_LEVEL,
  CONTROL_EVENT_TYPE,
  type ContactContent,
  contactOf,
  contactStateKeyOf,
  contactUserIdOf,
  FRAME_EVENT_TYPE,
  type FrameContact,
  type FrameStatusContent,
  frameStatusOf,
} from "./control";
export {
  DIAL_BAUD_RATE,
  DIAL_BUTTON_KINDS,
  DIAL_BUTTONS,
  DIAL_LABEL_MAX_LENGTH,
  type DialButton,
  type DialButtonKind,
  type DialCommand,
  type DialEvent,
  encodeDialCommand,
  parseDialEvent,
} from "./dial";
export {
  codesMatch,
  formatPairingCode,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_QR_KIND,
  pairingQrPayload,
} from "./pairing";
export {
  isRingDeviceToken,
  parseRingPushPayload,
  parseRingRequest,
  RING_EVENT_TYPE,
  RING_MAX_CALL_ID_LENGTH,
  RING_MAX_CALLER_NAME_LENGTH,
  RING_MAX_DEVICE_TOKENS,
  RING_MAX_ROOM_ID_LENGTH,
  RING_PATH,
  RING_PAYLOAD_VERSION,
  RING_STALE_REASONS,
  type RingDevice,
  type RingDevicesContent,
  type RingErrorCode,
  type RingErrorResponse,
  type RingPushPayload,
  type RingRequest,
  type RingResponse,
  type RingResult,
  ringDeviceIsCurrent,
  ringDevicesOf,
  ringPushIsLive,
  ringTokenIsStale,
  ringTokensOf,
  withoutRingTokens,
  withRingDevice,
} from "./ring";
export { type Tokens, tokens } from "./tokens";

import type { A2uiIcon, A2uiNode } from "./a2ui";

export type KioskState =
  | { kind: "idle"; photo: PhotoRef | null; activity?: ActivitySummary }
  | { kind: "incoming-call"; caller: Person }
  | { kind: "in-call"; caller: Person }
  | { kind: "message"; from: Person; text?: string; photo?: PhotoRef }
  | { kind: "degraded"; reason: string }
  | { kind: "faces"; people: Person[]; focused: number }
  | { kind: "assistant"; tree: A2uiNode };

export interface UnreadItem {
  userId: string;
  from: string;
  kind: "text" | "photo";
  body: string | null;
  timestamp: number;
}

export interface MissedCall {
  userId: string;
  from: string;
  timestamp: number;
}

export interface ActivitySummary {
  unread: UnreadItem[];
  missed: MissedCall[];
  ringing: { from: string } | null;
}

export interface Person {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PhotoRef {
  url: string;
  caption: string | null;
  sender: string | null;
  timestamp: number;
}

export interface Contact {
  userId: string;
  displayName: string;
  roomId: string;
}

export type RingDevices = Record<string, string[]>;

export interface HistoryMessage {
  from: string;
  kind: "text" | "photo";
  body: string | null;
  timestamp: number;
}

export interface PhotosResult {
  shown: number;
  from: string | null;
  timestamp: number | null;
}

export interface Announcement {
  from: string;
  kind: "text" | "photo";
  body: string | null;
}

export interface WeatherSummary {
  tempC: number;
  icon: A2uiIcon;
}

export const CAPTURE_SAMPLE_RATE = 16000;

export type DaemonToKiosk =
  | { type: "state"; state: KioskState }
  | { type: "config"; config: KioskConfig }
  | { type: "assistant"; tree: A2uiNode | null }
  | { type: "weather"; weather: WeatherSummary | null }
  | { type: "wake" }
  | { type: "thinking"; on: boolean }
  | { type: "noisy" }
  | { type: "answer-call" }
  | { type: "activity-clear"; what: "unread" | "missed" }
  | { type: "place-call"; roomId: string }
  | { type: "send-message"; roomId: string; text: string }
  | { type: "show-photos"; id: number; userId: string | null }
  | { type: "history-request"; id: number; roomId: string; limit: number }
  | { type: "ring-stale"; userId: string; tokens: string[] };

export type KioskToDaemon =
  | { type: "ready" }
  | { type: "event"; name: KioskEvent }
  | { type: "capture-start" }
  | { type: "capture-end" }
  | { type: "playback-start" }
  | { type: "playback-end" }
  | { type: "activity"; activity: ActivitySummary }
  | { type: "announce"; announcement: Announcement }
  | { type: "contacts"; contacts: Contact[] }
  | { type: "ring-devices"; devices: RingDevices }
  | { type: "history"; id: number; messages: HistoryMessage[] }
  | { type: "photos-result"; id: number; result: PhotosResult };

export type KioskReply = Extract<KioskToDaemon, { type: "history" } | { type: "photos-result" }>;

export type KioskEvent = "call-connected" | "call-ended" | "media-error";

export interface KioskConfig {
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  roomId: string | null;
  contacts: string[] | null;
  mic: string | null;
  lang: string;
  idleReturnSeconds: number;
  autoAnswerDelayMs: number;
  nightStartHour: number;
  nightEndHour: number;
  pairing: { code: string } | null;
}
