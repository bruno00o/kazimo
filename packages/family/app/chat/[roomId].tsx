import { tokens } from "@kazimo/shared";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContextMenu, hasNativeContextMenu, type MenuAction, openActionsAlert } from "../../src/ContextMenu";
import { Icon } from "../../src/Icon";
import { appStrings } from "../../src/i18n";
import {
  blurhashOf,
  CHAT_THUMBNAIL_EDGE,
  fitWithin,
  type MediaRef,
  photoUri,
  pickPhoto,
  preparePhoto,
} from "../../src/media";
import { type Conversation, conversationFor } from "../../src/session";
import { useSession } from "../../src/session-context";
import { type ChatItem, openTimeline, statusOf, type TimelineSource } from "../../src/timeline";

const t = appStrings();

const RETRY_ACTION = "retry";
const DISCARD_ACTION = "discard";
const RETRY_SYMBOL = "arrow.clockwise";
const DISCARD_SYMBOL = "trash";

const FAILED_ACTIONS: MenuAction[] = [
  { key: RETRY_ACTION, title: t.retrySend, systemImage: RETRY_SYMBOL },
  { key: DISCARD_ACTION, title: t.deleteMessage, systemImage: DISCARD_SYMBOL, destructive: true },
];

const swallowLongPress = () => {};

const READ_RECEIPT_DELAY_MS = 400;
const TYPING_THROTTLE_MS = 4000;
const NEVER_TYPED = 0;
const MINE_META_COLOR = "rgba(255, 255, 255, 0.8)";
const TICK_SIZE = 14;
const MAX_BUBBLE_WIDTH = 260;
const MAX_BUBBLE_HEIGHT = 340;
const PHOTO_TRANSITION_MS = 200;
const VIEWER_CLOSE_SIZE = 36;
const VIEWER_CLOSE_INSET = 8;
const FULL_SIZE = null;

type ViewedPhoto = MediaRef & { label: string };

const timeOf = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" });

const dayOf = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" });

const isGrouped = (list: readonly ChatItem[], index: number): boolean => {
  const current = list[index];
  const previous = index > 0 ? list[index - 1] : undefined;
  if (!current || !previous) return false;
  if (current.kind === "dayMarker" || previous.kind === "dayMarker") return false;
  return previous.mine === current.mine && previous.senderName === current.senderName;
};

const typingLabelOf = (names: readonly string[]): string | null => {
  if (names.length === 0) return null;
  return names.length === 1 ? `${names[0]} ${t.typingOne}` : `${names.length} ${t.typingMany}`;
};

