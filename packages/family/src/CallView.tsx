import { tokens } from "@kazimo/shared";
import type { TrackReference } from "@livekit/components-react";
import {
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useSpeakingParticipants,
  useTracks,
} from "@livekit/components-react";
import type { AppleAudioCategoryOption, AppleAudioConfiguration } from "@livekit/react-native";
import { AudioSession, LiveKitRoom, VideoTrack } from "@livekit/react-native";
import type { ClientLike } from "@unomed/react-native-matrix-sdk";
import { ConnectionState, type Participant, Room, Track } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { joinRtc, leaveRtc, rtcFocusUrl, type SfuToken, sfuToken } from "./call";
import { CALL_AUDIO_SESSION } from "./call-audio";
import { GRID_GAP, gridFor, visibleRemoteCount } from "./callLayout";
import { Icon, type IconName } from "./Icon";
import type { Strings } from "./i18n";

type Load = { kind: "loading" } | { kind: "ready"; token: SfuToken } | { kind: "error"; message: string };

type VideoInputDevice = MediaDeviceInfo & { facing?: string };

const CONTROL_ICON_SIZE = 26;
const HANG_UP_ICON_SIZE = 28;
const FRONT_FACING = "front";
const IOS_SPEAKER_OUTPUT = "force_speaker";
const IOS_ROUTED_OUTPUT = "default";
const SPEAKER_CATEGORY_OPTION: AppleAudioCategoryOption = "defaultToSpeaker";
const SPEAKER_CATEGORY_OPTIONS = CALL_AUDIO_SESSION.audioCategoryOptions ?? [];
const ROUTED_CATEGORY_OPTIONS = SPEAKER_CATEGORY_OPTIONS.filter(
  (option) => option !== SPEAKER_CATEGORY_OPTION,
);

const stateLabel = (strings: Strings): Record<ConnectionState, string> => ({
  [ConnectionState.Disconnected]: strings.stateDisconnected,
  [ConnectionState.Connecting]: strings.stateConnecting,
  [ConnectionState.Connected]: strings.stateConnected,
  [ConnectionState.Reconnecting]: strings.stateReconnecting,
  [ConnectionState.SignalReconnecting]: strings.stateReconnecting,
});

const appleAudioConfiguration = (speakerOn: boolean): AppleAudioConfiguration => ({
  ...CALL_AUDIO_SESSION,
  audioCategoryOptions: speakerOn ? SPEAKER_CATEGORY_OPTIONS : ROUTED_CATEGORY_OPTIONS,
});

const applyAudioRoute = async (speakerOn: boolean): Promise<void> => {
  if (Platform.OS !== "ios") return;
  await AudioSession.setAppleAudioConfiguration(appleAudioConfiguration(speakerOn));
  await AudioSession.selectAudioOutput(speakerOn ? IOS_SPEAKER_OUTPUT : IOS_ROUTED_OUTPUT);
};

const startCallAudio = async (speakerOn: boolean): Promise<void> => {
  await AudioSession.startAudioSession();
  await applyAudioRoute(speakerOn);
};

const activeVideoDevice = (
  devices: VideoInputDevice[],
  selectedDeviceId: string | undefined,
): VideoInputDevice | undefined =>
  devices.find((device) => device.deviceId === selectedDeviceId) ??
  devices.find((device) => device.facing === FRONT_FACING) ??
  devices[0];

const nextVideoDevice = (
  devices: VideoInputDevice[],
  selectedDeviceId: string | undefined,
): VideoInputDevice | undefined => {
  const active = activeVideoDevice(devices, selectedDeviceId);
  if (!active) return undefined;
  const opposite = active.facing
    ? devices.find((device) => device.facing !== undefined && device.facing !== active.facing)
    : undefined;
  return opposite ?? devices.find((device) => device.deviceId !== active.deviceId);
};

const participantName = (participant: Participant): string => participant.name || participant.identity;

