import type { KioskConfig, KioskState } from "@kazimo/shared";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type AgentHandle, startAgent } from "./agent";
import { startKiosk } from "./matrix/controller";

const params = new URLSearchParams(location.search);
const forcedState = params.get("state");
const forcedLang = params.get("lang");
const forcedNight = params.get("night") === "1";

const StateCtx = createContext<{
  state: KioskState;
  setState: (s: KioskState) => void;
  lang: string;
  night: boolean;
}>({ state: { kind: "idle", photo: null }, setState: () => {}, lang: "en", night: false });

export function KioskStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KioskState>({ kind: "idle", photo: null });
  const [lang, setLang] = useState(forcedLang ?? "en");
  const [night, setNight] = useState(forcedNight);

  useEffect(() => {
    if (forcedState) {
      if (!forcedLang) {
        fetch("/api/config")
          .then((r) => r.json() as Promise<KioskConfig>)
          .then((c) => setLang(c.lang))
          .catch(() => {});
      }
      const agent: AgentHandle = startAgent({
        onAssistant: (tree) => setState(tree ? { kind: "assistant", tree } : { kind: "idle", photo: null }),
        onAnswerCall: () => {},
        onActivityClear: () => {},
        onPlaceCall: () => {},
        onSendMessage: () => {},
        onShowPhotos: (id) => agent.sendPhotosResult(id, { shown: 0, from: null, timestamp: null }),
        onHistoryRequest: (id) => agent.sendHistory(id, []),
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
      announce: (announcement) => agent?.sendAnnounce(announcement),
    });
    agent = startAgent({
      onAssistant: handle.showAssistant,
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
    });
    return () => {
      agent?.stop();
      handle.stop();
    };
  }, []);

  return <StateCtx.Provider value={{ state, setState, lang, night }}>{children}</StateCtx.Provider>;
}

export const useKioskState = () => useContext(StateCtx);
