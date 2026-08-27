import { Platform } from "react-native";
import RNCallKeep, { AudioSessionCategoryOption, AudioSessionMode, CONSTANTS } from "react-native-callkeep";
import type { Strings } from "./i18n";

export type CallKeepEvent = "answerCall" | "endCall";

export type AudioSessionEvent = "didActivateAudioSession" | "didDeactivateAudioSession";

export type CallEvent = { event: CallKeepEvent; uuid: string };

export type ReplayedEvent = { call: CallEvent } | { audioSession: AudioSessionEvent };

export type CallEvents = {
  start: (onAudioSession: (event: AudioSessionEvent) => void) => void;
  take: (sink: (event: CallEvent) => void) => () => void;
};

const CALL_EVENTS: CallKeepEvent[] = ["answerCall", "endCall"];

const AUDIO_SESSION_EVENTS: AudioSessionEvent[] = ["didActivateAudioSession", "didDeactivateAudioSession"];

const NATIVE_CALL_EVENT_NAMES: Record<CallKeepEvent, string> = {
  answerCall: "RNCallKeepPerformAnswerCallAction",
  endCall: "RNCallKeepPerformEndCallAction",
};

const NATIVE_AUDIO_SESSION_EVENT_NAMES: Record<AudioSessionEvent, string> = {
  didActivateAudioSession: "RNCallKeepDidActivateAudioSession",
  didDeactivateAudioSession: "RNCallKeepDidDeactivateAudioSession",
};

const CALL_AUDIO_CATEGORY_OPTIONS =
  AudioSessionCategoryOption.allowBluetooth |
  AudioSessionCategoryOption.allowBluetoothA2DP |
  AudioSessionCategoryOption.allowAirPlay |
  AudioSessionCategoryOption.defaultToSpeaker;

const SINGLE_CALL_OPTIONS = {
  ios: {
    supportsHolding: false,
    supportsDTMF: false,
    supportsGrouping: false,
    supportsUngrouping: false,
  },
};

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
  RNCallKeep.displayIncomingCall(uuid, handle, name, "generic", hasVideo, SINGLE_CALL_OPTIONS);
};

export const markActive = (uuid: string): void => {
  if (Platform.OS === "ios") RNCallKeep.setCurrentCallActive(uuid);
  if (Platform.OS === "android") RNCallKeep.backToForeground();
};

export const dismiss = (uuid: string): void => {
  RNCallKeep.endCall(uuid);
};

export const dismissUnanswered = (uuid: string): void => {
  RNCallKeep.reportEndCallWithUUID(uuid, CONSTANTS.END_CALL_REASONS.UNANSWERED);
};

export const dismissAll = (): void => {
  RNCallKeep.endAllCalls();
};

export const replayedCallKeepEvents = (
  buffered: readonly { name?: unknown; data?: unknown }[],
): ReplayedEvent[] => {
  const replay: ReplayedEvent[] = [];
  for (const entry of buffered) {
    for (const event of AUDIO_SESSION_EVENTS) {
      if (entry.name === NATIVE_AUDIO_SESSION_EVENT_NAMES[event]) replay.push({ audioSession: event });
    }
    const uuid = (entry.data as { callUUID?: string } | undefined)?.callUUID;
    if (typeof uuid !== "string") continue;
    for (const event of CALL_EVENTS) {
      if (entry.name === NATIVE_CALL_EVENT_NAMES[event]) {
        replay.push({ call: { event, uuid: uuid.toUpperCase() } });
      }
    }
  }
  return replay;
};

export const createCallEvents = (): CallEvents => {
  const queued: CallEvent[] = [];
  let sink: ((event: CallEvent) => void) | null = null;
  let audioSink: ((event: AudioSessionEvent) => void) | null = null;

  const takeCall = (call: CallEvent) => {
    if (sink) sink(call);
    else queued.push(call);
  };

  const replay = (replayed: ReplayedEvent) => {
    if ("call" in replayed) takeCall(replayed.call);
    else audioSink?.(replayed.audioSession);
  };

  return {
    start(onAudioSession) {
      audioSink = onAudioSession;
      for (const event of CALL_EVENTS) {
        RNCallKeep.addEventListener(event, ({ callUUID }) =>
          takeCall({ event, uuid: callUUID.toUpperCase() }),
        );
      }
      for (const event of AUDIO_SESSION_EVENTS) {
        RNCallKeep.addEventListener(event, () => audioSink?.(event));
      }
      void RNCallKeep.getInitialEvents()
        .then((buffered) => {
          RNCallKeep.clearInitialEvents();
          for (const replayed of replayedCallKeepEvents(buffered)) replay(replayed);
        })
        .catch(() => {});
    },
    take(next) {
      sink = next;
      for (const call of queued.splice(0, queued.length)) next(call);
      return () => {
        if (sink === next) sink = null;
      };
    },
  };
};

export const callEvents = createCallEvents();

export const callUuid = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  const group = (start: number, end: number) => hex.slice(start, end).join("");
  return `${group(0, 4)}-${group(4, 6)}-${group(6, 8)}-${group(8, 10)}-${group(10, 16)}`.toUpperCase();
};
