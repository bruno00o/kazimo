import { appendFile, mkdir } from "node:fs/promises";
import {
  type A2uiNode,
  type Announcement,
  CAPTURE_SAMPLE_RATE,
  type DaemonToKiosk,
  type KioskToDaemon,
  type WeatherSummary,
} from "@kazimo/shared";
import { Context, Effect, Layer, Schema } from "effect";
import kioskPage from "../../kiosk/index.html";
import { Agent, type AgentReply, type ComposedScreen } from "./agent";
import { speak, transcribe } from "./ai";
import { wavFromPcm16 } from "./audio";
import { KioskBridge, type KioskBridgeApi } from "./bridge";
import { type DaemonConfig, daemonConfig } from "./config";
import {
  cacheImage,
  ensureImageCacheDir,
  IMAGE_ROUTE_PREFIX,
  resolveComposerTree,
  serveCachedImage,
} from "./images";
import { createListener, type Listener } from "./listen";
import { currentWeather, imageSearchUrl } from "./tools";
import { defaultWakeModelPath, loadWakeModels, type WakeModels } from "./wake";

export class ServerStartError extends Schema.TaggedError<ServerStartError>()("ServerStartError", {
  cause: Schema.Defect(),
}) {}

const EC_DIST = new URL("../../kiosk/node_modules/@element-hq/element-call-embedded/dist/", import.meta.url)
  .pathname;

const CRYPTO_WASM = new URL(
  "../../kiosk/node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm",
  import.meta.url,
).pathname;

const CAPTURE_PATH = `${process.env.HOME}/.kazimo/last-capture.wav`;
const A2UI_LOG_DIR = `${process.env.HOME}/.kazimo/logs`;
const A2UI_JOURNAL_PATH = `${A2UI_LOG_DIR}/a2ui.jsonl`;
const BENCH_RESULTS_PATH = `${process.env.HOME}/.kazimo/bench/latest.json`;

const log = (message: string) => console.log(`[kazimod] ${new Date().toISOString()} ${message}`);

const ANNOUNCE_MAX_CHARS = 300;
const WEATHER_REFRESH_MS = 20 * 60 * 1000;
const MAX_FOLLOWUP_CHAIN = 3;
const NOISY_DEBOUNCE_MS = 20_000;

const NOISY_LINES: Record<string, string> = {
  pt: "Está muito barulho, não consigo ouvir bem.",
  fr: "Il y a trop de bruit, je n'entends pas bien.",
  en: "It is too noisy, I cannot hear well.",
};

const noisyLine = (lang: string) =>
  NOISY_LINES[lang.split("-")[0] ?? lang] ?? "It is too noisy, I cannot hear well.";

function announcementText(lang: string, announcement: Announcement): string {
  const body = announcement.body ? announcement.body.slice(0, ANNOUNCE_MAX_CHARS) : null;
  const from = announcement.from;
  const language = lang.split("-")[0];
  if (announcement.kind === "photo") {
    const base =
      language === "pt"
        ? `${from} enviou uma foto`
        : language === "fr"
          ? `${from} a envoyé une photo`
          : `${from} sent a photo`;
    return body ? `${base}: ${body}` : `${base}.`;
  }
  const said = language === "pt" ? "escreveu" : language === "fr" ? "a écrit" : "wrote";
  return `${from} ${said}: ${body ?? ""}`;
}

const journal = (entry: object) =>
  appendFile(A2UI_JOURNAL_PATH, `${JSON.stringify(entry)}\n`).catch((error) =>
    log(`journal write failed: ${error}`),
  );

interface SocketData {
  id: number;
  capture: Uint8Array[] | null;
  listener: Listener | null;
  suppressFollowup: boolean;
  followupChain: number;
}

interface AgentBridge {
  ask(question: string): Promise<AgentReply>;
  compose(question: string, reports: string[], speech: string): Promise<ComposedScreen>;
  conversationAlive(): boolean;
  endConversation(): void;
}

