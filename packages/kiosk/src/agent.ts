import { CAPTURE_SAMPLE_RATE, type DaemonToKiosk } from "@kazimo/shared";
import { connectDaemon } from "./link";
import { type MicCapture, startMicCapture } from "./mic";

export function startAgent(): () => void {
  let mic: string | null = null;
  let session: Promise<MicCapture | null> | null = null;

  const link = connectDaemon((message: DaemonToKiosk) => {
    if (message.type === "config") mic = message.config.mic;
    if (message.type === "captured") {
      console.log(`capture received by daemon: ${message.seconds.toFixed(1)}s`);
    }
  });

  const begin = () => {
    if (session) return;
    link.send({ type: "capture-start", sampleRate: CAPTURE_SAMPLE_RATE });
    session = startMicCapture(mic, (frame) => link.sendAudio(frame)).catch((error) => {
      console.error("mic capture failed", error);
      return null;
    });
  };

  const end = () => {
    if (!session) return;
    const current = session;
    session = null;
    void current.then((capture) => {
      capture?.stop();
      link.send({ type: "capture-end" });
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Space" || event.repeat) return;
    event.preventDefault();
    begin();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space") end();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    end();
    link.stop();
  };
}
