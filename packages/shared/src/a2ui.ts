export type A2uiNode =
  | { kind: "title"; text: string }
  | { kind: "text"; text: string }
  | { kind: "number"; value: string; label?: string }
  | { kind: "image"; url: string; caption?: string }
  | { kind: "list"; items: string[] }
  | { kind: "step"; index: number; text: string }
  | { kind: "divider" }
  | { kind: "card"; children: A2uiNode[] }
  | { kind: "row"; children: A2uiNode[] }
  | { kind: "column"; children: A2uiNode[] };
