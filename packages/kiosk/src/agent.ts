import type { A2uiNode, DaemonToKiosk } from "@kazimo/shared";
import { connectDaemon } from "./link";
import { type MicCapture, startMicCapture } from "./mic";
import { playWake } from "./sounds";

export function startAgent(onAssistant: (tree: A2uiNode) => void): () => void {
  let mic: string | null = null;
  let session: Promise<MicCapture | null> | null = null;
  let voice: { element: HTMLAudioElement; url: string } | null = null;
  let playing = false;

  const signalPlayback = (started: boolean) => {
    if (playing === started) return;
    playing = started;
    link.send({ type: started ? "playback-start" : "playback-end" });
  };

  const play = (audio: ArrayBuffer) => {
    if (voice) {
      voice.element.pause();
      URL.revokeObjectURL(voice.url);
      signalPlayback(false);
    }
    const url = URL.createObjectURL(new Blob([audio], { type: "audio/mpeg" }));
    const element = new Audio(url);
    voice = { element, url };
    element.onplay = () => signalPlayback(true);
    element.onended = () => signalPlayback(false);
    element.onerror = () => signalPlayback(false);
    element.play().catch((error) => {
      console.error("speech playback failed", error);
      signalPlayback(false);
    });
  };

  const startMic = () => {
    if (session) return;
    session = startMicCapture(mic, (frame) => link.sendAudio(frame)).catch((error) => {
      console.error("mic capture failed", error);
      session = null;
      return null;
    });
  };

  const link = connectDaemon((message: DaemonToKiosk) => {
    if (message.type === "config") {
      mic = message.config.mic;
      startMic();
    } else if (message.type === "assistant") onAssistant(message.tree);
    else if (message.type === "wake") playWake();
  }, play);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Space" || event.repeat) return;
    event.preventDefault();
    link.send({ type: "capture-start" });
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "Space") link.send({ type: "capture-end" });
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    void session?.then((capture) => capture?.stop());
    session = null;
    link.stop();
  };
}
