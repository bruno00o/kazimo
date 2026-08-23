import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { CallView } from "../../src/CallView";
import { appStrings } from "../../src/i18n";
import { useSession } from "../../src/session-context";

const t = appStrings();

export default function CallScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const { client, homeserver, center, registerCallDismiss } = useSession();

  useEffect(() => {
    if (!roomId) return;
    return registerCallDismiss(roomId, () => router.back());
  }, [roomId, registerCallDismiss, router]);

  if (!roomId) return null;

  return (
    <>
      <CallView
        client={client}
        homeserver={homeserver}
        roomId={roomId}
        title={client.getRoom(roomId)?.name ?? ""}
        strings={t}
        onLeave={() => {
          center?.hangup(roomId);
          router.back();
        }}
      />
      <StatusBar style="light" />
    </>
  );
}
