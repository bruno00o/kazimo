import { FRAME_SAMPLES, type WakeModels } from "./wake";

const FRAME_MS = 80;
const VAD_CHUNK_MS = 32;
const VAD_SPEECH_PROB = 0.5;
const DEBOUNCE_FRAMES = 2;
const PREROLL_FRAMES = 4;
const SILENCE_CLOSE_MS = 800;
const NO_SPEECH_ABORT_MS = 4000;
const MAX_WINDOW_MS = 10_000;
const REFRACTORY_FRAMES = 25;
const BACKLOG_MAX_FRAMES = 25;

export interface ListenerCallbacks {
  onWake(): void;
  onUtterance(frames: Uint8Array[]): void;
}

export interface Listener {
  push(frame: Uint8Array): void;
  forceStart(): void;
  forceEnd(): void;
  setSuppressed(suppressed: boolean): void;
}

export function createListener(
  models: WakeModels,
  threshold: number,
  callbacks: ListenerCallbacks,
): Listener {
  const detector = models.createDetector();
  const vad = models.createVad();

  let mode: "watching" | "capturing" | "forced" = "watching";
  let suppressed = false;
  let consecutive = 0;
  let refractory = 0;
  const preroll: Uint8Array[] = [];
  let window: Uint8Array[] = [];
  let windowMs = 0;
  let silenceMs = 0;
  let speechSeen = false;

  let queue = Promise.resolve();
  let backlog = 0;

  const closeWindow = (emit: boolean) => {
    const frames = window;
    window = [];
    mode = "watching";
    consecutive = 0;
    refractory = REFRACTORY_FRAMES;
    if (emit) callbacks.onUtterance(frames);
  };

  const openWindow = () => {
    mode = "capturing";
    window = [...preroll];
    windowMs = window.length * FRAME_MS;
    silenceMs = 0;
    speechSeen = false;
    vad.reset();
    callbacks.onWake();
  };

  const watch = async (frame: Uint8Array, samples: Int16Array) => {
    preroll.push(frame);
    if (preroll.length > PREROLL_FRAMES) preroll.shift();
    const score = await detector.feed(samples);
    if (refractory > 0) {
      refractory -= 1;
      return;
    }
    if (suppressed) {
      consecutive = 0;
      return;
    }
    consecutive = score >= threshold ? consecutive + 1 : 0;
    if (consecutive >= DEBOUNCE_FRAMES) openWindow();
  };

  const capture = async (frame: Uint8Array, samples: Int16Array) => {
    window.push(frame);
    windowMs += FRAME_MS;
    const [, probs] = await Promise.all([detector.feed(samples), vad.feed(samples)]);
    for (const prob of probs) {
      if (prob >= VAD_SPEECH_PROB) {
        speechSeen = true;
        silenceMs = 0;
      } else {
        silenceMs += VAD_CHUNK_MS;
      }
    }
    if (speechSeen && silenceMs >= SILENCE_CLOSE_MS) closeWindow(true);
    else if (windowMs >= MAX_WINDOW_MS) closeWindow(speechSeen);
    else if (!speechSeen && windowMs >= NO_SPEECH_ABORT_MS) closeWindow(false);
  };

  const process = async (frame: Uint8Array) => {
    const samples = new Int16Array(frame.buffer, frame.byteOffset, FRAME_SAMPLES);
    if (mode === "watching") await watch(frame, samples);
    else if (mode === "capturing") await capture(frame, samples);
    else {
      window.push(frame);
      await detector.feed(samples);
    }
  };

  const enqueue = (step: () => void | Promise<void>) => {
    queue = queue.then(step).catch(() => {});
  };

  return {
    push(frame) {
      if (frame.byteLength !== FRAME_SAMPLES * 2 || backlog >= BACKLOG_MAX_FRAMES) return;
      const copy = frame.slice();
      backlog += 1;
      queue = queue
        .then(() => process(copy))
        .catch(() => {})
        .finally(() => {
          backlog -= 1;
        });
    },
    forceStart() {
      enqueue(() => {
        mode = "forced";
        window = [];
      });
    },
    forceEnd() {
      enqueue(() => {
        if (mode !== "forced") return;
        const frames = window;
        window = [];
        mode = "watching";
        consecutive = 0;
        refractory = PREROLL_FRAMES;
        callbacks.onUtterance(frames);
      });
    },
    setSuppressed(value) {
      suppressed = value;
      if (value) consecutive = 0;
    },
  };
}
