import { CAPTURE_SAMPLE_RATE } from "@kazimo/shared";
import { InferenceSession, Tensor } from "onnxruntime-node";

export const FRAME_SAMPLES = 1280;
const MELSPEC_CONTEXT_SAMPLES = 480;
const MELSPEC_INPUT_SAMPLES = FRAME_SAMPLES + MELSPEC_CONTEXT_SAMPLES;
const MEL_BINS = 32;
const MEL_FRAMES_PER_CHUNK = 8;
const EMBEDDING_WINDOW_MELS = 76;
const EMBEDDING_DIM = 96;
const WAKE_WINDOW_EMBEDDINGS = 16;
const WARMUP_CHUNKS = WAKE_WINDOW_EMBEDDINGS;

const VAD_CHUNK = 512;
const VAD_CONTEXT = 64;
const VAD_STATE_DIMS = [2, 1, 128] as const;
const VAD_STATE_SIZE = 2 * 1 * 128;
const INT16_SCALE = 32768;

const MODELS_DIR = new URL("../models/", import.meta.url).pathname;

export const defaultWakeModelPath = `${MODELS_DIR}kazimo.onnx`;

export interface WakeModels {
  createDetector(): WakeDetector;
  createVad(): VadStream;
}

export interface WakeDetector {
  feed(frame: Int16Array): Promise<number>;
}

export interface VadStream {
  feed(frame: Int16Array): Promise<number[]>;
  reset(): void;
}

const singleInput = (session: InferenceSession, data: Float32Array, dims: number[]) => ({
  [session.inputNames[0] ?? "input"]: new Tensor("float32", data, dims),
});

const singleOutput = (session: InferenceSession, results: InferenceSession.OnnxValueMapType) =>
  (results[session.outputNames[0] ?? "output"] as Tensor).data as Float32Array;

export async function loadWakeModels(wakeModelPath: string): Promise<WakeModels> {
  const [melspec, embedding, wake, vad] = await Promise.all([
    InferenceSession.create(`${MODELS_DIR}melspectrogram.onnx`),
    InferenceSession.create(`${MODELS_DIR}embedding_model.onnx`),
    InferenceSession.create(wakeModelPath),
    InferenceSession.create(`${MODELS_DIR}silero_vad.onnx`),
  ]);

  const createDetector = (): WakeDetector => {
    const rawTail = new Float32Array(MELSPEC_INPUT_SAMPLES);
    const melBuffer = new Float32Array(EMBEDDING_WINDOW_MELS * MEL_BINS).fill(1);
    const featureBuffer = new Float32Array(WAKE_WINDOW_EMBEDDINGS * EMBEDDING_DIM);
    let chunks = 0;

    return {
      async feed(frame) {
        rawTail.copyWithin(0, FRAME_SAMPLES);
        for (let i = 0; i < FRAME_SAMPLES; i++) {
          rawTail[MELSPEC_CONTEXT_SAMPLES + i] = frame[i] ?? 0;
        }

        const melOut = await melspec.run(singleInput(melspec, rawTail.slice(), [1, MELSPEC_INPUT_SAMPLES]));
        const newMels = singleOutput(melspec, melOut);
        melBuffer.copyWithin(0, MEL_FRAMES_PER_CHUNK * MEL_BINS);
        const melOffset = (EMBEDDING_WINDOW_MELS - MEL_FRAMES_PER_CHUNK) * MEL_BINS;
        for (let i = 0; i < MEL_FRAMES_PER_CHUNK * MEL_BINS; i++) {
          melBuffer[melOffset + i] = (newMels[i] ?? 0) / 10 + 2;
        }

        const embeddingOut = await embedding.run(
          singleInput(embedding, melBuffer.slice(), [1, EMBEDDING_WINDOW_MELS, MEL_BINS, 1]),
        );
        featureBuffer.copyWithin(0, EMBEDDING_DIM);
        featureBuffer.set(
          singleOutput(embedding, embeddingOut).subarray(0, EMBEDDING_DIM),
          (WAKE_WINDOW_EMBEDDINGS - 1) * EMBEDDING_DIM,
        );

        const wakeOut = await wake.run(
          singleInput(wake, featureBuffer.slice(), [1, WAKE_WINDOW_EMBEDDINGS, EMBEDDING_DIM]),
        );
        const score = singleOutput(wake, wakeOut)[0] ?? 0;
        chunks += 1;
        return chunks <= WARMUP_CHUNKS ? 0 : score;
      },
    };
  };

  const createVad = (): VadStream => {
    let state: Tensor = new Tensor("float32", new Float32Array(VAD_STATE_SIZE), [...VAD_STATE_DIMS]);
    const sr = new Tensor("int64", BigInt64Array.from([BigInt(CAPTURE_SAMPLE_RATE)]), []);
    let pending = new Float32Array(0);
    let context = new Float32Array(VAD_CONTEXT);

    return {
      async feed(frame) {
        const merged = new Float32Array(pending.length + frame.length);
        merged.set(pending);
        for (let i = 0; i < frame.length; i++) {
          merged[pending.length + i] = (frame[i] ?? 0) / INT16_SCALE;
        }

        const probs: number[] = [];
        let offset = 0;
        while (offset + VAD_CHUNK <= merged.length) {
          const input = new Float32Array(VAD_CONTEXT + VAD_CHUNK);
          input.set(context);
          input.set(merged.subarray(offset, offset + VAD_CHUNK), VAD_CONTEXT);
          const out = await vad.run({
            input: new Tensor("float32", input, [1, VAD_CONTEXT + VAD_CHUNK]),
            state,
            sr,
          });
          probs.push(((out.output as Tensor).data as Float32Array)[0] ?? 0);
          state = out.stateN as Tensor;
          context = merged.slice(offset + VAD_CHUNK - VAD_CONTEXT, offset + VAD_CHUNK);
          offset += VAD_CHUNK;
        }
        pending = merged.slice(offset);
        return probs;
      },
      reset() {
        state = new Tensor("float32", new Float32Array(VAD_STATE_SIZE), [...VAD_STATE_DIMS]);
        pending = new Float32Array(0);
        context = new Float32Array(VAD_CONTEXT);
      },
    };
  };

  return { createDetector, createVad };
}
