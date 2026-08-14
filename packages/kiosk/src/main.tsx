import type { KioskState } from "@kazimo/shared";
import { tokens } from "@kazimo/shared";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScreenFor } from "./screens";
import { KioskStateProvider, useKioskState } from "./state";

function cssVars(obj: object, prefix: string): [string, string][] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" ? cssVars(value, `${prefix}-${key}`) : [[`${prefix}-${key}`, String(value)]],
  );
}

for (const [name, value] of cssVars(tokens, "--kz")) {
  document.documentElement.style.setProperty(name, value);
}

const IDLE: KioskState = { kind: "idle", photo: null };

const FORCED: Record<string, KioskState> = {
  idle: IDLE,
  incoming: {
    kind: "incoming-call",
    caller: { userId: "@demo", displayName: "Anna", avatarUrl: null },
  },
  call: { kind: "in-call", caller: { userId: "@demo", displayName: "Anna", avatarUrl: null } },
  message: {
    kind: "message",
    from: { userId: "@demo", displayName: "Anna", avatarUrl: null },
    text: "Thinking of you, see you Sunday!",
  },
  degraded: { kind: "degraded", reason: "dev" },
};

const forced = new URLSearchParams(location.search).get("state");

const MAX_LAYERS = 3;

function FadeStack({ state }: { state: KioskState }) {
  const [layers, setLayers] = useState([{ key: 0, state }]);

  useEffect(() => {
    setLayers((prev) => {
      const last = prev[prev.length - 1];
      if (last?.state === state) return prev;
      return [...prev, { key: (last?.key ?? 0) + 1, state }].slice(-MAX_LAYERS);
    });
    const timer = setTimeout(() => setLayers((prev) => prev.slice(-1)), tokens.fade.inMs);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      {layers.map((layer) => (
        <div key={layer.key} className="layer">
          <ScreenFor state={layer.state} />
        </div>
      ))}
    </>
  );
}

function App() {
  const { state } = useKioskState();
  return <FadeStack state={forced ? (FORCED[forced] ?? IDLE) : state} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <KioskStateProvider>
      <App />
    </KioskStateProvider>
  </StrictMode>,
);
