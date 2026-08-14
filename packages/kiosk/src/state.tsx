import type { KioskConfig, KioskState } from "@kazimo/shared";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

const StateCtx = createContext<{
  state: KioskState;
  setState: (s: KioskState) => void;
  lang: string;
}>({ state: { kind: "idle", photo: null }, setState: () => {}, lang: "en" });

export function KioskStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KioskState>({ kind: "idle", photo: null });
  const forcedLang = new URLSearchParams(location.search).get("lang");
  const [lang, setLang] = useState(forcedLang ?? "en");

  useEffect(() => {
    if (forcedLang) return;
    fetch("/api/config")
      .then((r) => r.json() as Promise<KioskConfig>)
      .then((c) => setLang(c.lang))
      .catch(() => {});
  }, [forcedLang]);

  return <StateCtx.Provider value={{ state, setState, lang }}>{children}</StateCtx.Provider>;
}

export const useKioskState = () => useContext(StateCtx);
