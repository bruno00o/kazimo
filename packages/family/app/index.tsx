import { tokens } from "@kazimo/shared";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { ClientEvent, RoomEvent } from "matrix-js-sdk";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appStrings } from "../src/i18n";
import { type Conversation, conversations } from "../src/session";
import { useSession } from "../src/session-context";

const t = appStrings();

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
  const [list, setList] = useState<Conversation[]>(() => conversations(client));

  useEffect(() => {
    const refresh = () => setList(conversations(client));
    client.on(ClientEvent.Sync, refresh);
    client.on(RoomEvent.Timeline, refresh);
    client.on(RoomEvent.Name, refresh);
    client.on(RoomEvent.Receipt, refresh);
    return () => {
      client.off(ClientEvent.Sync, refresh);
      client.off(RoomEvent.Timeline, refresh);
      client.off(RoomEvent.Name, refresh);
      client.off(RoomEvent.Receipt, refresh);
    };
  }, [client]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>{t.conversations}</Text>
      <FlashList
        data={list}
        keyExtractor={(conversation) => conversation.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>{t.noConversations}</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: "/chat/[roomId]", params: { roomId: item.id } })}
          >
            <View style={[styles.avatar, item.kind === "group" && styles.avatarGroup]}>
              <Text style={styles.avatarText}>{initial(item.name)}</Text>
            </View>
            <View style={styles.body}>
              <View style={styles.headline}>
                <Text style={[styles.name, item.unread > 0 && styles.nameUnread]} numberOfLines={1}>
                  {item.name}
                </Text>
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
