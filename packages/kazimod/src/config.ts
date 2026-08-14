import type { KioskConfig } from "@kazimo/shared";
import { Config, Option } from "effect";

export const AI_BASE_URL_DEFAULT = "https://api.mistral.ai/v1";

export interface AiConfig {
  baseUrl: string;
  key: string | null;
  sttModel: string;
  llmModel: string;
}

export interface DaemonConfig extends KioskConfig {
  accessToken: string;
  recoveryPassphrase: string | null;
  ai: AiConfig;
  port: number;
}

export const daemonConfig: Config.Config<DaemonConfig> = Config.all({
  homeserverUrl: Config.string("KAZIMO_HOMESERVER"),
  userId: Config.string("KAZIMO_USER"),
  deviceId: Config.string("KAZIMO_DEVICE"),
  accessToken: Config.string("KAZIMO_TOKEN"),
  recoveryPassphrase: Config.string("KAZIMO_RECOVERY_PASSPHRASE").pipe(
    Config.option,
    Config.map(Option.getOrNull),
  ),
  roomId: Config.string("KAZIMO_ROOM").pipe(Config.option, Config.map(Option.getOrNull)),
  contacts: Config.string("KAZIMO_CONTACTS").pipe(
    Config.map((raw) =>
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
    Config.option,
    Config.map(Option.getOrNull),
  ),
  mic: Config.string("KAZIMO_MIC").pipe(Config.option, Config.map(Option.getOrNull)),
  lang: Config.withDefault(Config.string("KAZIMO_LANG"), "en"),
  idleReturnSeconds: Config.withDefault(Config.number("KAZIMO_IDLE_RETURN"), 30),
  autoAnswerDelayMs: Config.withDefault(Config.number("KAZIMO_AUTO_ANSWER_MS"), 3000),
  ai: Config.all({
    baseUrl: Config.withDefault(Config.string("KAZIMO_AI_BASE_URL"), AI_BASE_URL_DEFAULT),
    key: Config.string("KAZIMO_AI_KEY").pipe(Config.option, Config.map(Option.getOrNull)),
    sttModel: Config.withDefault(Config.string("KAZIMO_AI_STT_MODEL"), "voxtral-mini-latest"),
    llmModel: Config.withDefault(Config.string("KAZIMO_AI_LLM_MODEL"), "mistral-small-latest"),
  }),
  port: Config.withDefault(Config.number("KAZIMO_PORT"), 8080),
});
