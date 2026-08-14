import type { KioskConfig } from "@kazimo/shared";
import { Config, Option } from "effect";

export interface DaemonConfig extends KioskConfig {
  accessToken: string;
  recoveryPassphrase: string | null;
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
  port: Config.withDefault(Config.number("KAZIMO_PORT"), 8080),
});
