import { RNE2EEManager, type RNKeyProvider } from "@livekit/react-native";
import {
  RTCFrameCryptorFactory,
  RTCKeyDerivationAlgorithm,
  type RTCKeyProvider,
} from "@livekit/react-native-webrtc";
import type { BaseE2EEManager, Room, RoomOptions } from "livekit-client";
import { RoomEvent } from "livekit-client";
import type { MediaSession } from "./call-keys";

const RATCHET_SALT = "LKFrameEncryptionKey";
const RATCHET_WINDOW_SIZE = 10;
const KEY_RING_SIZE = 256;
const FAILURE_TOLERANCE = -1;

const LOG = "[e2ee]";

class MediaKeyProvider {
  private readonly native: RTCKeyProvider;
  private readonly latestIndex = new Map<string, number>();

  constructor() {
    this.native = RTCFrameCryptorFactory.createDefaultKeyProvider({
      sharedKey: false,
      ratchetSalt: RATCHET_SALT,
      ratchetWindowSize: RATCHET_WINDOW_SIZE,
      failureTolerance: FAILURE_TOLERANCE,
      keyRingSize: KEY_RING_SIZE,
      discardFrameWhenCryptorNotReady: false,
      keyDerivationAlgorithm: RTCKeyDerivationAlgorithm.HKDF,
    });
  }

  get rtcKeyProvider(): RTCKeyProvider {
    return this.native;
  }

  getLatestKeyIndex(participantId: string): number {
    return this.latestIndex.get(participantId) ?? 0;
  }

  async setKey(participantId: string, key: Uint8Array, keyIndex: number): Promise<void> {
    this.latestIndex.set(participantId, keyIndex);
    await this.native.setKey(participantId, key, keyIndex);
  }

  async setSifTrailer(trailer: Uint8Array): Promise<void> {
    await this.native.setSifTrailer(trailer);
  }

  async dispose(): Promise<void> {
    await this.native.dispose();
  }
}

export type MediaEncryption = {
  roomOptions: RoomOptions;
  sessionFor: (room: Room) => MediaSession;
  dispose: () => void;
};

export const createMediaEncryption = (): MediaEncryption => {
  const keyProvider = new MediaKeyProvider();
  const e2eeManager: BaseE2EEManager = new RNE2EEManager(keyProvider as unknown as RNKeyProvider, false);

  return {
    roomOptions: { e2ee: { e2eeManager } },
    sessionFor: (room) => ({
      localIdentity: () => room.localParticipant.identity,
      remoteIdentities: () => [...room.remoteParticipants.keys()],
      watchRemotes: (onJoin) => {
        const handler = (participant: { identity: string }) => onJoin(participant.identity);
        room.on(RoomEvent.ParticipantConnected, handler);
        return () => {
          room.off(RoomEvent.ParticipantConnected, handler);
        };
      },
      applyKey: (identity, key, index) => keyProvider.setKey(identity, key, index),
      encryptOutgoing: () => room.setE2EEEnabled(true),
    }),
    dispose: () => {
      void keyProvider.dispose().catch((error) => console.log(`${LOG} key provider dispose failed`, error));
    },
  };
};