const usePhotoUri = (client: ClientLike, ref: MediaRef, edge: number | null): string | null => {
  const [uri, setUri] = useState<string | null>(null);
  const { mxc, json } = ref;
  useEffect(() => {
    let cancelled = false;
    void photoUri(client, { mxc, json }, edge)
      .then((value) => {
        if (!cancelled) setUri(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, mxc, json, edge]);
  return uri;
};

export default function ChatScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, identity } = useSession();

  const source = useRef<TimelineSource | null>(null);
  const list = useRef<FlashListRef<ChatItem> | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [draft, setDraft] = useState("");
  const [hasOlder, setHasOlder] = useState(true);
  const [typists, setTypists] = useState<string[]>([]);
  const [viewed, setViewed] = useState<ViewedPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const loadingOlder = useRef(false);
  const typingSentAt = useRef(NEVER_TYPED);
  const onScreen = useRef(true);

  useEffect(
    () => () => {
      onScreen.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void conversationFor(client, roomId).then((found) => {
      if (!cancelled) setConversation(found);
    });
    return () => {
      cancelled = true;
    };
  }, [client, roomId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void openTimeline(client, roomId, identity.userId).then((opened) => {
      if (!opened) return;
      if (cancelled) {
        opened.stop();
        return;
      }
      source.current = opened;
      setItems(opened.items());
      opened.subscribe(() => setItems(opened.items()));
      opened.subscribeTyping(setTypists);
    });
    return () => {
      cancelled = true;
      source.current?.stop();
      source.current = null;
    };
  }, [client, roomId, identity.userId]);

  useEffect(() => {
    if (items === null) return;
    const timer = setTimeout(() => {
      void source.current?.markLatestRead().catch(() => {});
    }, READ_RECEIPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items]);

  useEffect(
    () => () => {
      if (typingSentAt.current !== NEVER_TYPED) void source.current?.setTyping(false).catch(() => {});
    },
    [],
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
    if (typingSentAt.current === NEVER_TYPED) return;
    typingSentAt.current = NEVER_TYPED;
    void source.current?.setTyping(false).catch(() => {});
  }, []);

  const edit = useCallback(
    (text: string) => {
      setDraft(text);
      if (!text.trim()) {
        stopTyping();
        return;
      }
      const now = Date.now();
      if (now - typingSentAt.current < TYPING_THROTTLE_MS) return;
      typingSentAt.current = now;
      void source.current?.setTyping(true).catch(() => {});
    },
    [stopTyping],
  );

  const submit = useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    stopTyping();
    void source.current?.send(body).catch(() => {});
  }, [draft, stopTyping]);

  const attach = useCallback(async () => {
    const current = source.current;
    if (!current) return;
    try {
      const picked = await pickPhoto();
      if (!picked) return;
      setUploading(true);
      const prepared = await preparePhoto(picked.uri);
      const blurhash = await blurhashOf(prepared.uri);
      await current.sendPhoto({ ...prepared, blurhash });
    } catch {
      Alert.alert(t.photoSendFailed);
    } finally {
      if (onScreen.current) setUploading(false);
    }
  }, []);

  const runFailedAction = useCallback((actionKey: string, itemId: string) => {
    const current = source.current;
    if (!current) return;
    if (actionKey === RETRY_ACTION) void current.retry(itemId).catch(() => {});
    if (actionKey === DISCARD_ACTION) void current.discard(itemId).catch(() => {});
  }, []);

  const openFailedActions = useCallback(
    (itemId: string) => {
      openActionsAlert(t.notSent, FAILED_ACTIONS, t.cancel, (key) => runFailedAction(key, itemId));
    },
    [runFailedAction],
  );

  const openPhoto = useCallback((photo: ViewedPhoto) => setViewed(photo), []);
  const closePhoto = useCallback(() => setViewed(null), []);
  const resolveSource = useCallback((mxc: string) => source.current?.mediaSourceOf(mxc) ?? null, []);

  const typingLabel = typingLabelOf(typists);

  if (!roomId || !conversation) return null;

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
          renderItem={({ item, index }) => (
            <Row
              item={item}
              grouped={isGrouped(items, index)}
              showSender={conversation.kind === "group"}
              client={client}
              resolveSource={resolveSource}
              onOpenPhoto={openPhoto}
              onFailedAction={runFailedAction}
              onOpenFailedActions={openFailedActions}
            />
          )}
        />
      )}

      {typingLabel !== null && <Text style={styles.typing}>{typingLabel}</Text>}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.attachPhoto}
          style={[styles.attach, uploading && styles.sendDisabled]}
          onPress={() => void attach()}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color={tokens.color.blueDeep} />
          ) : (
            <Icon name="attach" color={tokens.color.blueDeep} size={20} />
          )}
        </Pressable>
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

      <Modal
        visible={viewed !== null}
        presentationStyle="fullScreen"
        animationType="fade"
        onRequestClose={closePhoto}
      >
        <View style={styles.viewer}>
          <Pressable style={styles.viewerCanvas} onPress={closePhoto}>
            {viewed !== null && <FullPhoto client={client} photo={viewed} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.photoFull}
            style={[styles.viewerClose, { top: insets.top + VIEWER_CLOSE_INSET }]}
            onPress={closePhoto}
          >
            <Icon name="close" color={tokens.theme.dark.ink} size={18} />
          </Pressable>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function FullPhoto({ client, photo }: { client: ClientLike; photo: ViewedPhoto }) {
  const uri = usePhotoUri(client, photo, FULL_SIZE);
  return (
    <Image
      source={uri === null ? undefined : { uri }}
      style={styles.viewerImage}
      contentFit="contain"
      cachePolicy="memory-disk"
      transition={PHOTO_TRANSITION_MS}
      accessibilityLabel={photo.label}
    />
  );
}

function PhotoBubble({
  client,
  item,
  media,
  onOpenPhoto,
}: {
  client: ClientLike;
  item: Extract<ChatItem, { kind: "image" }>;
  media: MediaRef;
  onOpenPhoto: (photo: ViewedPhoto) => void;
}) {
  const uri = usePhotoUri(client, media, CHAT_THUMBNAIL_EDGE);
  const label = item.caption ?? t.photo;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      onPress={() => onOpenPhoto({ ...media, label })}
    >
      <Image
        source={uri === null ? undefined : { uri }}
        style={fitWithin(item.width, item.height, MAX_BUBBLE_WIDTH, MAX_BUBBLE_HEIGHT)}
        placeholder={item.blurhash === null ? undefined : { blurhash: item.blurhash }}
        cachePolicy="memory-disk"
        contentFit="cover"
        transition={PHOTO_TRANSITION_MS}
        recyclingKey={item.id}
        accessibilityLabel={label}
      />
    </Pressable>
  );
}

