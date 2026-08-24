import { tokens } from "@kazimo/shared";
import { FlashList } from "@shopify/flash-list";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContextMenu, hasNativeContextMenu, type MenuAction, openActionsAlert } from "../src/ContextMenu";
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import {
  type Conversation,
  type ConversationsSubscription,
  conversations,
  leaveConversation,
  markRead,
  setRoomMuted,
  subscribeConversations,
} from "../src/session";
import { useSession } from "../src/session-context";

const t = appStrings();

const MUTED_ICON_SIZE = 14;
const ACTION_ICON_SIZE = 22;
const ACTION_WIDTH = 76;
const SWIPE_FRICTION = 2;
const MARK_READ_ACTION = "markRead";
const MUTE_ACTION = "mute";
const LEAVE_ACTION = "leave";
const MARK_READ_SYMBOL = "checkmark.circle";
const MUTE_SYMBOL = "bell.slash";
const UNMUTE_SYMBOL = "bell";
const LEAVE_SYMBOL = "rectangle.portrait.and.arrow.right";
const ACTION_INK = "#ffffff";

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

function ConversationRow({
  conversation,
  actions,
  onAction,
  onOpen,
  onFallbackActions,
}: {
  conversation: Conversation;
  actions: MenuAction[];
  onAction: (actionKey: string, conversation: Conversation) => void;
  onOpen: (conversation: Conversation) => void;
  onFallbackActions: (conversation: Conversation) => void;
}) {
  const swipeable = useRef<SwipeableMethods | null>(null);

  const run = useCallback(
    (actionKey: string) => {
      swipeable.current?.close();
      onAction(actionKey, conversation);
    },
    [conversation, onAction],
  );

  const renderRightActions = useCallback(
    () => (
      <>
        <Pressable
          style={[styles.action, styles.actionLeave]}
          accessibilityRole="button"
          accessibilityLabel={t.leaveConversation}
          onPress={() => run(LEAVE_ACTION)}
        >
          <Icon name="leave" color={ACTION_INK} size={ACTION_ICON_SIZE} />
        </Pressable>
        <Pressable
          style={[styles.action, styles.actionMute]}
          accessibilityRole="button"
          accessibilityLabel={conversation.muted ? t.unmute : t.mute}
          onPress={() => run(MUTE_ACTION)}
        >
          <Icon name={conversation.muted ? "unmuted" : "muted"} color={ACTION_INK} size={ACTION_ICON_SIZE} />
        </Pressable>
      </>
    ),
    [conversation.muted, run],
  );

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={SWIPE_FRICTION}
      rightThreshold={ACTION_WIDTH / 2}
      overshootRight={false}
      renderRightActions={renderRightActions}
    >
      <ContextMenu title={conversation.name} actions={actions} onAction={run}>
        <Pressable
          style={styles.row}
          onPress={() => onOpen(conversation)}
          onLongPress={hasNativeContextMenu ? swallowLongPress : () => onFallbackActions(conversation)}
        >
          <View style={[styles.avatar, conversation.kind === "group" && styles.avatarGroup]}>
            <Text style={styles.avatarText}>{initial(conversation.name)}</Text>
          </View>
          <View style={styles.body}>
            <View style={styles.headline}>
              <Text style={[styles.name, conversation.unread > 0 && styles.nameUnread]} numberOfLines={1}>
                {conversation.name}
              </Text>
              {conversation.muted && (
                <Icon name="muted" color={tokens.theme.light.inkFaint} size={MUTED_ICON_SIZE} />
              )}
              <Text style={styles.time}>{timeLabel(conversation.lastActive, t.locale)}</Text>
            </View>
            <View style={styles.headline}>
              <Text
                style={[styles.preview, conversation.unread > 0 && styles.previewUnread]}
                numberOfLines={1}
              >
                {previewLabel(conversation)}
              </Text>
              {conversation.unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{conversation.unread}</Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </ContextMenu>
    </ReanimatedSwipeable>
  );
}

export default function Home() {
  const { client, sync, signOut } = useSession();
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

  const confirmSignOut = useCallback(() => {
    Alert.alert(t.signOut, undefined, [
      { text: t.cancel, style: "cancel" },
      { text: t.signOut, style: "destructive", onPress: () => void signOut() },
    ]);
  }, [signOut]);

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

  const openConversation = useCallback(
    (conversation: Conversation) => {
      router.push({ pathname: "/chat/[roomId]", params: { roomId: conversation.id } });
    },
    [router],
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
    let started: ConversationsSubscription | null = null;
    let cancelled = false;
    void subscribeConversations(client, sync, setList)
      .then((subscription) => {
        if (cancelled) {
          subscription.stop();
          return;
        }
        started = subscription;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      started?.stop();
    };
  }, [client, sync]);

  useFocusEffect(refreshList);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t.conversations}</Text>
        <Pressable
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t.newConversation}
          onPress={() => router.push("/new")}
        >
          <Icon name="add" color={tokens.color.blue} />
        </Pressable>
        <Pressable
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t.pairTitle}
          onPress={() => router.push("/pair")}
        >
          <Icon name="frame" color={tokens.color.blue} />
        </Pressable>
        <Pressable
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t.signOut}
          onPress={confirmSignOut}
        >
          <Icon name="signOut" color={tokens.theme.light.inkSoft} />
        </Pressable>
      </View>
      <FlashList
        data={list}
        keyExtractor={(conversation) => conversation.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>{t.noConversations}</Text>}
        renderItem={({ item }) => (
          <ConversationRow
            conversation={item}
            actions={actionsFor(item)}
            onAction={runAction}
            onOpen={openConversation}
            onFallbackActions={openFallbackActions}
          />
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 34,
    fontWeight: "700",
    color: tokens.theme.light.ink,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: tokens.theme.light.ground,
  },
  action: {
    width: ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  actionMute: {
    backgroundColor: tokens.theme.light.inkSoft,
  },
  actionLeave: {
    backgroundColor: tokens.color.danger,
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
