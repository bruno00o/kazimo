import { tokens } from "@kazimo/shared";
import { StatusBar } from "expo-status-bar";
import type { MatrixClient } from "matrix-js-sdk";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { CallView } from "./src/CallView";
import { readEnv } from "./src/env";
import { type Identity, type RoomSummary, roomSummaries, startSession, whoami } from "./src/session";

type Call = { roomId: string; title: string };

type Phase =
  | { kind: "connecting" }
  | { kind: "config" }
  | { kind: "ready"; client: MatrixClient; homeserver: string; identity: Identity; rooms: RoomSummary[] }
  | { kind: "error"; message: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [call, setCall] = useState<Call | null>(null);

  useEffect(() => {
    let cancelled = false;
    const env = readEnv();
    if (!env) {
      setPhase({ kind: "config" });
      return;
    }
    (async () => {
      try {
        const identity = await whoami(env.homeserver, env.token);
        const client = await startSession(env.homeserver, env.token, identity);
        if (cancelled) {
          client.stopClient();
          return;
        }
        setPhase({
          kind: "ready",
          client,
          homeserver: env.homeserver,
          identity,
          rooms: roomSummaries(client),
        });
      } catch (error) {
        if (!cancelled) {
          setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.kind === "ready" && call) {
    return (
      <View style={styles.call}>
        <CallView
          client={phase.client}
          homeserver={phase.homeserver}
          roomId={call.roomId}
          title={call.title}
          onLeave={() => setCall(null)}
        />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>Kazimo</Text>
      {phase.kind === "connecting" && <Status label="a sincronizar" spinner />}
      {phase.kind === "config" && <ConfigHint />}
      {phase.kind === "error" && <Status label={phase.message} tone="error" />}
      {phase.kind === "ready" && (
        <Ready
          identity={phase.identity}
          rooms={phase.rooms}
          onCall={(room) => setCall({ roomId: room.id, title: room.name })}
        />
      )}
      <StatusBar style="dark" />
    </View>
  );
}

function Status({ label, spinner, tone }: { label: string; spinner?: boolean; tone?: "error" }) {
  return (
    <View style={styles.status}>
      {spinner && <ActivityIndicator color={tokens.color.blue} />}
      <Text style={[styles.statusText, tone === "error" && styles.errorText]}>{label}</Text>
    </View>
  );
}

function ConfigHint() {
  return (
    <View style={styles.status}>
      <Text style={styles.statusText}>Falta o token.</Text>
      <Text style={styles.hint}>packages/family/.env.local</Text>
      <Text style={styles.hint}>EXPO_PUBLIC_MATRIX_TOKEN=...</Text>
    </View>
  );
}

function Ready({
  identity,
  rooms,
  onCall,
}: {
  identity: Identity;
  rooms: RoomSummary[];
  onCall: (room: RoomSummary) => void;
}) {
  return (
    <View style={styles.ready}>
      <Text style={styles.userId}>{identity.userId}</Text>
      <Text style={styles.count}>{`${rooms.length} salas`}</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {rooms.map((room) => (
          <Pressable key={room.id} style={styles.row} onPress={() => onCall(room)}>
            <Text style={styles.roomName} numberOfLines={1}>
              {room.name}
            </Text>
            <Text style={styles.roomMembers}>{room.members}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 72,
    paddingHorizontal: 24,
    backgroundColor: tokens.theme.light.ground,
  },
  call: {
    flex: 1,
    backgroundColor: tokens.theme.dark.ground,
  },
  brand: {
    fontSize: 40,
    fontWeight: "700",
    color: tokens.color.blueDeep,
  },
  status: {
    marginTop: 32,
    gap: 8,
  },
  statusText: {
    fontSize: 18,
    color: tokens.theme.light.ink,
  },
  errorText: {
    color: "#c5221f",
  },
  hint: {
    fontSize: 14,
    color: tokens.theme.light.inkSoft,
  },
  ready: {
    flex: 1,
    marginTop: 24,
  },
  userId: {
    fontSize: 16,
    color: tokens.theme.light.inkSoft,
  },
  count: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: "600",
    color: tokens.theme.light.ink,
  },
  list: {
    marginTop: 16,
  },
  listContent: {
    paddingBottom: 32,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.theme.light.inkFaint,
  },
  roomName: {
    flex: 1,
    fontSize: 18,
    color: tokens.theme.light.ink,
  },
  roomMembers: {
    marginLeft: 12,
    fontSize: 16,
    color: tokens.theme.light.inkSoft,
  },
});
