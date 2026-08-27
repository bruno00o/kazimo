import { isRingDeviceToken, type KioskConfig, RING_MAX_DEVICE_TOKENS } from "@kazimo/shared";
import { Config, Option } from "effect";
import { generatePairingCode } from "./pairing";

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

export interface RingConfig {
  url: string;
  token: string;
  callerName: string;
  deviceTokens: Record<string, string[]>;
}

export interface WakeConfig {
  modelPath: string | null;
  threshold: number;
  captureRmsMin: number;
}

export interface DaemonConfig extends KioskConfig {
  accessToken: string;
  recoveryPassphrase: string | null;
  ai: AiConfig;
  agent: AgentConfig;
  wake: WakeConfig;
  ring: RingConfig | null;
  dialPort: string | null;
  chatTtlMs: number;
  followupWindowMs: number;
  port: number;
}

const optionalString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.getOrNull));

const optionalNumber = (name: string) =>
  Config.number(name).pipe(Config.option, Config.map(Option.getOrNull));

const DEFAULT_NIGHT = { start: 22, end: 7 };

const nightWindow = Config.string("KAZIMO_NIGHT").pipe(
  Config.withDefault(`${DEFAULT_NIGHT.start}-${DEFAULT_NIGHT.end}`),
  Config.map((raw) => {
    const [start, end] = raw.split("-").map((part) => Number.parseInt(part.trim(), 10));
    const valid = (h: number | undefined): h is number => h !== undefined && h >= 0 && h <= 23;
    return valid(start) && valid(end) ? { start, end } : DEFAULT_NIGHT;
  }),
);

const BOOT_PAIRING_CODE = generatePairingCode();

const pairing: Config.Config<{ code: string } | null> = Config.string("KAZIMO_PAIRING").pipe(
  Config.withDefault("on"),
  Config.map((mode) => (mode.trim().toLowerCase() === "off" ? null : { code: BOOT_PAIRING_CODE })),
);

const deviceTokenTable = (raw: string): Record<string, string[]> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const table: Record<string, string[]> = {};
  for (const [userId, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    const tokens = value.filter(isRingDeviceToken).slice(0, RING_MAX_DEVICE_TOKENS);
    if (tokens.length > 0) table[userId] = tokens;
  }
  return table;
};

const ring: Config.Config<RingConfig | null> = Config.all({
  url: Config.string("KAZIMO_RING_URL"),
  token: Config.string("KAZIMO_RING_TOKEN"),
  callerName: Config.string("KAZIMO_RING_CALLER"),
  deviceTokens: Config.string("KAZIMO_RING_DEVICES").pipe(
    Config.withDefault(""),
    Config.map(deviceTokenTable),
  ),
}).pipe(Config.option, Config.map(Option.getOrNull));

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
  nightStartHour: nightWindow.pipe(Config.map((window) => window.start)),
  nightEndHour: nightWindow.pipe(Config.map((window) => window.end)),
  pairing,
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
    captureRmsMin: Config.withDefault(Config.number("KAZIMO_CAPTURE_RMS_MIN"), 130),
  }),
  ring,
  dialPort: optionalString("KAZIMO_DIAL_PORT"),
  chatTtlMs: Config.withDefault(Config.number("KAZIMO_CHAT_TTL"), 180).pipe(
    Config.map((seconds) => seconds * 1000),
  ),
  followupWindowMs: Config.withDefault(Config.number("KAZIMO_FOLLOWUP_WINDOW"), 8).pipe(
    Config.map((seconds) => seconds * 1000),
  ),
  port: Config.withDefault(Config.number("KAZIMO_PORT"), 8080),
});