function start(
  config: DaemonConfig,
  agent: AgentBridge,
  wakeModels: WakeModels | null,
  bridge: KioskBridgeApi,
) {
  const isDev = process.env.NODE_ENV !== "production";
  let latestWeather: WeatherSummary | null = null;
  let lastNoisy = 0;
  const {
    port: _port,
    ai: _ai,
    agent: _agent,
    wake: _wake,
    ring: _ring,
    chatTtlMs: _chatTtl,
    followupWindowMs: _followup,
    ...kioskConfig
  } = config;

  const respond = async (ws: Bun.ServerWebSocket<SocketData>, frames: Uint8Array[]) => {
    const pcm = Buffer.concat(frames);
    const seconds = pcm.byteLength / 2 / CAPTURE_SAMPLE_RATE;
    const wav = wavFromPcm16(pcm, CAPTURE_SAMPLE_RATE);
    void Bun.write(CAPTURE_PATH, wav).catch((error) => log(`capture write failed: ${error}`));
    log(`capture: ${seconds.toFixed(1)}s (${pcm.byteLength} bytes)`);
    if (!config.ai.key) return;

    ws.send(JSON.stringify({ type: "thinking", on: true } as DaemonToKiosk));
    try {
      await pipeline(ws, wav);
    } finally {
      ws.send(JSON.stringify({ type: "thinking", on: false } as DaemonToKiosk));
    }
  };

  const pipeline = async (ws: Bun.ServerWebSocket<SocketData>, wav: Uint8Array) => {
    const sttStarted = Date.now();
    const text = await transcribe(config.ai, wav, config.lang);
    log(`transcription (${Date.now() - sttStarted}ms): ${text}`);
    if (!text.trim()) return;

    const askStarted = Date.now();
    const reply = await agent.ask(text);
    for (const report of reply.reports) log(`tool: ${report}`);
    log(`agent (${Date.now() - askStarted}ms): ${reply.speech}`);
    if (!reply.speech.trim()) return;

    const sendTree = (tree: A2uiNode | null) => {
      const message: DaemonToKiosk = { type: "assistant", tree };
      ws.send(JSON.stringify(message));
    };

    const composeStarted = Date.now();
    const composed = reply.screenClaimed
      ? journal({
          ts: new Date().toISOString(),
          question: text,
          reports: reply.reports,
          speech: reply.speech,
          tree: null,
          claimed: true,
        }).then(() => sendTree(null))
      : agent
          .compose(text, reply.reports, reply.speech)
          .then(async (screen) => {
            const outcome = screen.tree ? "tree" : (screen.error ?? "null");
            log(`composer (${Date.now() - composeStarted}ms): ${outcome}`);
            const tree = screen.tree
              ? await resolveComposerTree(
                  screen.tree,
                  (query) => imageSearchUrl(config.agent, query),
                  cacheImage,
                )
              : null;
            if (screen.tree && !tree) log("composer tree dropped: images unresolved");
            await journal({
              ts: new Date().toISOString(),
              question: text,
              reports: reply.reports,
              speech: reply.speech,
              tree,
              error: screen.error,
            });
            sendTree(tree);
          })
          .catch((error) => log(`composer failed: ${error}`));

    const ttsStarted = Date.now();
    const audio = await speak(config.ai, reply.speech, config.lang);
    if (audio) {
      log(`tts (${Date.now() - ttsStarted}ms): ${audio.byteLength} bytes`);
      ws.data.suppressFollowup = reply.final;
      ws.send(audio);
    } else {
      log(`tts skipped: no reference file and no catalog voice for "${config.lang}"`);
    }
    await composed;
  };

  const announceNoisy = async (ws: Bun.ServerWebSocket<SocketData>) => {
    ws.send(JSON.stringify({ type: "noisy" } as DaemonToKiosk));
    if (!config.ai.key) return;
    const audio = await speak(config.ai, noisyLine(config.lang), config.lang);
    if (audio) ws.send(audio);
  };

  const handleUtterance = (
    ws: Bun.ServerWebSocket<SocketData>,
    frames: Uint8Array[],
    level: number,
    isFollowup: boolean,
  ) => {
    log(`capture level ${Math.round(level)}${isFollowup ? " (follow-up)" : ""}`);
    if (level >= config.wake.captureRmsMin) {
      void respond(ws, frames).catch((error) => log(`agent pipeline failed: ${error}`));
      return;
    }
    if (isFollowup) {
      log("follow-up dropped: below near-speech level");
      return;
    }
    const now = Date.now();
    if (now - lastNoisy < NOISY_DEBOUNCE_MS) return;
    lastNoisy = now;
    log("too noisy: wake capture below near-speech level");
    void announceNoisy(ws).catch((error) => log(`noisy feedback failed: ${error}`));
  };

  const server = Bun.serve<SocketData>({
    port: config.port,
    development: isDev && { hmr: true, console: true },

    routes: {
      "/": kioskPage,

      "/api/config": () => Response.json(kioskConfig),

      ...(isDev && {
        "/api/bench": async () => {
          const results = Bun.file(BENCH_RESULTS_PATH);
          if (!(await results.exists())) return new Response("no bench results", { status: 404 });
          return new Response(results, { headers: { "content-type": "application/json" } });
        },
      }),
    },

    async fetch(req, srv) {
      const p = new URL(req.url).pathname;

      if (
        p === "/ws" &&
        srv.upgrade(req, {
          data: { id: Date.now(), capture: null, listener: null, suppressFollowup: false, followupChain: 0 },
        })
      )
        return;

      if (p.startsWith(IMAGE_ROUTE_PREFIX)) {
        return (await serveCachedImage(p)) ?? new Response("not found", { status: 404 });
      }

      if (p.endsWith("matrix_sdk_crypto_wasm_bg.wasm")) {
        return new Response(Bun.file(CRYPTO_WASM), {
          headers: { "content-type": "application/wasm" },
        });
      }

      if (p.startsWith("/call/")) {
        const f = Bun.file(`${EC_DIST}${p.slice("/call/".length) || "index.html"}`);
        return (await f.exists()) ? new Response(f) : new Response(Bun.file(`${EC_DIST}index.html`));
      }

      return new Response("not found", { status: 404 });
    },

    websocket: {
      open(ws) {
        log(`kiosk connected (${ws.data.id})`);
        bridge.setSink((message) => ws.send(JSON.stringify(message)));
        if (wakeModels) {
          ws.data.listener = createListener(
            wakeModels,
            config.wake.threshold,
            {
              onWake() {
                log("wake word detected");
                ws.data.followupChain = 0;
                const wake: DaemonToKiosk = { type: "wake" };
                ws.send(JSON.stringify(wake));
              },
              onUtterance(frames, meta) {
                handleUtterance(ws, frames, meta.level, meta.followup);
              },
              onScore(score, rms) {
                log(`wake score ${score.toFixed(2)} rms ${Math.round(rms)}`);
              },
            },
            config.followupWindowMs,
          );
        }
        const hello: DaemonToKiosk = { type: "config", config: kioskConfig };
        ws.send(JSON.stringify(hello));
        ws.subscribe("weather");
        if (latestWeather)
          ws.send(JSON.stringify({ type: "weather", weather: latestWeather } as DaemonToKiosk));
      },
      message(ws, raw) {
        if (typeof raw !== "string") {
          const frame = new Uint8Array(raw);
          if (ws.data.listener) ws.data.listener.push(frame);
          else ws.data.capture?.push(frame);
          return;
        }
        const msg = JSON.parse(raw) as KioskToDaemon;
        if (msg.type === "ready") log("kiosk reports ready");
        else if (msg.type === "event") log(`kiosk event: ${msg.name}`);
        else if (msg.type === "activity") {
          bridge.setActivity(msg.activity);
          if (msg.activity.ringing) agent.endConversation();
          log(
            `activity: ${msg.activity.unread.length} unread, ${msg.activity.missed.length} missed` +
              (msg.activity.ringing ? `, ringing from ${msg.activity.ringing.from}` : ""),
          );
        } else if (msg.type === "contacts") {
          bridge.setContacts(msg.contacts);
          log(`contacts: ${msg.contacts.map((contact) => contact.displayName).join(", ") || "none"}`);
        } else if (msg.type === "history" || msg.type === "photos-result") {
          bridge.resolveRequest(msg);
        } else if (msg.type === "announce") {
          if (config.ai.key) {
            const text = announcementText(config.lang, msg.announcement);
            void speak(config.ai, text, config.lang)
              .then((audio) => {
                if (audio) ws.send(audio);
              })
              .catch((error) => log(`announce failed: ${error}`));
          }
        } else if (msg.type === "playback-start") ws.data.listener?.setSuppressed(true);
        else if (msg.type === "playback-end") {
          ws.data.listener?.setSuppressed(false);
          const settled = ws.data.suppressFollowup;
          ws.data.suppressFollowup = false;
          if (settled) log("follow-up skipped: exchange settled");
          else if (ws.data.listener && agent.conversationAlive()) {
            if (ws.data.followupChain >= MAX_FOLLOWUP_CHAIN) {
              log(`follow-up chain limit reached (${MAX_FOLLOWUP_CHAIN}); wake word required`);
            } else {
              ws.data.followupChain += 1;
              log(`follow-up window open (${ws.data.followupChain}/${MAX_FOLLOWUP_CHAIN})`);
              ws.data.listener.openFollowup();
            }
          }
        } else if (msg.type === "capture-start") {
          if (ws.data.listener) ws.data.listener.forceStart();
          else ws.data.capture = [];
        } else if (msg.type === "capture-end") {
          if (ws.data.listener) ws.data.listener.forceEnd();
          else if (ws.data.capture) {
            const frames = ws.data.capture;
            ws.data.capture = null;
            void respond(ws, frames).catch((error) => log(`agent pipeline failed: ${error}`));
          }
        }
      },
      close(ws) {
        log(`kiosk disconnected (${ws.data.id})`);
        bridge.setSink(null);
      },
    },
  });

  const refreshWeather = async () => {
    const weather = await currentWeather(config.agent);
    if (!weather) return;
    latestWeather = weather;
    server.publish("weather", JSON.stringify({ type: "weather", weather } as DaemonToKiosk));
  };
  void refreshWeather();
  setInterval(() => void refreshWeather(), WEATHER_REFRESH_MS);

  return server;
}

