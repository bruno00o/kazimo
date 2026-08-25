import { tokens } from "@kazimo/shared";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { Icon, type IconName } from "./Icon";
import { photoUri } from "./media";

const AVATAR_EDGE = 128;
const AVATAR_TRANSITION_MS = 150;
const BACK_ICON_SIZE = 26;
const BUTTON_ICON_SIZE = 20;
const EMPTY_ICON_SIZE = 44;
const GROUP_RADIUS_RATIO = 0.32;

export function ScreenHeader({
  title,
  onBack,
  backLabel,
  trailing,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        style={styles.headerBack}
        onPress={onBack}
      >
        <Icon name="back" color={tokens.color.blue} size={BACK_ICON_SIZE} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

export function PrimaryButton({
  label,
  icon,
  pending,
  disabled,
  onPress,
}: {
  label: string;
  icon?: IconName;
  pending?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const inactive = disabled || pending;
  return (
    <Pressable
      style={[styles.button, inactive && styles.buttonDisabled]}
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
    >
      {pending && <ActivityIndicator color={tokens.color.onAccent} />}
      {!pending && icon && <Icon name={icon} color={tokens.color.onAccent} size={BUTTON_ICON_SIZE} />}
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.fieldInput} placeholderTextColor={tokens.theme.light.inkFaint} {...input} />
    </View>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange(option.key)}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Failure({ text }: { text: string | null }) {
  if (text === null) return null;
  return <Text style={styles.failure}>{text}</Text>;
}

export function EmptyState({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyBadge}>
        <Icon name={icon} color={tokens.color.blueDeep} size={EMPTY_ICON_SIZE} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body && <Text style={styles.emptyBody}>{body}</Text>}
    </View>
  );
}

export const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

const useAvatarUri = (client: ClientLike, mxc: string | null): string | null => {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (mxc === null) {
      setUri(null);
      return;
    }
    let cancelled = false;
    void photoUri(client, { mxc, json: null }, AVATAR_EDGE)
      .then((value) => {
        if (!cancelled) setUri(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, mxc]);
  return uri;
};

export function Avatar({
  client,
  mxc,
  name,
  size,
  shape = "circle",
}: {
  client: ClientLike;
  mxc: string | null;
  name: string;
  size: number;
  shape?: "circle" | "rounded";
}) {
  const uri = useAvatarUri(client, mxc);
  const radius = shape === "circle" ? size / 2 : Math.round(size * GROUP_RADIUS_RATIO);
  const frame = { width: size, height: size, borderRadius: radius };
  if (uri !== null) {
    return (
      <Image
        source={{ uri }}
        style={frame}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={AVATAR_TRANSITION_MS}
        accessibilityLabel={name}
      />
    );
  }
  return (
    <View style={[styles.avatarFallback, frame]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.42 }]}>{initialOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.theme.light.inkFaint,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: tokens.theme.light.ink,
  },
  button: {
    marginTop: 8,
    height: 56,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: tokens.color.blue,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
    color: tokens.color.onAccent,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.theme.light.inkSoft,
  },
  fieldInput: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    fontSize: 18,
    color: tokens.theme.light.ink,
    backgroundColor: tokens.theme.light.surface,
  },
  segmented: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    borderRadius: 999,
    backgroundColor: tokens.theme.light.surface,
  },
  pill: {
    flex: 1,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  pillActive: {
    backgroundColor: tokens.color.blue,
  },
  pillText: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.theme.light.inkSoft,
  },
  pillTextActive: {
    color: tokens.color.onAccent,
  },
  failure: {
    fontSize: 14,
    textAlign: "center",
    color: tokens.color.danger,
  },
  empty: {
    alignItems: "center",
    gap: 10,
    marginTop: 64,
    paddingHorizontal: 40,
  },
  emptyBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    backgroundColor: tokens.color.blueSoft,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    color: tokens.theme.light.ink,
  },
  emptyBody: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    color: tokens.theme.light.inkSoft,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blueSoft,
  },
  avatarInitial: {
    fontWeight: "600",
    color: tokens.color.blueDeep,
  },
});
