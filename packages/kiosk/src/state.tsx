import type { KioskConfig, KioskState, WeatherSummary } from "@kazimo/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type AgentHandle, startAgent } from "./agent";
import { startKiosk } from "./matrix/controller";

const NOISY_HINT_MS = 4000;

const params = new URLSearchParams(location.search);
const forcedState = params.get("state");
const forcedLang = params.get("lang");
const forcedNight = params.get("night") === "1";

const StateCtx = createContext<{
  state: KioskState;
  setState: (s: KioskState) => void;
  lang: string;
  night: boolean;
  weather: WeatherSummary | null;
  noisy: boolean;
  config: KioskConfig | null;
  paired: boolean | null;
}>({
  state: { kind: "idle", photo: null },
  setState: () => {},
  lang: "en",
  night: false,
  weather: null,
  noisy: false,
  config: null,
  paired: null,
});

export function KioskStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KioskState>({ kind: "idle", photo: null });
  const [lang, setLang] = useState(forcedLang ?? "en");
  const [night, setNight] = useState(forcedNight);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [noisy, setNoisy] = useState(false);
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [paired, setPaired] = useState<boolean | null>(null);
  const noisyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNoisy = useCallback(() => {
    setNoisy(true);
    if (noisyTimer.current) clearTimeout(noisyTimer.current);
    noisyTimer.current = setTimeout(() => setNoisy(false), NOISY_HINT_MS);
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json() as Promise<KioskConfig>)
      .then((c) => {
        setConfig(c);
        if (!forcedLang) setLang(c.lang);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (forcedState) {
      const agent: AgentHandle = startAgent({
        onAssistant: (tree) => setState(tree ? { kind: "assistant", tree } : { kind: "idle", photo: null }),
        onWeather: setWeather,
        onNoisy: showNoisy,
        onAnswerCall: () => {},
        onActivityClear: () => {},
        onPlaceCall: () => {},
        onSendMessage: () => {},
        onShowPhotos: (id) => agent.sendPhotosResult(id, { shown: 0, from: null, timestamp: null }),
        onHistoryRequest: (id) => agent.sendHistory(id, []),
        onRingStale: () => {},
      });
      return agent.stop;
    }

    let agent: AgentHandle | null = null;
    const handle = startKiosk({
      setState: (next) => {
        agent?.setCallActive(next.kind === "in-call");
        setState(next);
      },
      setLang: forcedLang ? () => {} : setLang,
      setNight: forcedNight ? () => {} : setNight,
      reportActivity: (activity) => agent?.sendActivity(activity),
      reportContacts: (contacts) => agent?.sendContacts(contacts),
      reportRingDevices: (devices) => agent?.sendRingDevices(devices),
      reportPaired: setPaired,
      announce: (announcement) => agent?.sendAnnounce(announcement),
    });
    agent = startAgent({
      onAssistant: handle.showAssistant,
      onWeather: setWeather,
      onNoisy: showNoisy,
      onAnswerCall: handle.answerCall,
      onActivityClear: handle.clearActivity,
      onPlaceCall: handle.placeCall,
      onSendMessage: handle.sendMessage,
      onShowPhotos: (id, userId) => {
        void handle.showPhotos(userId).then((result) => agent?.sendPhotosResult(id, result));
      },
      onHistoryRequest: (id, roomId, limit) => {
        void handle.history(roomId, limit).then((messages) => agent?.sendHistory(id, messages));
      },
      onRingStale: handle.dropRingTokens,
    });
    return () => {
      agent?.stop();
      handle.stop();
    };
  }, [showNoisy]);

  return (
    <StateCtx.Provider value={{ state, setState, lang, night, weather, noisy, config, paired }}>
      {children}
    </StateCtx.Provider>
  );
}

export const useKioskState = () => useContext(StateCtx);
