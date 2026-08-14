import type { KioskConfig, KioskState } from "@kazimo/shared";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { startKiosk } from "./matrix/controller";

const params = new URLSearchParams(location.search);
const forcedState = params.get("state");
const forcedLang = params.get("lang");

const StateCtx = createContext<{
  state: KioskState;
  setState: (s: KioskState) => void;
  lang: string;
}>({ state: { kind: "idle", photo: null }, setState: () => {}, lang: "en" });

export function KioskStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KioskState>({ kind: "idle", photo: null });
  const [lang, setLang] = useState(forcedLang ?? "en");

  useEffect(() => {
    if (forcedState) {
      if (!forcedLang) {
        fetch("/api/config")
          .then((r) => r.json() as Promise<KioskConfig>)
          .then((c) => setLang(c.lang))
          .catch(() => {});
      }
      return;
    }
    const handle = startKiosk({
      setState,
      setLang: forcedLang ? () => {} : setLang,
    });
    return handle.stop;
  }, []);

  return <StateCtx.Provider value={{ state, setState, lang }}>{children}</StateCtx.Provider>;
}

export const useKioskState = () => useContext(StateCtx);
