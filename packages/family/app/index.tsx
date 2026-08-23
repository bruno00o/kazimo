import { tokens } from "@kazimo/shared";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContextMenu, hasNativeContextMenu, type MenuAction, openActionsAlert } from "../src/ContextMenu";
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import { type Conversation, conversations, leaveConversation, markRead, setRoomMuted } from "../src/session";
import { useSession } from "../src/session-context";

const t = appStrings();

const REFRESH_INTERVAL_MS = 4000;
const MUTED_ICON_SIZE = 14;
const MARK_READ_ACTION = "markRead";
const MUTE_ACTION = "mute";
const LEAVE_ACTION = "leave";
const MARK_READ_SYMBOL = "checkmark.circle";
const MUTE_SYMBOL = "bell.slash";
const UNMUTE_SYMBOL = "bell";
const LEAVE_SYMBOL = "rectangle.portrait.and.arrow.right";

const swallowLongPress = () => {};

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

const timeLabel = (timestamp: number, locale: string): string => {
  if (timestamp <= 0) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale, { day: "numeric", month: "short" });
};

const previewLabel = (conversation: Conversation): string => {
  if (!conversation.preview) return "";
  return conversation.preview.kind === "photo" ? t.photo : conversation.preview.body;
};

export default function Home() {
  const { client } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Conversation[]>([]);

  const refreshList = useCallback(() => {
    void conversations(client)
      .then(setList)
      .catch(() => {});
  }, [client]);

  const confirmLeave = useCallback(
    (conversation: Conversation) => {
      Alert.alert(t.leaveConversation, t.leaveConfirmBody, [
        { text: t.cancel, style: "cancel" },
        {
          text: t.leave,
          style: "destructive",
          onPress: () => {
            void leaveConversation(client, conversation.id).then(refreshList);
          },
        },
      ]);
    },
    [client, refreshList],
  );

  const runAction = useCallback(
    (actionKey: string, conversation: Conversation) => {
      if (actionKey === MARK_READ_ACTION) void markRead(client, conversation.id).then(refreshList);
      if (actionKey === MUTE_ACTION)
        void setRoomMuted(client, conversation.id, !conversation.muted).then(refreshList);
      if (actionKey === LEAVE_ACTION) confirmLeave(conversation);
    },
    [client, confirmLeave, refreshList],
  );

  const actionsFor = useCallback(
    (conversation: Conversation): MenuAction[] => [
      { key: MARK_READ_ACTION, title: t.markRead, systemImage: MARK_READ_SYMBOL },
      {
        key: MUTE_ACTION,
        title: conversation.muted ? t.unmute : t.mute,
        systemImage: conversation.muted ? UNMUTE_SYMBOL : MUTE_SYMBOL,
      },
      { key: LEAVE_ACTION, title: t.leaveConversation, systemImage: LEAVE_SYMBOL, destructive: true },
    ],
    [],
  );

  const openFallbackActions = useCallback(
    (conversation: Conversation) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      openActionsAlert(conversation.name, actionsFor(conversation), t.cancel, (key) =>
        runAction(key, conversation),
      );
    },
    [actionsFor, runAction],
  );

  useEffect(() => {
    refreshList();
    const timer = setInterval(refreshList, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshList]);

  useFocusEffect(refreshList);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>{t.conversations}</Text>
      <FlashList
        data={list}
        keyExtractor={(conversation) => conversation.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>{t.noConversations}</Text>}
        renderItem={({ item }) => (
          <ContextMenu title={item.name} actions={actionsFor(item)} onAction={(key) => runAction(key, item)}>
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: "/chat/[roomId]", params: { roomId: item.id } })}
              onLongPress={hasNativeContextMenu ? swallowLongPress : () => openFallbackActions(item)}
            >
              <View style={[styles.avatar, item.kind === "group" && styles.avatarGroup]}>
                <Text style={styles.avatarText}>{initial(item.name)}</Text>
              </View>
              <View style={styles.body}>
                <View style={styles.headline}>
                  <Text style={[styles.name, item.unread > 0 && styles.nameUnread]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.muted && (
                    <Icon name="muted" color={tokens.theme.light.inkFaint} size={MUTED_ICON_SIZE} />
                  )}
                  <Text style={styles.time}>{timeLabel(item.lastActive, t.locale)}</Text>
                </View>
                <View style={styles.headline}>
                  <Text style={[styles.preview, item.unread > 0 && styles.previewUnread]} numberOfLines={1}>
                    {previewLabel(item)}
                  </Text>
                  {item.unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          </ContextMenu>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.theme.light.ground,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: tokens.theme.light.ink,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  list: {
    paddingBottom: 32,
  },
  empty: {
    marginTop: 48,
    textAlign: "center",
    fontSize: 16,
    color: tokens.theme.light.inkSoft,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blueSoft,
  },
  avatarGroup: {
    borderRadius: 18,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "600",
    color: tokens.color.blueDeep,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  headline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  name: {
    flex: 1,
    fontSize: 18,
    color: tokens.theme.light.ink,
  },
  nameUnread: {
    fontWeight: "600",
  },
  time: {
    fontSize: 13,
    color: tokens.theme.light.inkSoft,
  },
  preview: {
    flex: 1,
    fontSize: 15,
    color: tokens.theme.light.inkSoft,
  },
  previewUnread: {
    color: tokens.theme.light.ink,
  },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blue,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },
});
