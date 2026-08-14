import type { KioskConfig } from "@kazimo/shared";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export interface DaemonConfig extends KioskConfig {
  accessToken: string;
  port: number;
}

export function loadConfig(): DaemonConfig {
  return {
    homeserverUrl: required("KAZIMO_HOMESERVER"),
    userId: required("KAZIMO_USER"),
    deviceId: required("KAZIMO_DEVICE"),
    accessToken: required("KAZIMO_TOKEN"),
    roomId: required("KAZIMO_ROOM"),
    lang: process.env.KAZIMO_LANG ?? "en",
    idleReturnSeconds: Number(process.env.KAZIMO_IDLE_RETURN ?? 30),
    autoAnswerDelayMs: Number(process.env.KAZIMO_AUTO_ANSWER_MS ?? 3000),
    port: Number(process.env.KAZIMO_PORT ?? 8080),
  };
}
