import { Platform } from "react-native";
import RNCallKeep from "react-native-callkeep";
import type { Strings } from "./i18n";

export type CallKeepEvent = "answerCall" | "endCall";

export const setupCallKeep = async (strings: Strings): Promise<void> => {
  await RNCallKeep.setup({
    ios: {
      appName: "Kazimo",
      supportsVideo: true,
      maximumCallGroups: "1",
      maximumCallsPerCallGroup: "1",
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

export const ringIncoming = (uuid: string, handle: string, name: string): void => {
  RNCallKeep.displayIncomingCall(uuid, handle, name, "generic", true);
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

export const callUuid = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  const group = (start: number, end: number) => hex.slice(start, end).join("");
  return `${group(0, 4)}-${group(4, 6)}-${group(6, 8)}-${group(8, 10)}-${group(10, 16)}`.toUpperCase();
};
