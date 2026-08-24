import { tokens } from "@kazimo/shared";
import type { ClientLike, SyncServiceLike } from "@unomed/react-native-matrix-sdk";
import { useRouter } from "expo-router";
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
} from "./auth";
import { type CallCenter, startCallCenter } from "./calls";
import {
  assessSecurity,
  backupExistsOnServerRaw,
  clearSecurityDone,
  isRecoveryEnabled,
  isSecurityDone,
  markSecurityDone,
  SECURITY_READY,
  type Security,
} from "./e2ee";
import { readEnv } from "./env";
import { appStrings } from "./i18n";
import { type MatrixHandle, startMatrix } from "./matrix";
import { SecurityGate } from "./SecurityGate";
import { acceptInvites, endSession, type Identity, setDeviceName, whoami } from "./session";

const t = appStrings();

const LOGOUT_ERROR_NAME = "TokenRefreshLogoutError";

type Session = {
  client: ClientLike;
  sync: SyncServiceLike;
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
  handle: MatrixHandle;
  homeserver: string;
  identity: Identity;
  stored: StoredSession | null;
};

type Phase =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "connecting"; credentials: Credentials }
  | { kind: "ready"; connected: Connected; security: Security }
  | { kind: "error"; message: string };

const DEVICE_DISPLAY_NAME = "Kazimo";

const credentialsOf = (stored: StoredSession | null): Credentials | null => {
  if (stored) return { kind: "stored", session: stored };
  const env = readEnv();
  return env ? { kind: "env", homeserver: env.homeserver, token: env.token } : null;
};

const open = async (homeserver: string, token: string, stored: StoredSession | null): Promise<Connected> => {
  const identity = await whoami(homeserver, token);
  if (identity.deviceId)
    void setDeviceName(homeserver, token, identity.deviceId, DEVICE_DISPLAY_NAME).catch(() => undefined);
  const backupOnServer = await backupExistsOnServerRaw(homeserver, token).catch(() => true);
  const handle = await startMatrix(
    {
      homeserver,
      accessToken: token,
      refreshToken: stored?.refreshToken ?? undefined,
      userId: identity.userId,
      deviceId: identity.deviceId || (stored?.deviceId ?? ""),
    },
    { bootstrapIdentity: !backupOnServer },
  );
  await acceptInvites(handle.client).catch(() => undefined);
  return { handle, homeserver, identity, stored };
};

const connect = async (credentials: Credentials): Promise<Connected> => {
  if (credentials.kind === "env") return open(credentials.homeserver, credentials.token, null);
  const stored = credentials.session;
  const fresh = isExpiringSoon(stored, Date.now()) ? await refreshSession(stored) : stored;
  return open(fresh.homeserver, fresh.accessToken, fresh).catch(async (error) => {
    if (!fresh.refreshToken) throw error;
    const refreshed = await refreshSession(fresh);
    return open(refreshed.homeserver, refreshed.accessToken, refreshed);
  });
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [center, setCenter] = useState<CallCenter | null>(null);
  const [securityDismissed, setSecurityDismissed] = useState(false);
  const dismissers = useRef(new Map<string, () => void>());
  const latestStored = useRef<StoredSession | null>(null);

  const registerCallDismiss = useCallback((roomId: string, dismiss: () => void) => {
    dismissers.current.set(roomId, dismiss);
    return () => {
      if (dismissers.current.get(roomId) === dismiss) dismissers.current.delete(roomId);
    };
  }, []);

  const finishSecurity = useCallback((completed: boolean) => {
    if (completed) void markSecurityDone().catch(() => undefined);
    setSecurityDismissed(true);
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
        const connected = await connect(credentials);
        if (cancelled) {
          await endSession(connected.handle).catch(() => undefined);
          return;
        }
        const alreadyDone = await isSecurityDone().catch(() => false);
        const recovered = alreadyDone
          ? await isRecoveryEnabled(connected.handle.client).catch(() => true)
          : false;
        const security = recovered
          ? SECURITY_READY
          : await assessSecurity(connected.handle.client).catch(() => SECURITY_READY);
        if (cancelled) {
          await endSession(connected.handle).catch(() => undefined);
          return;
        }
        latestStored.current = connected.stored;
        setPhase({ kind: "ready", connected, security });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.name === LOGOUT_ERROR_NAME) {
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
  }, [credentials]);

  const handle = phase.kind === "ready" ? phase.connected.handle : null;
  const client = handle?.client ?? null;

  const signOut = useCallback(async () => {
    if (handle) await endSession(handle).catch(() => undefined);
    const stored = latestStored.current;
    latestStored.current = null;
    if (stored) await revokeAndForget(stored).catch(() => undefined);
    await clearSecurityDone().catch(() => undefined);
    setSecurityDismissed(false);
    setPhase({ kind: "signedOut" });
  }, [handle]);

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
  if (phase.security.state !== "ready" && !securityDismissed) {
    return (
      <SecurityGate client={phase.connected.handle.client} prompt={phase.security} onDone={finishSecurity} />
    );
  }

  return (
    <SessionContext.Provider
      value={{
        client: phase.connected.handle.client,
        sync: phase.connected.handle.sync,
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
