import "./polyfills";
import { registerGlobals } from "@livekit/react-native";
import { applyCallKitAudioSession, startCallAudioPolicy } from "./src/call-audio";
import { callEvents } from "./src/callkeep";
import "expo-router/entry";

registerGlobals({ autoConfigureAudioSession: false });
startCallAudioPolicy();
callEvents.start(applyCallKitAudioSession);
