export const DIAL_BAUD_RATE = 115200;
export const DIAL_LABEL_MAX_LENGTH = 24;

export const DIAL_BUTTONS = ["green", "magenta"] as const;
export type DialButton = (typeof DIAL_BUTTONS)[number];

export const DIAL_BUTTON_KINDS = ["press", "release"] as const;
export type DialButtonKind = (typeof DIAL_BUTTON_KINDS)[number];

export type DialEvent =
  | { t: "hello"; fw: string }
  | { t: "wheel"; d: 1 | -1 }
  | { t: "button"; b: DialButton; k: DialButtonKind }
  | { t: "maintenance" }
  | { t: "pong" };

export type DialCommand = { t: "labels"; green: string; magenta: string } | { t: "ping" };

const isDialButton = (value: unknown): value is DialButton =>
  typeof value === "string" && (DIAL_BUTTONS as readonly string[]).includes(value);

const isDialButtonKind = (value: unknown): value is DialButtonKind =>
  typeof value === "string" && (DIAL_BUTTON_KINDS as readonly string[]).includes(value);

export const parseDialEvent = (line: string): DialEvent | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const message = parsed as Record<string, unknown>;
  switch (message.t) {
    case "hello":
      return typeof message.fw === "string" ? { t: "hello", fw: message.fw } : null;
    case "wheel":
      return message.d === 1 || message.d === -1 ? { t: "wheel", d: message.d } : null;
    case "button":
      return isDialButton(message.b) && isDialButtonKind(message.k)
        ? { t: "button", b: message.b, k: message.k }
        : null;
    case "maintenance":
      return { t: "maintenance" };
    case "pong":
      return { t: "pong" };
    default:
      return null;
  }
};

export const encodeDialCommand = (command: DialCommand): string => `${JSON.stringify(command)}\n`;
