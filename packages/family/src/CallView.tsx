import { tokens } from "@kazimo/shared";
import { useConnectionState, useTracks } from "@livekit/components-react";
import { AudioSession, LiveKitRoom, VideoTrack } from "@livekit/react-native";
import { ConnectionState, Track } from "livekit-client";
import type { MatrixClient } from "matrix-js-sdk";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import {
  joinRtc,
  leaveRtc,
  type RtcSession,
  rtcFocusUrl,
  type SfuClaims,
  type SfuToken,
  sfuClaims,
  sfuToken,
} from "./call";

type Load = { kind: "loading" } | { kind: "ready"; token: SfuToken } | { kind: "error"; message: string };

const stateLabel: Record<ConnectionState, string> = {
  [ConnectionState.Disconnected]: "desligado",
  [ConnectionState.Connecting]: "a ligar",
  [ConnectionState.Connected]: "ligado",
  [ConnectionState.Reconnecting]: "a reconectar",
  [ConnectionState.SignalReconnecting]: "a reconectar",
};

export function CallView({
  client,
  homeserver,
  roomId,
  title,
  onLeave,
}: {
  client: MatrixClient;
  homeserver: string;
  roomId: string;
  title: string;
  onLeave: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const session = useRef<RtcSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AudioSession.startAudioSession();
    (async () => {
      try {
        const serviceUrl = await rtcFocusUrl(homeserver);
        const token = await sfuToken(serviceUrl, client, roomId);
        if (cancelled) return;
        session.current = joinRtc(client, roomId, serviceUrl);
        setLoad({ kind: "ready", token });
      } catch (error) {
        if (!cancelled) {
          setLoad({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (session.current) {
        void leaveRtc(session.current);
        session.current = null;
      }
      void AudioSession.stopAudioSession();
    };
  }, [client, homeserver, roomId]);

  if (load.kind === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.color.blueSoft} />
        <Text style={styles.note}>a preparar a chamada</Text>
        <Leave onLeave={onLeave} />
      </View>
    );
  }

  if (load.kind === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{load.message}</Text>
        <Leave onLeave={onLeave} />
      </View>
    );
  }

  return (
    <LiveKitRoom serverUrl={load.token.url} token={load.token.jwt} connect audio video>
      <Stage title={title} claims={sfuClaims(load.token.jwt)} onLeave={onLeave} />
    </LiveKitRoom>
  );
}

function Stage({ title, claims, onLeave }: { title: string; claims: SfuClaims | null; onLeave: () => void }) {
  const state = useConnectionState();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remote = tracks.filter((track) => !track.participant.isLocal);

  return (
    <View style={styles.stage}>
      <View style={styles.tiles}>
        {tracks.map((track) => (
          <VideoTrack
            key={`${track.participant.identity}:${track.source}`}
            trackRef={track}
            style={styles.tile}
          />
        ))}
        {tracks.length === 0 && <Text style={styles.placeholder}>à espera de vídeo</Text>}
      </View>
      <View style={styles.hud}>
        <Text style={styles.state}>{stateLabel[state]}</Text>
        <Text style={styles.meta}>{title}</Text>
        <Text style={styles.meta}>{`${remote.length} remotos`}</Text>
        {claims && <Text style={styles.meta}>{`sfu ${claims.room}`}</Text>}
      </View>
      <Leave onLeave={onLeave} />
    </View>
  );
}

function Leave({ onLeave }: { onLeave: () => void }) {
  return (
    <Pressable style={styles.leave} onPress={onLeave}>
      <Text style={styles.leaveText}>Terminar</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    backgroundColor: tokens.theme.dark.ground,
  },
  stage: {
    flex: 1,
    backgroundColor: tokens.theme.dark.ground,
  },
  tiles: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
  },
  tile: {
    flex: 1,
    minWidth: 160,
    aspectRatio: 3 / 4,
    margin: 6,
    borderRadius: 18,
    backgroundColor: "#000000",
  },
  placeholder: {
    fontSize: 16,
    color: tokens.theme.dark.inkFaint,
  },
  hud: {
    position: "absolute",
    top: 72,
    left: 24,
    gap: 4,
  },
  state: {
    fontSize: 28,
    fontWeight: "600",
    color: tokens.theme.dark.ink,
  },
  meta: {
    fontSize: 14,
    color: tokens.theme.dark.inkSoft,
  },
  note: {
    fontSize: 16,
    color: tokens.theme.dark.inkSoft,
  },
  error: {
    fontSize: 16,
    color: "#f28b82",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  leave: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: "#d93025",
  },
  leaveText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
  },
});
