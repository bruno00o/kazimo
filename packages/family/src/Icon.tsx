import type { LucideIcon } from "lucide-react-native";

const DEFAULT_SIZE = 24;

export function Icon({
  glyph: Glyph,
  color,
  size = DEFAULT_SIZE,
}: {
  glyph: LucideIcon;
  color: string;
  size?: number;
}) {
  return <Glyph color={color} fill={color} size={size} strokeWidth={1.5} />;
}
