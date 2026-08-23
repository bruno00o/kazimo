import { requireNativeView } from "expo";
import type { ReactNode } from "react";
import { Alert, type NativeSyntheticEvent, Platform, type ViewProps } from "react-native";

export type MenuAction = {
  key: string;
  title: string;
  systemImage?: string;
  destructive?: boolean;
};

type NativeProps = ViewProps & {
  menuTitle: string;
  actions: MenuAction[];
  onAction: (event: NativeSyntheticEvent<{ key: string }>) => void;
  onOpen: () => void;
};

const NativeContextMenu = Platform.OS === "ios" ? requireNativeView<NativeProps>("KazimoContextMenu") : null;

export const hasNativeContextMenu = NativeContextMenu !== null;

export function ContextMenu({
  title,
  actions,
  onAction,
  onOpen,
  children,
}: {
  title: string;
  actions: MenuAction[];
  onAction: (key: string) => void;
  onOpen?: () => void;
  children: ReactNode;
}) {
  if (!NativeContextMenu) return children;
  return (
    <NativeContextMenu
      menuTitle={title}
      actions={actions}
      onOpen={() => onOpen?.()}
      onAction={(event) => onAction(event.nativeEvent.key)}
    >
      {children}
    </NativeContextMenu>
  );
}

export const openActionsAlert = (
  title: string,
  actions: MenuAction[],
  cancelLabel: string,
  onAction: (key: string) => void,
): void => {
  Alert.alert(title, undefined, [
    ...actions.map((action) => ({
      text: action.title,
      style: action.destructive ? ("destructive" as const) : undefined,
      onPress: () => onAction(action.key),
    })),
    { text: cancelLabel, style: "cancel" as const },
  ]);
};
