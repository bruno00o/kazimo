import { tokens } from "@kazimo/shared";
import { FlashList } from "@shopify/flash-list";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowUp, ChevronLeft, Phone } from "lucide-react-native";
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
import { type ChatItem, openTimeline, sendText, type TimelineSource } from "../../src/timeline";

const t = appStrings();

const timeOf = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" });

const dayOf = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" });

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
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [hasOlder, setHasOlder] = useState(true);
  const loadingOlder = useRef(false);

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

  const submit = useCallback(() => {
    const body = draft.trim();
    if (!body || !roomId) return;
    setDraft("");
    void sendText(client, roomId, body);
  }, [client, draft, roomId]);

  if (!roomId || !room || !conversation) return null;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable accessibilityRole="button" style={styles.back} onPress={() => router.back()}>
          <Icon glyph={ChevronLeft} color={tokens.color.blue} size={30} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {conversation.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.call}
          style={styles.callButton}
          onPress={() => router.push({ pathname: "/call/[roomId]", params: { roomId } })}
        >
          <Icon glyph={Phone} color={tokens.color.blueDeep} size={22} />
        </Pressable>
      </View>

      {items === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.color.blue} />
          <Text style={styles.note}>{t.loadingMessages}</Text>
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          maintainVisibleContentPosition={{
            startRenderingFromBottom: true,
            autoscrollToBottomThreshold: 0.2,
          }}
          onStartReached={loadOlder}
          onStartReachedThreshold={0.4}
          renderItem={({ item }) => <Row item={item} showSender={conversation.kind === "group"} />}
        />
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
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
          <Icon glyph={ArrowUp} color="#ffffff" size={22} />
        </Pressable>
      </View>
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
          item.pending && styles.bubblePending,
          item.failed && styles.bubbleFailed,
        ]}
      >
        {showSender && !mine && <Text style={styles.sender}>{item.senderName}</Text>}
        {item.kind === "text" ? (
          <Text style={[styles.bodyText, mine && styles.bodyTextMine]}>{item.body}</Text>
        ) : (
          <Text style={[styles.bodyText, mine && styles.bodyTextMine]}>{item.caption ?? t.photo}</Text>
        )}
        <Text style={[styles.meta, mine && styles.metaMine]}>{timeOf(item.timestamp)}</Text>
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
  meta: {
    alignSelf: "flex-end",
    fontSize: 11,
    color: tokens.theme.light.inkSoft,
  },
  metaMine: {
    color: "rgba(255, 255, 255, 0.8)",
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