export function CallView({
  client,
  homeserver,
  roomId,
  title,
  strings,
  initialVideo,
  onLeave,
}: {
  client: ClientLike;
  homeserver: string;
  roomId: string;
  title: string;
  strings: Strings;
  initialVideo: boolean;
  onLeave: () => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const published = useRef(false);
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    void startCallAudio(initialVideo).catch(() => {});
    return () => {
      void AudioSession.stopAudioSession().catch(() => {});
    };
  }, [initialVideo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const serviceUrl = await rtcFocusUrl(homeserver);
        const token = await sfuToken(serviceUrl, clientRef.current, roomId);
        if (cancelled) return;
        published.current = true;
        await joinRtc(clientRef.current, roomId, serviceUrl);
        if (cancelled) return;
        setLoad({ kind: "ready", token });
      } catch (error) {
        if (!cancelled) {
          setLoad({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (published.current) {
        published.current = false;
        void leaveRtc(clientRef.current, roomId).catch(() => {});
      }
    };
  }, [homeserver, roomId]);

  if (load.kind === "loading") {
    return (
      <View style={styles.center}>
        <Text style={styles.centerName}>{title}</Text>
        <ActivityIndicator color={tokens.color.blueSoft} />
        <Text style={styles.centerNote}>{strings.preparingCall}</Text>
        <View style={styles.controlBar}>
          <HangUp label={strings.hangUp} onLeave={onLeave} />
        </View>
      </View>
    );
  }

  if (load.kind === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{load.message}</Text>
        <View style={styles.controlBar}>
          <HangUp label={strings.hangUp} onLeave={onLeave} />
        </View>
      </View>
    );
  }

  return (
    <LiveKitRoom serverUrl={load.token.url} token={load.token.jwt} connect audio video={initialVideo}>
      <Stage title={title} strings={strings} initialVideo={initialVideo} onLeave={onLeave} />
    </LiveKitRoom>
  );
}

