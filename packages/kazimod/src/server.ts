import { CAPTURE_SAMPLE_RATE, type DaemonToKiosk, type KioskToDaemon } from "@kazimo/shared";
import { Context, Effect, Layer, Schema } from "effect";
import kioskPage from "../../kiosk/index.html";
import { Agent } from "./agent";
import { speak, transcribe } from "./ai";
import { wavFromPcm16 } from "./audio";
import { type DaemonConfig, daemonConfig } from "./config";

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

const log = (message: string) => console.log(`[kazimod] ${new Date().toISOString()} ${message}`);

interface SocketData {
  id: number;
  capture: Uint8Array[] | null;
}

function start(config: DaemonConfig, ask: (question: string) => Promise<string>) {
  const isDev = process.env.NODE_ENV !== "production";
  const { port: _port, ai: _ai, agent: _agent, ...kioskConfig } = config;

  const respond = async (ws: Bun.ServerWebSocket<SocketData>, frames: Uint8Array[]) => {
    const pcm = Buffer.concat(frames);
    const seconds = pcm.byteLength / 2 / CAPTURE_SAMPLE_RATE;
    const wav = wavFromPcm16(pcm, CAPTURE_SAMPLE_RATE);
    void Bun.write(CAPTURE_PATH, wav).catch((error) => log(`capture write failed: ${error}`));
    log(`capture: ${seconds.toFixed(1)}s (${pcm.byteLength} bytes)`);
    if (!config.ai.key) return;

    const sttStarted = Date.now();
    const text = await transcribe(config.ai, wav, config.lang);
    log(`transcription (${Date.now() - sttStarted}ms): ${text}`);
    if (!text.trim()) return;

    const askStarted = Date.now();
    const reply = await ask(text);
    log(`agent (${Date.now() - askStarted}ms): ${reply}`);
    if (!reply.trim()) return;

    const ttsStarted = Date.now();
    const audio = await speak(config.ai, reply, config.lang);
    if (!audio) {
      log(`tts skipped: no reference file and no catalog voice for "${config.lang}"`);
      return;
    }
    log(`tts (${Date.now() - ttsStarted}ms): ${audio.byteLength} bytes`);
    ws.send(audio);
  };

  return Bun.serve<SocketData>({
    port: config.port,
    development: isDev && { hmr: true, console: true },

    routes: {
      "/": kioskPage,

      "/api/config": () => Response.json(kioskConfig),
    },

    async fetch(req, srv) {
      const p = new URL(req.url).pathname;

      if (p === "/ws" && srv.upgrade(req, { data: { id: Date.now(), capture: null } })) return;

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
        const hello: DaemonToKiosk = { type: "config", config: kioskConfig };
        ws.send(JSON.stringify(hello));
      },
      message(ws, raw) {
        if (typeof raw !== "string") {
          ws.data.capture?.push(new Uint8Array(raw));
          return;
        }
        const msg = JSON.parse(raw) as KioskToDaemon;
        if (msg.type === "ready") log("kiosk reports ready");
        else if (msg.type === "event") log(`kiosk event: ${msg.name}`);
        else if (msg.type === "capture-start") ws.data.capture = [];
        else if (msg.type === "capture-end" && ws.data.capture) {
          const frames = ws.data.capture;
          ws.data.capture = null;
          void respond(ws, frames).catch((error) => log(`agent pipeline failed: ${error}`));
        }
      },
      close(ws) {
        log(`kiosk disconnected (${ws.data.id})`);
      },
    },
  });
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
      const ask = (question: string) => Effect.runPromise(agent.ask(question));

      const server = yield* Effect.acquireRelease(
        Effect.try({
          try: () => start(config, ask),
          catch: (cause) => new ServerStartError({ cause }),
        }),
        (running) => Effect.promise(() => running.stop()),
      );

      yield* Effect.log(`serving kiosk on http://localhost:${server.port}`);

      return KioskServer.of({ server });
    }),
  );
}
