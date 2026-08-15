export type { A2uiNode } from "./a2ui";
export { type Tokens, tokens } from "./tokens";

import type { A2uiNode } from "./a2ui";

export type KioskState =
  | { kind: "idle"; photo: PhotoRef | null }
  | { kind: "incoming-call"; caller: Person }
  | { kind: "in-call"; caller: Person }
  | { kind: "message"; from: Person; text?: string; photo?: PhotoRef }
  | { kind: "degraded"; reason: string }
  | { kind: "faces"; people: Person[]; focused: number }
  | { kind: "assistant"; tree: A2uiNode };

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

export const CAPTURE_SAMPLE_RATE = 16000;

export type DaemonToKiosk =
  | { type: "state"; state: KioskState }
  | { type: "config"; config: KioskConfig }
  | { type: "assistant"; tree: A2uiNode };

export type KioskToDaemon =
  | { type: "ready" }
  | { type: "event"; name: KioskEvent }
  | { type: "capture-start" }
  | { type: "capture-end" };

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
}
