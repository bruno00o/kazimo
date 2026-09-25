import type { Presence } from "@kazimo/shared";

export const attended = (night: boolean, presence: Presence): boolean => !night && presence !== "absent";

export const mayAutoAnswer = attended;

export const mayInterrupt = attended;

export const screenAsleep = (night: boolean, presence: Presence): boolean => !attended(night, presence);
