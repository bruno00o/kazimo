import { mkdir } from "node:fs/promises";
import { ManagedRuntime } from "effect";
import { Agent } from "../src/agent";
import questions from "./questions.json";

const OUT_DIR = `${process.env.HOME}/.kazimo/bench`;
const OUT_PATH = `${OUT_DIR}/latest.json`;
const QUESTION_PAUSE_MS = 1500;
const RATE_LIMIT_BACKOFF_MS = 65_000;

interface BenchEntry {
  question: string;
  speech: string;
  reports: string[];
  tree: unknown;
  error: string | null;
  ms: number;
}

const runtime = ManagedRuntime.make(Agent.layer);

async function attempt(question: string): Promise<BenchEntry> {
  const started = Date.now();
  const reply = await runtime.runPromise(Agent.use((agent) => agent.ask(question)));
  const screen = await runtime.runPromise(
    Agent.use((agent) => agent.compose(question, reply.reports, reply.speech)),
  );
  return {
    question,
    speech: reply.speech,
    reports: reply.reports,
    tree: screen.tree,
    error: screen.error,
    ms: Date.now() - started,
  };
}

const failed = (question: string, error: unknown, started: number): BenchEntry => ({
  question,
  speech: "",
  reports: [],
  tree: null,
  error: String(error),
  ms: Date.now() - started,
});

const results: BenchEntry[] = [];

for (const [index, question] of questions.entries()) {
  const started = Date.now();
  let entry: BenchEntry;
  try {
    entry = await attempt(question);
  } catch (error) {
    if (String(error).includes("Rate limit")) {
      console.log(`rate limited, waiting ${RATE_LIMIT_BACKOFF_MS / 1000}s before retrying`);
      await Bun.sleep(RATE_LIMIT_BACKOFF_MS);
      entry = await attempt(question).catch((retryError) => failed(question, retryError, started));
    } else {
      entry = failed(question, error, started);
    }
  }
  results.push(entry);
  const outcome = entry.tree ? "tree" : (entry.error ?? "null");
  console.log(`${index + 1}/${questions.length} (${entry.ms}ms) ${question} -> ${outcome}`);
  await Bun.sleep(QUESTION_PAUSE_MS);
}

await mkdir(OUT_DIR, { recursive: true });
await Bun.write(OUT_PATH, JSON.stringify(results, null, 2));
console.log(`wrote ${results.length} results to ${OUT_PATH}`);
await runtime.dispose();