function Row({
  item,
  grouped,
  showSender,
  client,
  resolveSource,
  onOpenPhoto,
  onFailedAction,
  onOpenFailedActions,
}: {
  item: ChatItem;
  grouped: boolean;
  showSender: boolean;
  client: ClientLike;
  resolveSource: (mxc: string) => string | null;
  onOpenPhoto: (photo: ViewedPhoto) => void;
  onFailedAction: (actionKey: string, itemId: string) => void;
  onOpenFailedActions: (itemId: string) => void;
}) {
  if (item.kind === "dayMarker") {
    return <Text style={styles.dayMarker}>{dayOf(item.timestamp)}</Text>;
  }
  const mine = item.mine;
  const isPhoto = item.kind === "image";
  const status = statusOf(item);
  const failed = status === "failed";
  const bubble = (
    <View
      style={[
        styles.bubble,
        mine ? styles.bubbleMine : styles.bubbleTheirs,
        isPhoto && styles.bubblePhoto,
        status === "pending" && styles.bubblePending,
        failed && styles.bubbleFailed,
      ]}
    >
      {showSender && !mine && !grouped && (
        <Text style={[styles.sender, isPhoto && styles.photoInsetTop]}>{item.senderName}</Text>
      )}
      {item.kind === "text" ? (
        <Text style={[styles.bodyText, mine && styles.bodyTextMine]}>{item.body}</Text>
      ) : (
        <PhotoBubble
          client={client}
          item={item}
          media={{ mxc: item.mxc, json: resolveSource(item.mxc) }}
          onOpenPhoto={onOpenPhoto}
        />
      )}
      {item.kind === "image" && item.caption !== null && (
        <Text style={[styles.bodyText, mine && styles.bodyTextMine, styles.photoInset]}>{item.caption}</Text>
      )}
      <View style={[styles.metaRow, isPhoto && styles.photoInsetBottom]}>
        <Text style={[styles.meta, mine && styles.metaMine]}>{timeOf(item.timestamp)}</Text>
        {(status === "sent" || status === "read") && (
          <View accessibilityLabel={status === "read" ? t.read : t.sent}>
            <Icon name={status === "read" ? "read" : "sent"} color={MINE_META_COLOR} size={TICK_SIZE} />
          </View>
        )}
      </View>
    </View>
  );
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine, grouped && styles.bubbleRowGrouped]}>
      <View style={[styles.bubbleColumn, mine && styles.bubbleColumnMine]}>
        {failed ? (
          <ContextMenu
            title={t.notSent}
            actions={FAILED_ACTIONS}
            onAction={(key) => onFailedAction(key, item.id)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.notSent}
              onPress={() => onOpenFailedActions(item.id)}
              onLongPress={hasNativeContextMenu ? swallowLongPress : () => onOpenFailedActions(item.id)}
            >
              {bubble}
            </Pressable>
          </ContextMenu>
        ) : (
          bubble
        )}
        {failed && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.retrySend}
            style={styles.failedNote}
            onPress={() => onOpenFailedActions(item.id)}
          >
            <Icon name="failed" color={tokens.color.danger} size={TICK_SIZE} />
            <Text style={styles.failedText}>{t.notSent}</Text>
          </Pressable>
        )}
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
  bubbleRowGrouped: {
    marginTop: 0,
  },
  bubbleColumn: {
    maxWidth: "78%",
    alignItems: "flex-start",
    gap: 3,
  },
  bubbleColumnMine: {
    alignItems: "flex-end",
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    gap: 2,
  },
  bubbleTheirs: {
    backgroundColor: tokens.theme.light.surface,
    borderBottomLeftRadius: 6,
  },
  bubbleMine: {
    backgroundColor: tokens.color.blue,
    borderBottomRightRadius: 6,
  },
  bubblePhoto: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    overflow: "hidden",
    gap: 0,
  },
  photoInset: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  photoInsetTop: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  photoInsetBottom: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  bubblePending: {
    opacity: 0.55,
  },
  bubbleFailed: {
    borderWidth: 1,
    borderColor: tokens.color.danger,
  },
  failedNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  failedText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.danger,
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
    backgroundColor: tokens.theme.light.surface,
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
  attach: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.theme.light.surface,
  },
  viewer: {
    flex: 1,
    backgroundColor: tokens.theme.dark.ground,
  },
  viewerCanvas: {
    flex: 1,
  },
  viewerImage: {
    flex: 1,
    width: "100%",
  },
  viewerClose: {
    position: "absolute",
    right: VIEWER_CLOSE_INSET,
    width: VIEWER_CLOSE_SIZE,
    height: VIEWER_CLOSE_SIZE,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.theme.dark.inkFaint,
  },
});
