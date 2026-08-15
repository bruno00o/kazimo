import type { A2uiNode, DaemonToKiosk } from "@kazimo/shared";
import { connectDaemon } from "./link";
import { type MicCapture, startMicCapture } from "./mic";

export function startAgent(onAssistant: (tree: A2uiNode) => void): () => void {
  let mic: string | null = null;
  let session: Promise<MicCapture | null> | null = null;
  let voice: { element: HTMLAudioElement; url: string } | null = null;

  const play = (audio: ArrayBuffer) => {
    if (voice) {
      voice.element.pause();
      URL.revokeObjectURL(voice.url);
    }
    const url = URL.createObjectURL(new Blob([audio], { type: "audio/mpeg" }));
    const element = new Audio(url);
    voice = { element, url };
    element.play().catch((error) => console.error("speech playback failed", error));
  };

  const link = connectDaemon((message: DaemonToKiosk) => {
    if (message.type === "config") mic = message.config.mic;
    else if (message.type === "assistant") onAssistant(message.tree);
  }, play);

  const begin = () => {
    if (session) return;
    link.send({ type: "capture-start" });
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
