import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ColorValue } from "react-native";

const DEFAULT_SIZE = 24;

const catalog = {
  back: { ios: "chevron.left", android: "arrow_back" },
  send: { ios: "arrow.up", android: "arrow_upward" },
  phone: { ios: "phone.fill", android: "call" },
  video: { ios: "video.fill", android: "videocam" },
  hangUp: { ios: "phone.down.fill", android: "call_end" },
  mic: { ios: "mic.fill", android: "mic" },
  micOff: { ios: "mic.slash.fill", android: "mic_off" },
  camera: { ios: "video.fill", android: "videocam" },
  cameraOff: { ios: "video.slash.fill", android: "videocam_off" },
  flipCamera: { ios: "arrow.triangle.2.circlepath.camera.fill", android: "cameraswitch" },
  speaker: { ios: "speaker.wave.2.fill", android: "volume_up" },
  lock: { ios: "lock.fill", android: "lock" },
  muted: { ios: "bell.slash.fill", android: "notifications_off" },
  sent: { ios: "checkmark", android: "check" },
  read: { ios: "checkmark.circle.fill", android: "done_all" },
  attach: { ios: "photo.fill", android: "image" },
  close: { ios: "xmark", android: "close" },
} satisfies Record<string, SymbolViewProps["name"]>;

export type IconName = keyof typeof catalog;

export function Icon({
  name,
  color,
  size = DEFAULT_SIZE,
}: {
  name: IconName;
  color: ColorValue;
  size?: number;
}) {
  return <SymbolView name={catalog[name]} tintColor={color} size={size} resizeMode="scaleAspectFit" />;
}
