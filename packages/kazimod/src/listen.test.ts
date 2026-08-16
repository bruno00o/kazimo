import { describe, expect, test } from "bun:test";
import { createListener } from "./listen";
import type { WakeModels } from "./wake";

const FRAME_BYTES = 1280 * 2;
const VAD_PROBS_PER_FRAME = 2;

interface Script {
  scores: number[];
  speechFrames: Set<number>;
}

function stubModels(script: Script): WakeModels {
  let scoreIndex = 0;
  let vadIndex = 0;
  return {
    createDetector: () => ({
      feed: async () => script.scores[scoreIndex++] ?? 0,
    }),
    createVad: () => ({
      feed: async () => {
        const frame = vadIndex++;
        const prob = script.speechFrames.has(frame) ? 0.9 : 0.1;
        return Array(VAD_PROBS_PER_FRAME).fill(prob);
      },
      reset: () => {},
    }),
  };
}

function frame(fill: number): Uint8Array {
  return new Uint8Array(FRAME_BYTES).fill(fill);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run(script: Script, frameCount: number) {
  const wakes: number[] = [];
  const utterances: Uint8Array[][] = [];
  const listener = createListener(stubModels(script), 0.5, {
    onWake: () => wakes.push(1),
    onUtterance: (frames) => utterances.push(frames),
  });
  for (let i = 0; i < frameCount; i++) {
    listener.push(frame(i % 256));
    await flush();
  }
  return { wakes, utterances, listener };
}

describe("createListener", () => {
  test("fires wake after two consecutive frames above threshold and includes preroll", async () => {
    const scores = [0, 0, 0, 0, 0, 0.9, 0.9];
    const speech = new Set([0, 1, 2]);
    const { wakes, utterances } = await run({ scores, speechFrames: speech }, 40);
    expect(wakes.length).toBe(1);
    expect(utterances.length).toBe(1);
    expect(utterances[0]?.length).toBeGreaterThanOrEqual(4);
  });

  test("a single frame above threshold does not wake", async () => {
    const scores = [0, 0.9, 0, 0, 0.9, 0];
    const { wakes } = await run({ scores, speechFrames: new Set() }, 20);
    expect(wakes.length).toBe(0);
  });

  test("aborts a window with no speech", async () => {
    const scores = [0, 0, 0.9, 0.9];
    const { wakes, utterances } = await run({ scores, speechFrames: new Set() }, 80);
    expect(wakes.length).toBe(1);
    expect(utterances.length).toBe(0);
  });

  test("push to talk collects frames and emits on end", async () => {
    const listener = createListener(stubModels({ scores: [], speechFrames: new Set() }), 0.5, {
      onWake: () => {},
      onUtterance: (frames) => {
        expect(frames.length).toBe(3);
      },
    });
    listener.forceStart();
    listener.push(frame(1));
    listener.push(frame(2));
    listener.push(frame(3));
    await flush();
    listener.forceEnd();
    await flush();
  });

  test("suppression blocks wake detection", async () => {
    const wakes: number[] = [];
    const listener = createListener(
      stubModels({ scores: Array(30).fill(0.9), speechFrames: new Set() }),
      0.5,
      { onWake: () => wakes.push(1), onUtterance: () => {} },
    );
    listener.setSuppressed(true);
    for (let i = 0; i < 10; i++) {
      listener.push(frame(i));
      await flush();
    }
    expect(wakes.length).toBe(0);
  });

  test("ignores frames with unexpected size", async () => {
    const wakes: number[] = [];
    const listener = createListener(
      stubModels({ scores: Array(10).fill(0.9), speechFrames: new Set() }),
      0.5,
      { onWake: () => wakes.push(1), onUtterance: () => {} },
    );
    for (let i = 0; i < 10; i++) {
      listener.push(new Uint8Array(100));
      await flush();
    }
    expect(wakes.length).toBe(0);
  });
});
