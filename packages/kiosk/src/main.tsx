import type { A2uiNode, KioskState } from "@kazimo/shared";
import { tokens } from "@kazimo/shared";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantScreen, ScreenFor } from "./screens";
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

const ASSISTANT_FIXTURE: A2uiNode = {
  kind: "column",
  children: [
    { kind: "title", text: "The weather this week" },
    {
      kind: "row",
      children: [
        {
          kind: "card",
          children: [
            { kind: "icon", name: "sun" },
            { kind: "number", value: "23", label: "today" },
            { kind: "text", text: "sunny all day" },
          ],
        },
        {
          kind: "card",
          children: [
            { kind: "icon", name: "rain" },
            { kind: "number", value: "17", label: "tomorrow" },
            { kind: "text", text: "light rain" },
          ],
        },
      ],
    },
    { kind: "divider" },
    { kind: "step", index: 1, text: "Take the umbrella" },
    { kind: "step", index: 2, text: "Leave before ten" },
    { kind: "list", items: ["Monday market", "Tuesday visit", "Sunday lunch"] },
  ],
};

const FORCED: Record<string, KioskState> = {
  idle: IDLE,
  badge: {
    kind: "idle",
    photo: null,
    activity: {
      unread: [
        { userId: "@rui", from: "Rui", kind: "text", body: "Bom dia!", timestamp: 0 },
        { userId: "@rui", from: "Rui", kind: "photo", body: null, timestamp: 0 },
      ],
      missed: [{ userId: "@maria", from: "Maria", timestamp: 0 }],
      ringing: null,
    },
  },
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
  assistant: { kind: "assistant", tree: ASSISTANT_FIXTURE },
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

interface BenchEntry {
  question: string;
  speech: string;
  tree: A2uiNode | null;
  ms: number;
}

function GalleryScreen() {
  const [entries, setEntries] = useState<BenchEntry[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    fetch("/api/bench")
      .then((r) => (r.ok ? (r.json() as Promise<BenchEntry[]>) : []))
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "ArrowRight") setIndex((i) => i + 1);
      if (event.code === "ArrowLeft") setIndex((i) => i - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!entries) return null;
  if (entries.length === 0) {
    return (
      <div className="screen theme-light">
        <div className="soft">No bench results. Run: bun packages/kazimod/bench/run.ts</div>
      </div>
    );
  }
  const at = ((index % entries.length) + entries.length) % entries.length;
  const entry = entries[at];
  if (!entry) return null;
  return (
    <>
      {entry.tree ? (
        <AssistantScreen tree={entry.tree} />
      ) : (
        <div className="screen theme-light">
          <div className="soft">{entry.speech || "(no tree, no speech)"}</div>
        </div>
      )}
      <div className="hint">{`${at + 1}/${entries.length} | ${entry.question} | ${entry.ms}ms`}</div>
    </>
  );
}

function App() {
  const { state, night } = useKioskState();
  if (forced === "gallery") return <GalleryScreen />;
  const shown = forced ? (state.kind === "assistant" ? state : (FORCED[forced] ?? IDLE)) : state;
  const veiled = night && shown.kind === "idle";
  return (
    <>
      <FadeStack state={shown} />
      <div className={veiled ? "night-veil veiled" : "night-veil"} />
    </>
  );
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
