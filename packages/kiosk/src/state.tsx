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
      const agent = startAgent({
        onAssistant: (tree) => setState({ kind: "assistant", tree }),
        onAnswerCall: () => {},
        onActivityClear: () => {},
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
    });
    agent = startAgent({
      onAssistant: handle.showAssistant,
      onAnswerCall: handle.answerCall,
      onActivityClear: handle.clearActivity,
    });
    return () => {
      agent?.stop();
      handle.stop();
    };
  }, []);

  return <StateCtx.Provider value={{ state, setState, lang, night }}>{children}</StateCtx.Provider>;
}

export const useKioskState = () => useContext(StateCtx);
