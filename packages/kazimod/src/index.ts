import type { DaemonToKiosk, KioskToDaemon } from "@kazimo/shared";
import kioskPage from "../../kiosk/index.html";
import { loadConfig } from "./config";

const config = loadConfig();
const isDev = process.env.NODE_ENV !== "production";
const EC_DIST = new URL("../../kiosk/node_modules/@element-hq/element-call-embedded/dist/", import.meta.url)
  .pathname;
const CRYPTO_WASM = new URL(
  "../../kiosk/node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm",
  import.meta.url,
).pathname;

const log = (m: string) => console.log(`[kazimod] ${new Date().toISOString()} ${m}`);

const server = Bun.serve<{ id: number }>({
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

log(`serving kiosk on http://localhost:${server.port} (room ${config.roomId}, ${isDev ? "dev" : "prod"})`);
