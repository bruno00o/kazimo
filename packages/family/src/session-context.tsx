import { tokens } from "@kazimo/shared";
import { useRouter } from "expo-router";
import type { MatrixClient } from "matrix-js-sdk";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { type CallCenter, startCallCenter } from "./calls";
import { readEnv } from "./env";
import { appStrings } from "./i18n";
import { type Identity, startSession, whoami } from "./session";

const t = appStrings();

type Session = {
  client: MatrixClient;
  homeserver: string;
  identity: Identity;
  center: CallCenter | null;
  registerCallDismiss: (roomId: string, dismiss: () => void) => () => void;
};

const SessionContext = createContext<Session | null>(null);

export const useSession = (): Session => {
  const value = useContext(SessionContext);
  if (!value) throw new Error("session not ready");
  return value;
};

type Phase =
  | { kind: "connecting" }
  | { kind: "config" }
  | { kind: "ready"; client: MatrixClient; homeserver: string; identity: Identity }
  | { kind: "error"; message: string };

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [center, setCenter] = useState<CallCenter | null>(null);
  const dismissers = useRef(new Map<string, () => void>());

  const registerCallDismiss = useCallback((roomId: string, dismiss: () => void) => {
    dismissers.current.set(roomId, dismiss);
    return () => {
      if (dismissers.current.get(roomId) === dismiss) dismissers.current.delete(roomId);
    };
  }, []);

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
        setPhase({ kind: "ready", client, homeserver: env.homeserver, identity });
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

  const client = phase.kind === "ready" ? phase.client : null;

  useEffect(() => {
    if (!client) return;
    let started: CallCenter | null = null;
    let cancelled = false;
    void startCallCenter(
      client,
      {
        onAnswer: (incoming) =>
          router.push({ pathname: "/call/[roomId]", params: { roomId: incoming.roomId } }),
        onRemoteEnd: (roomId) => dismissers.current.get(roomId)?.(),
      },
      t,
    ).then((instance) => {
      if (cancelled) {
        instance.stop();
        return;
      }
      started = instance;
      setCenter(instance);
    });
    return () => {
      cancelled = true;
      started?.stop();
      setCenter(null);
    };
  }, [client, router]);

  if (phase.kind === "connecting") return <Status label={t.syncing} spinner />;
  if (phase.kind === "config") return <ConfigHint />;
  if (phase.kind === "error") return <Status label={phase.message} tone="error" />;

  return (
    <SessionContext.Provider
      value={{
        client: phase.client,
        homeserver: phase.homeserver,
        identity: phase.identity,
        center,
        registerCallDismiss,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

function Status({ label, spinner, tone }: { label: string; spinner?: boolean; tone?: "error" }) {
  return (
    <View style={styles.center}>
      {spinner && <ActivityIndicator color={tokens.color.blue} />}
      <Text style={[styles.statusText, tone === "error" && styles.errorText]}>{label}</Text>
    </View>
  );
}

function ConfigHint() {
  return (
    <View style={styles.center}>
      <Text style={styles.statusText}>{t.tokenMissing}</Text>
      <Text style={styles.hint}>packages/family/.env.local</Text>
      <Text style={styles.hint}>EXPO_PUBLIC_MATRIX_TOKEN=...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    backgroundColor: tokens.theme.light.ground,
  },
  statusText: {
    fontSize: 18,
    color: tokens.theme.light.ink,
    textAlign: "center",
  },
  errorText: {
    color: tokens.color.danger,
  },
  hint: {
    fontSize: 14,
    color: tokens.theme.light.inkSoft,
  },
});
