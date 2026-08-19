export const A2UI_ICONS = [
  "sun",
  "cloud",
  "rain",
  "snow",
  "fog",
  "storm",
  "wind",
  "moon",
  "phone",
  "message",
  "calendar",
  "music",
] as const;

export type A2uiIcon = (typeof A2UI_ICONS)[number];

export type A2uiNode =
  | { kind: "title"; text: string }
  | { kind: "text"; text: string }
  | { kind: "number"; value: string; label?: string }
  | { kind: "image"; url: string; caption?: string }
  | { kind: "icon"; name: A2uiIcon }
  | { kind: "list"; items: string[] }
  | { kind: "step"; index: number; text: string }
  | { kind: "divider" }
  | { kind: "card"; children: A2uiNode[] }
  | { kind: "row"; children: A2uiNode[] }
  | { kind: "column"; children: A2uiNode[] };
