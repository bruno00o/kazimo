import { Platform } from "react-native";
import RNCallKeep, { AudioSessionCategoryOption, AudioSessionMode } from "react-native-callkeep";
import type { Strings } from "./i18n";

export type CallKeepEvent = "answerCall" | "endCall";

export type BufferedCallEvent = { event: CallKeepEvent; uuid: string };

const NATIVE_EVENT_NAMES: Record<CallKeepEvent, string> = {
  answerCall: "RNCallKeepPerformAnswerCallAction",
  endCall: "RNCallKeepPerformEndCallAction",
};

const CALL_AUDIO_CATEGORY_OPTIONS =
  AudioSessionCategoryOption.allowBluetooth |
  AudioSessionCategoryOption.allowBluetoothA2DP |
  AudioSessionCategoryOption.allowAirPlay |
  AudioSessionCategoryOption.defaultToSpeaker;

export const setupCallKeep = async (strings: Strings): Promise<void> => {
  await RNCallKeep.setup({
    ios: {
      appName: "Kazimo",
      supportsVideo: true,
      maximumCallGroups: "1",
      maximumCallsPerCallGroup: "1",
      audioSession: {
        categoryOptions: CALL_AUDIO_CATEGORY_OPTIONS,
        mode: AudioSessionMode.videoChat,
      },
    },
    android: {
      alertTitle: strings.callPermissionsTitle,
      alertDescription: strings.callPermissionsBody,
      cancelButton: strings.cancel,
      okButton: strings.ok,
      additionalPermissions: [],
      foregroundService: {
        channelId: "com.kazimo.family",
        channelName: strings.callChannel,
        notificationTitle: strings.inCall,
      },
    },
  });
  if (Platform.OS === "android") RNCallKeep.setAvailable(true);
};

export const ringIncoming = (uuid: string, handle: string, name: string, hasVideo: boolean): void => {
  RNCallKeep.displayIncomingCall(uuid, handle, name, "generic", hasVideo);
};

export const markActive = (uuid: string): void => {
  if (Platform.OS === "ios") RNCallKeep.setCurrentCallActive(uuid);
  if (Platform.OS === "android") RNCallKeep.backToForeground();
};

export const dismiss = (uuid: string): void => {
  RNCallKeep.endCall(uuid);
};

export const dismissAll = (): void => {
  RNCallKeep.endAllCalls();
};

export const onCallEvent = (event: CallKeepEvent, handler: (uuid: string) => void): (() => void) => {
  const listener = ({ callUUID }: { callUUID: string }) => handler(callUUID.toUpperCase());
  RNCallKeep.addEventListener(event, listener);
  return () => RNCallKeep.removeEventListener(event);
};

export const takeBufferedCallEvents = async (): Promise<BufferedCallEvent[]> => {
  const buffered = await RNCallKeep.getInitialEvents().catch(() => []);
  RNCallKeep.clearInitialEvents();
  const replay: BufferedCallEvent[] = [];
  for (const entry of buffered) {
    const uuid = (entry.data as { callUUID?: string } | undefined)?.callUUID;
    if (typeof uuid !== "string") continue;
    for (const event of ["answerCall", "endCall"] as const) {
      if (entry.name === NATIVE_EVENT_NAMES[event]) replay.push({ event, uuid: uuid.toUpperCase() });
    }
  }
  return replay;
};

export const callUuid = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  const group = (start: number, end: number) => hex.slice(start, end).join("");
  return `${group(0, 4)}-${group(4, 6)}-${group(6, 8)}-${group(8, 10)}-${group(10, 16)}`.toUpperCase();
};
