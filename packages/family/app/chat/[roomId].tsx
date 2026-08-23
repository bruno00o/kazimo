import { tokens } from "@kazimo/shared";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type MatrixEvent, type RoomMember, RoomMemberEvent } from "matrix-js-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../../src/Icon";
import { appStrings } from "../../src/i18n";
import { conversationOf } from "../../src/session";
import { useSession } from "../../src/session-context";
import {
  type ChatItem,
  openTimeline,
  sendText,
  setTyping,
  type TimelineSource,
  typingNames,
} from "../../src/timeline";

const t = appStrings();

const READ_RECEIPT_DELAY_MS = 400;
const TYPING_THROTTLE_MS = 4000;
const NEVER_TYPED = 0;
const MINE_META_COLOR = "rgba(255, 255, 255, 0.8)";
const TICK_SIZE = 14;

const timeOf = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" });

const dayOf = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" });

const typingLabelOf = (names: readonly string[]): string | null => {
  if (names.length === 0) return null;
  return names.length === 1 ? `${names[0]} ${t.typingOne}` : `${names.length} ${t.typingMany}`;
};

export default function ChatScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, identity } = useSession();
  const room = roomId ? client.getRoom(roomId) : null;
  const conversation = useMemo(
    () => (room ? conversationOf(room, identity.userId) : null),
    [room, identity.userId],
  );

  const source = useRef<TimelineSource | null>(null);
  const list = useRef<FlashListRef<ChatItem> | null>(null);
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [hasOlder, setHasOlder] = useState(true);
  const [typists, setTypists] = useState<string[]>([]);
  const loadingOlder = useRef(false);
  const acknowledged = useRef<string | null>(null);
  const typingSentAt = useRef(NEVER_TYPED);

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    void openTimeline(client, room).then((opened) => {
      if (cancelled) {
        opened.stop();
        return;
      }
      source.current = opened;
      setItems(opened.items());
      opened.subscribe(() => setItems(opened.items()));
    });
    return () => {
      cancelled = true;
      source.current?.stop();
      source.current = null;
    };
  }, [client, room]);

  useEffect(() => {
    if (!room) return;
    const refresh = () => setTypists(typingNames(room.getMembers(), identity.userId));
    const onTyping = (_event: MatrixEvent, member: RoomMember) => {
      if (member.roomId !== room.roomId) return;
      refresh();
    };
    refresh();
    client.on(RoomMemberEvent.Typing, onTyping);
    return () => {
      client.off(RoomMemberEvent.Typing, onTyping);
    };
  }, [client, room, identity.userId]);

  useEffect(() => {
    if (items === null) return;
    const event = source.current?.lastEvent() ?? null;
    const eventId = event?.getId();
    if (!event || !eventId) return;
    if (event.getSender() === identity.userId) return;
    if (acknowledged.current === eventId) return;
    const timer = setTimeout(() => {
      acknowledged.current = eventId;
      void client.sendReadReceipt(event).catch(() => {});
    }, READ_RECEIPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [client, items, identity.userId]);

  useEffect(
    () => () => {
      if (roomId && typingSentAt.current !== NEVER_TYPED) void setTyping(client, roomId, false);
    },
    [client, roomId],
  );

  const loadOlder = useCallback(async () => {
    const current = source.current;
    if (!current || !hasOlder || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      setHasOlder(await current.loadOlder());
    } finally {
      loadingOlder.current = false;
    }
  }, [hasOlder]);

  const stopTyping = useCallback(() => {
    if (!roomId || typingSentAt.current === NEVER_TYPED) return;
    typingSentAt.current = NEVER_TYPED;
    void setTyping(client, roomId, false);
  }, [client, roomId]);

  const edit = useCallback(
    (text: string) => {
      setDraft(text);
      if (!roomId) return;
      if (!text.trim()) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (now - typingSentAt.current < TYPING_THROTTLE_MS) return;
      typingSentAt.current = now;
      void setTyping(client, roomId, true);
    },
    [client, roomId, stopTyping],
  );

  const submit = useCallback(() => {
    const body = draft.trim();
    if (!body || !roomId) return;
    setDraft("");
    stopTyping();
    void sendText(client, roomId, body).catch(() => {});
  }, [client, draft, roomId, stopTyping]);

  const typingLabel = typingLabelOf(typists);

  if (!roomId || !room || !conversation) return null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityRole="button" style={styles.back} onPress={() => router.back()}>
          <Icon name="back" color={tokens.color.blue} size={26} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {conversation.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.audioCall}
          style={styles.callButton}
          onPress={() => router.push({ pathname: "/call/[roomId]", params: { roomId, video: "0" } })}
        >
          <Icon name="phone" color={tokens.color.blueDeep} size={20} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.videoCall}
          style={styles.callButton}
          onPress={() => router.push({ pathname: "/call/[roomId]", params: { roomId, video: "1" } })}
        >
          <Icon name="video" color={tokens.color.blueDeep} size={22} />
        </Pressable>
      </View>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.blue} />
          <Text style={styles.note}>{t.loadingMessages}</Text>
        </View>
      ) : (
        <FlashList
          ref={list}
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          maintainVisibleContentPosition={{
            startRenderingFromBottom: true,
            autoscrollToBottomThreshold: 0.2,
          }}
          onLoad={() => list.current?.scrollToEnd({ animated: false })}
          onStartReached={loadOlder}
          onStartReachedThreshold={0.4}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <Row item={item} showSender={conversation.kind === "group"} />}
        />
      )}

      {typingLabel !== null && <Text style={styles.typing}>{typingLabel}</Text>}

      {conversation.encrypted ? (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.notice}>
            <Icon name="lock" color={tokens.theme.light.inkSoft} size={18} />
            <Text style={styles.noticeText}>{t.encryptedUnavailable}</Text>
          </View>
        </View>
      ) : (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={edit}
            placeholder={t.messagePlaceholder}
            placeholderTextColor={tokens.theme.light.inkFaint}
            multiline
            onSubmitEditing={submit}
            blurOnSubmit={false}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.send}
            style={[styles.send, !draft.trim() && styles.sendDisabled]}
            onPress={submit}
            disabled={!draft.trim()}
          >
            <Icon name="send" color="#ffffff" size={20} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Row({ item, showSender }: { item: ChatItem; showSender: boolean }) {
  if (item.kind === "dayMarker") {
    return <Text style={styles.dayMarker}>{dayOf(item.timestamp)}</Text>;
  }
  const mine = item.mine;
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          item.delivery === "pending" && styles.bubblePending,
          item.failed && styles.bubbleFailed,
        ]}
      >
        {showSender && !mine && <Text style={styles.sender}>{item.senderName}</Text>}
        {item.kind === "text" ? (
          <Text style={[styles.bodyText, mine && styles.bodyTextMine]}>{item.body}</Text>
        ) : (
          <Text style={[styles.bodyText, mine && styles.bodyTextMine]}>{item.caption ?? t.photo}</Text>
        )}
        <View style={styles.metaRow}>
          <Text style={[styles.meta, mine && styles.metaMine]}>{timeOf(item.timestamp)}</Text>
          {mine && item.delivery !== "pending" && (
            <View accessibilityLabel={item.delivery === "read" ? t.read : t.sent}>
              <Icon
                name={item.delivery === "read" ? "read" : "sent"}
                color={MINE_META_COLOR}
                size={TICK_SIZE}
              />
            </View>
          )}
        </View>
      </View>
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
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.theme.light.inkFaint,
  },
  back: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: tokens.theme.light.ink,
  },
  callButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blueSoft,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  note: {
    fontSize: 15,
    color: tokens.theme.light.inkSoft,
  },
  list: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dayMarker: {
    alignSelf: "center",
    marginVertical: 10,
    fontSize: 13,
    color: tokens.theme.light.inkSoft,
    textTransform: "capitalize",
  },
  bubbleRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    marginVertical: 3,
  },
  bubbleRowMine: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    gap: 2,
  },
  bubbleTheirs: {
    backgroundColor: tokens.color.blueSoft,
    borderBottomLeftRadius: 6,
  },
  bubbleMine: {
    backgroundColor: tokens.color.blue,
    borderBottomRightRadius: 6,
  },
  bubblePending: {
    opacity: 0.55,
  },
  bubbleFailed: {
    backgroundColor: tokens.color.dangerSoft,
  },
  sender: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.blueDeep,
  },
  bodyText: {
    fontSize: 17,
    color: tokens.theme.light.ink,
  },
  bodyTextMine: {
    color: "#ffffff",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 4,
  },
  meta: {
    fontSize: 11,
    color: tokens.theme.light.inkSoft,
  },
  metaMine: {
    color: MINE_META_COLOR,
  },
  typing: {
    paddingHorizontal: 18,
    paddingBottom: 4,
    fontSize: 13,
    color: tokens.theme.light.inkSoft,
  },
  notice: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    color: tokens.theme.light.inkSoft,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.theme.light.inkFaint,
    backgroundColor: tokens.theme.light.ground,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    fontSize: 17,
    color: tokens.theme.light.ink,
    backgroundColor: tokens.color.blueSoft,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blue,
  },
  sendDisabled: {
    opacity: 0.4,
  },
});
