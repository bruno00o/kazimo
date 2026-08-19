import type {
  A2uiNode,
  ActivitySummary,
  Announcement,
  Contact,
  DaemonToKiosk,
  HistoryMessage,
  PhotosResult,
  WeatherSummary,
} from "@kazimo/shared";
import { connectDaemon } from "./link";
import { type MicCapture, startMicCapture } from "./mic";
import { playWake } from "./sounds";

export interface AgentCallbacks {
  onAssistant: (tree: A2uiNode | null) => void;
  onWeather: (weather: WeatherSummary | null) => void;
  onAnswerCall: () => void;
  onActivityClear: (what: "unread" | "missed") => void;
  onPlaceCall: (roomId: string) => void;
  onSendMessage: (roomId: string, text: string) => void;
  onShowPhotos: (id: number, userId: string | null) => void;
  onHistoryRequest: (id: number, roomId: string, limit: number) => void;
}

export interface AgentHandle {
  stop: () => void;
  sendActivity: (activity: ActivitySummary) => void;
  sendContacts: (contacts: Contact[]) => void;
  sendAnnounce: (announcement: Announcement) => void;
  sendHistory: (id: number, messages: HistoryMessage[]) => void;
  sendPhotosResult: (id: number, result: PhotosResult) => void;
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
  let lastContacts: Contact[] | null = null;

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
      if (lastContacts) link.send({ type: "contacts", contacts: lastContacts });
    } else if (message.type === "assistant") callbacks.onAssistant(message.tree);
    else if (message.type === "weather") callbacks.onWeather(message.weather);
    else if (message.type === "wake") playWake();
    else if (message.type === "answer-call") callbacks.onAnswerCall();
    else if (message.type === "activity-clear") callbacks.onActivityClear(message.what);
    else if (message.type === "place-call") callbacks.onPlaceCall(message.roomId);
    else if (message.type === "send-message") callbacks.onSendMessage(message.roomId, message.text);
    else if (message.type === "show-photos") callbacks.onShowPhotos(message.id, message.userId);
    else if (message.type === "history-request")
      callbacks.onHistoryRequest(message.id, message.roomId, message.limit);
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
    sendContacts(contacts) {
      lastContacts = contacts;
      link.send({ type: "contacts", contacts });
    },
    sendAnnounce(announcement) {
      link.send({ type: "announce", announcement });
    },
    sendHistory(id, messages) {
      link.send({ type: "history", id, messages });
    },
    sendPhotosResult(id, result) {
      link.send({ type: "photos-result", id, result });
    },
    setCallActive(active) {
      callActive = active;
      updateSuppression();
    },
  };
}
