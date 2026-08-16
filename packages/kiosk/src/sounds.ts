const G4 = 392;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;

const RING_INTERVAL_MS = 2600;
const HARMONICS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [2, 0.18],
  [3, 0.06],
];

let context: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;

const audio = (): AudioContext => {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
};

const tone = (frequency: number, delayS: number, durationS: number, peak: number) => {
  const ctx = audio();
  const start = ctx.currentTime + delayS;
  for (const [ratio, level] of HARMONICS) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency * ratio;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak * level, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationS);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationS + 0.1);
  }
};

const ringMotif = () => {
  tone(G4, 0, 1.4, 0.1);
  tone(C5, 0.4, 1.6, 0.1);
};

export const startRinging = () => {
  if (ringTimer) return;
  ringMotif();
  ringTimer = setInterval(ringMotif, RING_INTERVAL_MS);
};

export const stopRinging = () => {
  if (!ringTimer) return;
  clearInterval(ringTimer);
  ringTimer = null;
};

export const playConnected = () => {
  tone(C5, 0, 0.5, 0.08);
  tone(E5, 0.16, 0.7, 0.08);
};

export const playEnded = () => {
  tone(E5, 0, 0.5, 0.08);
  tone(C5, 0.16, 0.8, 0.08);
};

export const playMessage = () => {
  tone(G5, 0, 1.2, 0.07);
  tone(D5, 0.12, 1.6, 0.05);
};

export const playWake = () => {
  tone(E5, 0, 0.3, 0.07);
  tone(G5, 0.1, 0.4, 0.07);
};
