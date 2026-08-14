import type { DaemonToKiosk, KioskToDaemon } from "@kazimo/shared";
import { Context, Effect, Layer, Schema } from "effect";
import kioskPage from "../../kiosk/index.html";
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

const log = (message: string) => console.log(`[kazimod] ${new Date().toISOString()} ${message}`);

function start(config: DaemonConfig) {
  const isDev = process.env.NODE_ENV !== "production";

  return Bun.serve<{ id: number }>({
    port: config.port,
    development: isDev && { hmr: true, console: true },

    routes: {
      "/": kioskPage,

      "/api/config": () => {
        const { port: _port, ...kioskConfig } = config;
        return Response.json(kioskConfig);
      },
    },

    async fetch(req, srv) {
      const p = new URL(req.url).pathname;

      if (p === "/ws" && srv.upgrade(req, { data: { id: Date.now() } })) return;

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
        const hello: DaemonToKiosk = { type: "config", config };
        ws.send(JSON.stringify(hello));
      },
      message(_ws, raw) {
        const msg = JSON.parse(String(raw)) as KioskToDaemon;
        if (msg.type === "ready") log("kiosk reports ready");
        else if (msg.type === "event") log(`kiosk event: ${msg.name}`);
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
    readonly server: Bun.Server<{ id: number }>;
  }
>()("kazimo/kazimod/KioskServer") {
  static readonly layer = Layer.effect(
    KioskServer,
    Effect.gen(function* () {
      const config = yield* daemonConfig;

      const server = yield* Effect.acquireRelease(
        Effect.try({
          try: () => start(config),
          catch: (cause) => new ServerStartError({ cause }),
        }),
        (running) => Effect.promise(() => running.stop()),
      );

      yield* Effect.log(`serving kiosk on http://localhost:${server.port}`);

      return KioskServer.of({ server });
    }),
  );
}
