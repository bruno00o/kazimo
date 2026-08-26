import type { AppleAudioConfiguration, IOSAudioSessionPolicy } from "@livekit/react-native";
import { setupIOSAudioManagement } from "@livekit/react-native";
import { RTCAudioSession } from "@livekit/react-native-webrtc";
import { Platform } from "react-native";
import type { AudioSessionEvent } from "./callkeep";

const PREFER_SPEAKER_OUTPUT = true;

export const CALL_AUDIO_SESSION: AppleAudioConfiguration = {
  audioCategory: "playAndRecord",
  audioCategoryOptions: ["allowBluetooth", "allowBluetoothA2DP", "allowAirPlay", "defaultToSpeaker"],
  audioMode: "videoChat",
};

export const CALL_AUDIO_POLICY: IOSAudioSessionPolicy = {
  recording: CALL_AUDIO_SESSION,
  playout: CALL_AUDIO_SESSION,
  deactivateOnStop: true,
};

export const startCallAudioPolicy = (): void => {
  if (Platform.OS !== "ios") return;
  setupIOSAudioManagement(PREFER_SPEAKER_OUTPUT, CALL_AUDIO_POLICY);
};

export const applyCallKitAudioSession = (event: AudioSessionEvent): void => {
  if (event === "didActivateAudioSession") RTCAudioSession.audioSessionDidActivate();
  else RTCAudioSession.audioSessionDidDeactivate();
};
