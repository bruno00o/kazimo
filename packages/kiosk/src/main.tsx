import type { KioskState } from "@kazimo/shared";
import { tokens } from "@kazimo/shared";
import { StrictMode } from "react";
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

function App() {
  const { state } = useKioskState();
  return <ScreenFor state={forced ? (FORCED[forced] ?? IDLE) : state} />;
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
