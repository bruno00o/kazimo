export const tokens = {
  theme: {
    dark: {
      ground: "#131314",
      ink: "#e8eaed",
      inkSoft: "rgba(232, 234, 237, 0.75)",
      inkFaint: "rgba(232, 234, 237, 0.4)",
      glow: "rgba(66, 133, 244, 0.14)",
    },
    light: {
      ground: "#ffffff",
      ink: "#1f1f1f",
      inkSoft: "#5f6368",
      inkFaint: "#9aa0a6",
      glow: "rgba(66, 133, 244, 0.3)",
    },
  },
  color: {
    blue: "#1a73e8",
    blueDeep: "#0b57d0",
    blueSoft: "#d3e3fd",
    danger: "#d93025",
    dangerSoft: "#f28b82",
    shadow: "0 4px 30px rgba(0, 0, 0, 0.18)",
  },
  font: {
    sans: "'Outfit', system-ui, sans-serif",
  },
  type: {
    hero: "24vh",
    name: "11vh",
    title: "7vh",
    body: "5.5vh",
    caption: "3.4vh",
    hint: "2vh",
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  radius: {
    card: "3.5vh",
    pill: "999px",
    round: "50%",
  },
  fade: {
    inMs: 1000,
    outMs: 5000,
  },
  breath: {
    idleMs: 9000,
    callMs: 2600,
  },
} as const;

export type Tokens = typeof tokens;
