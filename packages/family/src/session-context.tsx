import { tokens } from "@kazimo/shared";
import { useRouter } from "expo-router";
import { HttpApiEvent, type MatrixClient, TokenRefreshLogoutError } from "matrix-js-sdk";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Login from "../app/login";
import {
  clearSession,
  isExpiringSoon,
  loadSession,
  refreshSession,
  signOut as revokeAndForget,
  type StoredSession,
  tokenRefresherFor,
} from "./auth";
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
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export const useSession = (): Session => {
  const value = useContext(SessionContext);
  if (!value) throw new Error("session not ready");
  return value;
};

type Credentials =
  | { kind: "stored"; session: StoredSession }
  | { kind: "env"; homeserver: string; token: string };

type Connected = {
  client: MatrixClient;
  homeserver: string;
  identity: Identity;
  stored: StoredSession | null;
};

type Phase =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "connecting"; credentials: Credentials }
  | { kind: "ready"; connected: Connected }
  | { kind: "error"; message: string };

const credentialsOf = (stored: StoredSession | null): Credentials | null => {
  if (stored) return { kind: "stored", session: stored };
  const env = readEnv();
  return env ? { kind: "env", homeserver: env.homeserver, token: env.token } : null;
};

const open = async (
  homeserver: string,
  token: string,
  stored: StoredSession | null,
  onRefresh?: (session: StoredSession) => void,
): Promise<Connected> => {
  const identity = await whoami(homeserver, token);
  const refresh =
    stored?.refreshToken && onRefresh
      ? { refreshToken: stored.refreshToken, tokenRefreshFunction: tokenRefresherFor(stored, onRefresh) }
      : undefined;
  const client = await startSession(homeserver, token, identity, refresh);
  return { client, homeserver, identity, stored };
};

const connect = async (
  credentials: Credentials,
  onRefresh: (session: StoredSession) => void,
): Promise<Connected> => {
  if (credentials.kind === "env") return open(credentials.homeserver, credentials.token, null);
  const stored = credentials.session;
  const fresh = isExpiringSoon(stored, Date.now()) ? await refreshSession(stored) : stored;
  const connected = await open(fresh.homeserver, fresh.accessToken, fresh, onRefresh).catch(async (error) => {
    if (!fresh.refreshToken) throw error;
    const refreshed = await refreshSession(fresh);
    return open(refreshed.homeserver, refreshed.accessToken, refreshed, onRefresh);
  });
  return connected;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [center, setCenter] = useState<CallCenter | null>(null);
  const dismissers = useRef(new Map<string, () => void>());
  const latestStored = useRef<StoredSession | null>(null);

  const registerCallDismiss = useCallback((roomId: string, dismiss: () => void) => {
    dismissers.current.set(roomId, dismiss);
    return () => {
      if (dismissers.current.get(roomId) === dismiss) dismissers.current.delete(roomId);
    };
  }, []);

  const rememberStored = useCallback((session: StoredSession) => {
    latestStored.current = session;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSession()
      .catch(() => null)
      .then((stored) => {
        if (cancelled) return;
        const credentials = credentialsOf(stored);
        setPhase(credentials ? { kind: "connecting", credentials } : { kind: "signedOut" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const credentials = phase.kind === "connecting" ? phase.credentials : null;

  useEffect(() => {
    if (!credentials) return;
    let cancelled = false;
    (async () => {
      try {
        const connected = await connect(credentials, rememberStored);
        if (cancelled) {
          connected.client.stopClient();
          return;
        }
        latestStored.current = connected.stored;
        setPhase({ kind: "ready", connected });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof TokenRefreshLogoutError) {
          await clearSession().catch(() => undefined);
          setPhase({ kind: "signedOut" });
          return;
        }
        setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [credentials, rememberStored]);

  const client = phase.kind === "ready" ? phase.connected.client : null;

  const signOut = useCallback(async () => {
    client?.stopClient();
    const stored = latestStored.current;
    latestStored.current = null;
    if (stored) await revokeAndForget(stored).catch(() => undefined);
    setPhase({ kind: "signedOut" });
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const onLoggedOut = () => {
      void signOut();
    };
    client.on(HttpApiEvent.SessionLoggedOut, onLoggedOut);
    return () => {
      client.off(HttpApiEvent.SessionLoggedOut, onLoggedOut);
    };
  }, [client, signOut]);

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

  if (phase.kind === "loading" || phase.kind === "connecting") return <Status label={t.syncing} spinner />;
  if (phase.kind === "signedOut") {
    return (
      <Login
        onSignedIn={(session) => setPhase({ kind: "connecting", credentials: { kind: "stored", session } })}
      />
    );
  }
  if (phase.kind === "error") return <Status label={phase.message} tone="error" />;

  return (
    <SessionContext.Provider
      value={{
        client: phase.connected.client,
        homeserver: phase.connected.homeserver,
        identity: phase.connected.identity,
        center,
        registerCallDismiss,
        signOut,
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
});