export class KioskServer extends Context.Service<
  KioskServer,
  {
    readonly server: Bun.Server<SocketData>;
  }
>()("kazimo/kazimod/KioskServer") {
  static readonly layer = Layer.effect(
    KioskServer,
    Effect.gen(function* () {
      const config = yield* daemonConfig;
      const agent = yield* Agent;
      const kioskBridge = yield* KioskBridge;
      const bridge: AgentBridge = {
        ask: (question) => Effect.runPromise(agent.ask(question)),
        compose: (question, reports, speech) => Effect.runPromise(agent.compose(question, reports, speech)),
        conversationAlive: () => Effect.runSync(agent.conversationAlive()),
        endConversation: () => Effect.runSync(agent.endConversation()),
      };

      yield* Effect.promise(() => mkdir(A2UI_LOG_DIR, { recursive: true }));
      yield* Effect.promise(() => ensureImageCacheDir());

      const wakeModelPath = config.wake.modelPath ?? defaultWakeModelPath;
      const wakeModels = yield* Effect.tryPromise(() => loadWakeModels(wakeModelPath)).pipe(
        Effect.tap(() => Effect.log(`wake word listening with ${wakeModelPath}`)),
        Effect.catch((error) =>
          Effect.log(`wake word disabled, push-to-talk only: ${error.cause}`).pipe(Effect.as(null)),
        ),
      );

      const server = yield* Effect.acquireRelease(
        Effect.try({
          try: () => start(config, bridge, wakeModels, kioskBridge),
          catch: (cause) => new ServerStartError({ cause }),
        }),
        (running) => Effect.promise(() => running.stop()),
      );

      yield* Effect.log(`serving kiosk on http://localhost:${server.port}`);
      yield* Effect.log(
        config.ring
          ? `ring gateway on for ${Object.keys(config.ring.deviceTokens).length} contacts`
          : "ring gateway off",
      );

      return KioskServer.of({ server });
    }),
  );
}
