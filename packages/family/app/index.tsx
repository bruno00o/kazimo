import { tokens } from "@kazimo/shared";
import { FlashList } from "@shopify/flash-list";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContextMenu, hasNativeContextMenu, type MenuAction, openActionsAlert } from "../src/ContextMenu";
import { type FrameAccess, frameAccess, frameScopeOf } from "../src/frame";
import { Icon } from "../src/Icon";
import { appStrings } from "../src/i18n";
import {
  acceptInvite,
  declineInvite,
  type FrameScope,
  localpartOf,
  pendingInvites,
  type RoomInvite,
} from "../src/rooms";
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
import { Avatar, EmptyState, initialOf } from "../src/ui";

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

const AVATAR_SIZE = 56;
const INVITE_AVATAR_SIZE = 44;
const NO_INVITES: RoomInvite[] = [];
const NOT_WORKING = null;
const NO_FRAME_SCOPE: FrameScope = { controlRoomId: null, frameUserIds: [] };

const swallowLongPress = () => {};

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
  client,
  conversation,
  actions,
  onAction,
  onOpen,
  onFallbackActions,
}: {
  client: ClientLike;
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
          <Avatar
            client={client}
            mxc={conversation.avatarUrl}
            name={conversation.name}
            size={AVATAR_SIZE}
            shape={conversation.kind === "group" ? "rounded" : "circle"}
          />
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

function InviteRow({
  client,
  invite,
  busy,
  onAccept,
  onDecline,
}: {
  client: ClientLike;
  invite: RoomInvite;
  busy: boolean;
  onAccept: (invite: RoomInvite) => void;
  onDecline: (invite: RoomInvite) => void;
}) {
  return (
    <View style={styles.invite}>
      <View style={styles.inviteHead}>
        <Avatar
          client={client}
          mxc={invite.avatarUrl}
          name={invite.name}
          size={INVITE_AVATAR_SIZE}
          shape="rounded"
        />
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {invite.name}
          </Text>
          <Text style={styles.preview} numberOfLines={1}>
            {`${t.inviteFrom} ${invite.inviterName}`}
          </Text>
        </View>
      </View>
      <View style={styles.inviteActions}>
        <Pressable
          accessibilityRole="button"
          style={[styles.inviteButton, busy && styles.inviteBusy]}
          disabled={busy}
          onPress={() => onDecline(invite)}
        >
          <Text style={styles.inviteDeclineText}>{t.inviteDecline}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.inviteButton, styles.inviteAccept, busy && styles.inviteBusy]}
          disabled={busy}
          onPress={() => onAccept(invite)}
        >
          <Text style={styles.inviteAcceptText}>{t.inviteAccept}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function Home() {
  const { client, sync, signOut, identity } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<Conversation[]>([]);
  const [access, setAccess] = useState<FrameAccess | null>(null);
  const [invites, setInvites] = useState<RoomInvite[]>(NO_INVITES);
  const [working, setWorking] = useState<string | null>(NOT_WORKING);
  const scope = useRef<FrameScope | null>(null);

  const refreshList = useCallback(() => {
    void conversations(client)
      .then(setList)
      .catch(() => {});
  }, [client]);

  const refreshInvites = useCallback(() => {
    const current = scope.current;
    if (!current) return;
    void pendingInvites(client, current)
      .then(setInvites)
      .catch(() => {});
  }, [client]);

  const refresh = useCallback(() => {
    refreshList();
    refreshInvites();
  }, [refreshInvites, refreshList]);

  const answerInvite = useCallback(
    (invite: RoomInvite, join: boolean) => {
      setWorking(invite.roomId);
      const done = join ? acceptInvite(client, invite.roomId) : declineInvite(client, invite.roomId);
      void done
        .then(() => {
          setInvites((current) => current.filter((pending) => pending.roomId !== invite.roomId));
          refreshList();
        })
        .catch(() => Alert.alert(t.inviteFailed))
        .finally(() => setWorking(NOT_WORKING));
    },
    [client, refreshList],
  );

  const joinInvite = useCallback((invite: RoomInvite) => answerInvite(invite, true), [answerInvite]);
  const refuseInvite = useCallback((invite: RoomInvite) => answerInvite(invite, false), [answerInvite]);

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
    void subscribeConversations(client, sync, (next) => {
      setList(next);
      refreshInvites();
    })
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
  }, [client, sync, refreshInvites]);

  useEffect(() => {
    let cancelled = false;
    void frameAccess(client)
      .then((found) => {
        if (cancelled) return;
        setAccess(found);
        scope.current = frameScopeOf(found);
      })
      .catch(() => {
        scope.current = NO_FRAME_SCOPE;
      })
      .finally(() => {
        if (!cancelled) refreshInvites();
      });
    return () => {
      cancelled = true;
    };
  }, [client, refreshInvites]);

  useFocusEffect(refresh);

  const controlRoomId = access?.link?.controlRoomId ?? null;
  const showFrame = access !== null && (access.link !== null || !access.adminElsewhere);
  const visible = controlRoomId ? list.filter((conversation) => conversation.id !== controlRoomId) : list;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
          {t.conversations}
        </Text>
        <Pressable
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={t.newConversation}
          onPress={() => router.push("/new")}
        >
          <Icon name="add" color={tokens.color.blue} />
        </Pressable>
        {showFrame && (
          <Pressable
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={t.frameTitle}
            onPress={() => router.push("/frame")}
          >
            <Icon name="frame" color={tokens.color.blue} />
          </Pressable>
        )}
        <Pressable
          style={styles.accountChip}
          accessibilityRole="button"
          accessibilityLabel={t.signOut}
          onPress={confirmSignOut}
        >
          <Text style={styles.accountInitial}>{initialOf(localpartOf(identity.userId))}</Text>
        </Pressable>
      </View>
      <FlashList
        data={visible}
        keyExtractor={(conversation) => conversation.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          invites.length === 0 ? null : (
            <View style={styles.invites}>
              <Text style={styles.sectionTitle}>{t.invites}</Text>
              {invites.map((invite) => (
                <InviteRow
                  key={invite.roomId}
                  client={client}
                  invite={invite}
                  busy={working === invite.roomId}
                  onAccept={joinInvite}
                  onDecline={refuseInvite}
                />
              ))}
            </View>
          )
        }
        ListEmptyComponent={
          <EmptyState icon="group" title={t.noConversations} body={t.noConversationsHint} />
        }
        renderItem={({ item }) => (
          <ConversationRow
            client={client}
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
  accountChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.theme.light.surface,
  },
  accountInitial: {
    fontSize: 16,
    fontWeight: "600",
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
  invites: {
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    color: tokens.theme.light.inkSoft,
  },
  invite: {
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: tokens.color.blueSoft,
  },
  inviteHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  inviteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  inviteButton: {
    minWidth: 110,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: tokens.theme.light.ground,
  },
  inviteAccept: {
    backgroundColor: tokens.color.blue,
  },
  inviteBusy: {
    opacity: 0.5,
  },
  inviteDeclineText: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.theme.light.inkSoft,
  },
  inviteAcceptText: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.onAccent,
  },
});
