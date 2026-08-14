import type { DaemonToKiosk, KioskToDaemon } from "@kazimo/shared";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export interface DaemonLink {
  send: (message: KioskToDaemon) => void;
  sendAudio: (frame: ArrayBuffer) => void;
  stop: () => void;
}

export function connectDaemon(onMessage: (message: DaemonToKiosk) => void): DaemonLink {
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempts = 0;

  const open = () => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => {
      attempts = 0;
      ws.send(JSON.stringify({ type: "ready" } satisfies KioskToDaemon));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") onMessage(JSON.parse(event.data) as DaemonToKiosk);
    };
    ws.onclose = () => {
      socket = null;
      if (stopped) return;
      attempts += 1;
      setTimeout(open, Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_MAX_MS));
    };
  };
  open();

  const ready = () => (socket?.readyState === WebSocket.OPEN ? socket : null);

  return {
    send(message) {
      ready()?.send(JSON.stringify(message));
    },
    sendAudio(frame) {
      ready()?.send(frame);
    },
    stop() {
      stopped = true;
      socket?.close();
    },
  };
}
