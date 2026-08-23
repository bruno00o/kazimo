import { tokens } from "@kazimo/shared";
import { useRouter } from "expo-router";
import { ClientEvent, RoomEvent } from "matrix-js-sdk";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appStrings } from "../src/i18n";
import { type RoomSummary, roomSummaries } from "../src/session";
import { useSession } from "../src/session-context";

const t = appStrings();

const initial = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export default function Home() {
  const { client } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rooms, setRooms] = useState<RoomSummary[]>(() => roomSummaries(client));

  useEffect(() => {
    const refresh = () => setRooms(roomSummaries(client));
    client.on(ClientEvent.Sync, refresh);
    client.on(RoomEvent.Name, refresh);
    return () => {
      client.off(ClientEvent.Sync, refresh);
      client.off(RoomEvent.Name, refresh);
    };
  }, [client]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 20 }]}>
      <Text style={styles.brand}>Kazimo</Text>
      <Text style={styles.count}>{`${rooms.length} ${t.rooms}`}</Text>
      <FlatList
        data={rooms}
        keyExtractor={(room) => room.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: "/call/[roomId]", params: { roomId: item.id } })}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial(item.name)}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: tokens.theme.light.ground,
  },
  brand: {
    fontSize: 40,
    fontWeight: "700",
    color: tokens.color.blueDeep,
  },
  count: {
    marginTop: 2,
    fontSize: 16,
    color: tokens.theme.light.inkSoft,
  },
  list: {
    paddingTop: 20,
    paddingBottom: 32,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.blueSoft,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: "600",
    color: tokens.color.blueDeep,
  },
  name: {
    flex: 1,
    fontSize: 20,
    color: tokens.theme.light.ink,
  },
});
