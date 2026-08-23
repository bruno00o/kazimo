import { tokens } from "@kazimo/shared";
import { useConnectionState, useTracks } from "@livekit/components-react";
import { AudioSession, LiveKitRoom, VideoTrack } from "@livekit/react-native";
import { ConnectionState, Track } from "livekit-client";
import { PhoneOff } from "lucide-react-native";
import type { MatrixClient } from "matrix-js-sdk";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { joinRtc, leaveRtc, type RtcSession, rtcFocusUrl, type SfuToken, sfuToken } from "./call";
import { Icon } from "./Icon";
import type { Strings } from "./i18n";

type Load = { kind: "loading" } | { kind: "ready"; token: SfuToken } | { kind: "error"; message: string };

const stateLabel = (strings: Strings): Record<ConnectionState, string> => ({
  [ConnectionState.Disconnected]: strings.stateDisconnected,
  [ConnectionState.Connecting]: strings.stateConnecting,
  [ConnectionState.Connected]: strings.stateConnected,
  [ConnectionState.Reconnecting]: strings.stateReconnecting,
  [ConnectionState.SignalReconnecting]: strings.stateReconnecting,
});

export function CallView({
  client,
  homeserver,
  roomId,
  title,
  strings,
  onLeave,
}: {
  client: MatrixClient;
  homeserver: string;
  roomId: string;
  title: string;
  strings: Strings;
  onLeave: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const session = useRef<RtcSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AudioSession.startAudioSession().catch(() => {});
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
      void AudioSession.stopAudioSession().catch(() => {});
    };
  }, [client, homeserver, roomId]);

  if (load.kind === "loading") {
    return (
      <View style={styles.center}>
        <Text style={styles.centerName}>{title}</Text>
        <ActivityIndicator color={tokens.color.blueSoft} />
        <Text style={styles.centerNote}>{strings.preparingCall}</Text>
        <HangUp label={strings.hangUp} onLeave={onLeave} />
      </View>
    );
  }

  if (load.kind === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{load.message}</Text>
        <HangUp label={strings.hangUp} onLeave={onLeave} />
      </View>
    );
  }

  return (
    <LiveKitRoom serverUrl={load.token.url} token={load.token.jwt} connect audio video>
      <Stage title={title} strings={strings} onLeave={onLeave} />
    </LiveKitRoom>
  );
}

function Stage({ title, strings, onLeave }: { title: string; strings: Strings; onLeave: () => void }) {
  const state = useConnectionState();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const remote = tracks.find((track) => !track.participant.isLocal);
  const local = tracks.find((track) => track.participant.isLocal);
  const connected = state === ConnectionState.Connected;

  return (
    <View style={styles.stage}>
      {remote ? (
        <VideoTrack trackRef={remote} objectFit="cover" style={styles.remote} />
      ) : (
        <View style={styles.waiting}>
          <Text style={styles.waitingState}>{strings.waitingVideo}</Text>
        </View>
      )}

      <View pointerEvents="none" style={styles.topBar}>
        <Text style={styles.name}>{title}</Text>
        {!connected && <Text style={styles.stateText}>{stateLabel(strings)[state]}</Text>}
      </View>

      {local && (
        <View style={styles.self}>
          <VideoTrack trackRef={local} objectFit="cover" mirror zOrder={1} style={styles.selfVideo} />
        </View>
      )}

      <HangUp label={strings.hangUp} onLeave={onLeave} />
    </View>
  );
}

function HangUp({ label, onLeave }: { label: string; onLeave: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.hangUp} onPress={onLeave}>
      <Icon glyph={PhoneOff} color="#ffffff" size={32} />
    </Pressable>
  );
}

const shadow = {
  textShadowColor: "rgba(0, 0, 0, 0.5)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: tokens.theme.dark.ground,
  },
  centerName: {
    fontSize: 30,
    fontWeight: "600",
    color: tokens.theme.dark.ink,
  },
  centerNote: {
    fontSize: 16,
    color: tokens.theme.dark.inkSoft,
  },
  error: {
    fontSize: 16,
    color: tokens.color.dangerSoft,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  stage: {
    flex: 1,
    backgroundColor: tokens.theme.dark.ground,
  },
  remote: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  waiting: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  waitingState: {
    fontSize: 16,
    color: tokens.theme.dark.inkFaint,
  },
  topBar: {
    position: "absolute",
    top: 64,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 2,
  },
  name: {
    fontSize: 24,
    fontWeight: "600",
    color: "#ffffff",
    ...shadow,
  },
  stateText: {
    fontSize: 15,
    color: "rgba(255, 255, 255, 0.85)",
    ...shadow,
  },
  self: {
    position: "absolute",
    bottom: 140,
    right: 20,
    width: 108,
    height: 150,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#000000",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.theme.dark.inkFaint,
  },
  selfVideo: {
    flex: 1,
  },
  hangUp: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    width: 76,
    height: 76,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.danger,
  },
});