function Stage({
  title,
  strings,
  initialVideo,
  onLeave,
}: {
  title: string;
  strings: Strings;
  initialVideo: boolean;
  onLeave: () => void;
}) {
  const state = useConnectionState();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const { width, height } = useWindowDimensions();
  const remote = tracks.find((track) => !track.participant.isLocal && !track.publication.isMuted);
  const local = tracks.find((track) => track.participant.isLocal);
  const connected = state === ConnectionState.Connected;

  const remotes = useMemo(() => participants.filter((participant) => !participant.isLocal), [participants]);
  const grouped = remotes.length > 1;
  const tiles = useMemo(() => {
    if (!grouped) return [];
    return [...remotes.slice(0, visibleRemoteCount(remotes.length)), localParticipant];
  }, [grouped, remotes, localParticipant]);
  const grid = gridFor(tiles.length, width, height);
  const speakingIdentities = useMemo(
    () => new Set(speaking.map((participant) => participant.identity)),
    [speaking],
  );
  const cameraTrack = useCallback(
    (participant: Participant): TrackReference | undefined =>
      tracks.find(
        (track) => track.participant.identity === participant.identity && !track.publication.isMuted,
      ),
    [tracks],
  );

  const [speakerOn, setSpeakerOn] = useState(initialVideo);
  const [videoDevices, setVideoDevices] = useState<VideoInputDevice[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string | undefined>(undefined);
  const switchingCamera = useRef(false);

  useEffect(() => {
    if (!isCameraEnabled) return;
    let cancelled = false;
    const listDevices = async () => {
      const devices = (await Room.getLocalDevices("videoinput", false)) as VideoInputDevice[];
      if (!cancelled) setVideoDevices(devices);
    };
    void listDevices().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isCameraEnabled]);

  const toggleMicrophone = useCallback(() => {
    void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {});
  }, [localParticipant, isMicrophoneEnabled]);

  const toggleCamera = useCallback(() => {
    void localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {});
  }, [localParticipant, isCameraEnabled]);

  const flipCamera = useCallback(() => {
    if (switchingCamera.current) return;
    const next = nextVideoDevice(videoDevices, selectedVideoDeviceId);
    if (!next) return;
    switchingCamera.current = true;
    void room
      .switchActiveDevice("videoinput", next.deviceId)
      .then(() => setSelectedVideoDeviceId(next.deviceId))
      .catch(() => {})
      .finally(() => {
        switchingCamera.current = false;
      });
  }, [room, videoDevices, selectedVideoDeviceId]);

  const toggleSpeaker = useCallback(() => {
    const next = !speakerOn;
    setSpeakerOn(next);
    void applyAudioRoute(next).catch(() => {});
  }, [speakerOn]);

  return (
    <View style={styles.stage}>
      {grouped ? (
        <View style={styles.grid}>
          {tiles.map((participant) => (
            <Tile
              key={participant.identity}
              name={participantName(participant)}
              trackRef={cameraTrack(participant)}
              mirror={participant.isLocal}
              speaking={speakingIdentities.has(participant.identity)}
              width={grid.tileWidth}
              height={grid.tileHeight}
            />
          ))}
        </View>
      ) : remote ? (
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

      {!grouped && isCameraEnabled && local && (
        <View style={styles.self}>
          <VideoTrack trackRef={local} objectFit="cover" mirror zOrder={1} style={styles.selfVideo} />
        </View>
      )}

      <View style={styles.controlBar}>
        <Control
          label={isMicrophoneEnabled ? strings.micOff : strings.micOn}
          name={isMicrophoneEnabled ? "mic" : "micOff"}
          filled={!isMicrophoneEnabled}
          onPress={toggleMicrophone}
        />
        <Control
          label={isCameraEnabled ? strings.cameraOff : strings.cameraOn}
          name={isCameraEnabled ? "camera" : "cameraOff"}
          filled={!isCameraEnabled}
          onPress={toggleCamera}
        />
        {isCameraEnabled && videoDevices.length > 1 && (
          <Control label={strings.flipCamera} name="flipCamera" filled={false} onPress={flipCamera} />
        )}
        {Platform.OS === "ios" && (
          <Control label={strings.speaker} name="speaker" filled={speakerOn} onPress={toggleSpeaker} />
        )}
        <HangUp label={strings.hangUp} onLeave={onLeave} />
      </View>
    </View>
  );
}

function Tile({
  name,
  trackRef,
  mirror,
  speaking,
  width,
  height,
}: {
  name: string;
  trackRef: TrackReference | undefined;
  mirror: boolean;
  speaking: boolean;
  width: number;
  height: number;
}) {
  return (
    <View style={[styles.tile, { width, height }, speaking && styles.tileSpeaking]}>
      {trackRef ? (
        <>
          <VideoTrack trackRef={trackRef} objectFit="cover" mirror={mirror} style={styles.tileVideo} />
          <View style={styles.tileLabel}>
            <Text numberOfLines={1} style={styles.tileLabelText}>
              {name}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.tileQuiet}>
          <Text numberOfLines={2} style={styles.tileQuietName}>
            {name}
          </Text>
        </View>
      )}
    </View>
  );
}

function Control({
  label,
  name,
  filled,
  onPress,
}: {
  label: string;
  name: IconName;
  filled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.control, filled ? styles.controlFilled : styles.controlTranslucent]}
      onPress={onPress}
    >
      <Icon name={name} color={filled ? tokens.theme.dark.ground : "#ffffff"} size={CONTROL_ICON_SIZE} />
    </Pressable>
  );
}

function HangUp({ label, onLeave }: { label: string; onLeave: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.hangUp} onPress={onLeave}>
      <Icon name="hangUp" color="#ffffff" size={HANG_UP_ICON_SIZE} />
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
  grid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "center",
    justifyContent: "center",
    gap: GRID_GAP,
    padding: GRID_GAP,
  },
  tile: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#000000",
    borderWidth: 2,
    borderColor: "transparent",
  },
  tileSpeaking: {
    borderColor: tokens.color.blue,
  },
  tileVideo: {
    flex: 1,
  },
  tileLabel: {
    position: "absolute",
    bottom: 8,
    left: 8,
    maxWidth: "80%",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  tileLabelText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#ffffff",
  },
  tileQuiet: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: tokens.theme.dark.ground,
  },
  tileQuietName: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    color: tokens.theme.dark.ink,
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
  controlBar: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  control: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  controlTranslucent: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  controlFilled: {
    backgroundColor: "#ffffff",
  },
  hangUp: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.danger,
  },
});
