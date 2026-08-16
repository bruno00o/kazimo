import type { KioskConfig } from "@kazimo/shared";
import { Config, Option } from "effect";

export interface AiConfig {
  baseUrl: string;
  key: string | null;
  sttModel: string;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string | null;
  ttsRef: string | null;
}

export interface AgentConfig {
  latitude: number | null;
  longitude: number | null;
  place: string | null;
  newsFeeds: string[] | null;
  searchUrl: string;
  searchKey: string | null;
}

export interface WakeConfig {
  modelPath: string | null;
  threshold: number;
}

export interface DaemonConfig extends KioskConfig {
  accessToken: string;
  recoveryPassphrase: string | null;
  ai: AiConfig;
  agent: AgentConfig;
  wake: WakeConfig;
  port: number;
}

const optionalString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.getOrNull));

const optionalNumber = (name: string) =>
  Config.number(name).pipe(Config.option, Config.map(Option.getOrNull));

const optionalStringList = (name: string) =>
  Config.string(name).pipe(
    Config.map((raw) =>
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
    Config.option,
    Config.map(Option.getOrNull),
  );

export const daemonConfig: Config.Config<DaemonConfig> = Config.all({
  homeserverUrl: Config.string("KAZIMO_HOMESERVER"),
  userId: Config.string("KAZIMO_USER"),
  deviceId: Config.string("KAZIMO_DEVICE"),
  accessToken: Config.string("KAZIMO_TOKEN"),
  recoveryPassphrase: optionalString("KAZIMO_RECOVERY_PASSPHRASE"),
  roomId: optionalString("KAZIMO_ROOM"),
  contacts: optionalStringList("KAZIMO_CONTACTS"),
  mic: optionalString("KAZIMO_MIC"),
  lang: Config.withDefault(Config.string("KAZIMO_LANG"), "en"),
  idleReturnSeconds: Config.withDefault(Config.number("KAZIMO_IDLE_RETURN"), 30),
  autoAnswerDelayMs: Config.withDefault(Config.number("KAZIMO_AUTO_ANSWER_MS"), 3000),
  ai: Config.all({
    baseUrl: Config.withDefault(Config.string("KAZIMO_AI_BASE_URL"), "https://api.mistral.ai/v1"),
    key: optionalString("KAZIMO_AI_KEY"),
    sttModel: Config.withDefault(Config.string("KAZIMO_AI_STT_MODEL"), "voxtral-mini-latest"),
    llmModel: Config.withDefault(Config.string("KAZIMO_AI_LLM_MODEL"), "mistral-small-latest"),
    ttsModel: Config.withDefault(Config.string("KAZIMO_AI_TTS_MODEL"), "voxtral-mini-tts-latest"),
    ttsVoice: optionalString("KAZIMO_AI_TTS_VOICE"),
    ttsRef: optionalString("KAZIMO_AI_TTS_REF"),
  }),
  agent: Config.all({
    latitude: optionalNumber("KAZIMO_LATITUDE"),
    longitude: optionalNumber("KAZIMO_LONGITUDE"),
    place: optionalString("KAZIMO_PLACE"),
    newsFeeds: optionalStringList("KAZIMO_NEWS_FEEDS"),
    searchUrl: Config.withDefault(Config.string("KAZIMO_SEARCH_URL"), "https://api.tavily.com/search"),
    searchKey: optionalString("KAZIMO_SEARCH_KEY"),
  }),
  wake: Config.all({
    modelPath: optionalString("KAZIMO_WAKE_MODEL"),
    threshold: Config.withDefault(Config.number("KAZIMO_WAKE_THRESHOLD"), 0.5),
  }),
  port: Config.withDefault(Config.number("KAZIMO_PORT"), 8080),
});
