import type { A2uiNode, ActivitySummary, DaemonToKiosk } from "@kazimo/shared";
import { connectDaemon } from "./link";
import { type MicCapture, startMicCapture } from "./mic";
import { playWake } from "./sounds";

export interface AgentCallbacks {
  onAssistant: (tree: A2uiNode) => void;
  onAnswerCall: () => void;
  onActivityClear: (what: "unread" | "missed") => void;
}

export interface AgentHandle {
  stop: () => void;
  sendActivity: (activity: ActivitySummary) => void;
  setCallActive: (active: boolean) => void;
}

export function startAgent(callbacks: AgentCallbacks): AgentHandle {
  let mic: string | null = null;
  let session: Promise<MicCapture | null> | null = null;
  let voice: { element: HTMLAudioElement; url: string } | null = null;
  let voicePlaying = false;
  let callActive = false;
  let suppressed = false;
  let lastActivity: ActivitySummary | null = null;

  const updateSuppression = () => {
    const next = voicePlaying || callActive;
    if (suppressed === next) return;
    suppressed = next;
    link.send({ type: next ? "playback-start" : "playback-end" });
  };

  const setVoicePlaying = (playing: boolean) => {
    voicePlaying = playing;
    updateSuppression();
  };

  const play = (audio: ArrayBuffer) => {
    if (voice) {
      voice.element.pause();
      URL.revokeObjectURL(voice.url);
      setVoicePlaying(false);
    }
    const url = URL.createObjectURL(new Blob([audio], { type: "audio/mpeg" }));
    const element = new Audio(url);
    voice = { element, url };
    element.onplay = () => setVoicePlaying(true);
    element.onended = () => setVoicePlaying(false);
    element.onerror = () => setVoicePlaying(false);
    element.play().catch((error) => {
      console.error("speech playback failed", error);
      setVoicePlaying(false);
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
      if (lastActivity) link.send({ type: "activity", activity: lastActivity });
    } else if (message.type === "assistant") callbacks.onAssistant(message.tree);
    else if (message.type === "wake") playWake();
    else if (message.type === "answer-call") callbacks.onAnswerCall();
    else if (message.type === "activity-clear") callbacks.onActivityClear(message.what);
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

  return {
    stop() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      void session?.then((capture) => capture?.stop());
      session = null;
      link.stop();
    },
    sendActivity(activity) {
      lastActivity = activity;
      link.send({ type: "activity", activity });
    },
    setCallActive(active) {
      callActive = active;
      updateSuppression();
    },
  };
}
