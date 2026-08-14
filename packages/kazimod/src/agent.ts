import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { Context, Effect, Layer, Redacted } from "effect";
import { type AiError, Chat } from "effect/unstable/ai";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { daemonConfig } from "./config";
import { AgentToolkit, AgentToolkitLayer } from "./tools";

const withoutNullToolCalls = (text: string): string => {
  const completion = JSON.parse(text) as { choices?: Array<{ message?: { tool_calls?: unknown } }> };
  for (const choice of completion.choices ?? []) {
    if (choice.message && choice.message.tool_calls === null) delete choice.message.tool_calls;
  }
  return JSON.stringify(completion);
};

const mistralToolCallsShim = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  HttpClient.transform(client, (effect, request) => {
    if (!request.url.endsWith("/chat/completions")) return effect;
    return Effect.flatMap(effect, (response) => {
      if (!response.headers["content-type"]?.includes("application/json")) {
        return Effect.succeed(response);
      }
      return Effect.map(response.text, (text) =>
        HttpClientResponse.fromWeb(
          request,
          new Response(text.includes('"tool_calls"') ? withoutNullToolCalls(text) : text, {
            status: response.status,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    });
  });

const clientLayer = Layer.unwrap(
  Effect.map(daemonConfig, (config) =>
    OpenAiClient.layer({
      apiUrl: config.ai.baseUrl,
      apiKey: config.ai.key ? Redacted.make(config.ai.key) : undefined,
      transformClient: mistralToolCallsShim,
    }),
  ),
).pipe(Layer.provide(FetchHttpClient.layer));

const MAX_AGENT_TURNS = 5;

const systemPrompt = (lang: string) =>
  `You are Kazimo, a friendly voice assistant for an elderly person. ` +
  `Today's date is ${new Date().toISOString().slice(0, 10)}: anything dated earlier already happened, never present it as upcoming. ` +
  `Answer in the language with BCP 47 code "${lang}". ` +
  `Be brief and warm: one or two spoken sentences, no lists, no markup. ` +
  `Only state facts you are certain of or that come from a tool result; sharing stable general knowledge you are sure of is fine. ` +
  `For live information such as weather or news, always use your tools. ` +
  `The configured feeds and location are the right ones for the person whatever their language: translate what matters from tool results into the answer language. ` +
  `If no tool covers the question, or a tool reports it is not configured or unreachable, say plainly that you cannot check that, and never improvise an answer from memory. ` +
  `When you answer from search results, state only what the results actually say; if they do not settle the question, say so. ` +
  `Saying you do not know is always a good answer; a confident wrong answer never is. ` +
  `Never give medical advice: no diagnosis, no medication guidance, no reassurance about symptoms. ` +
  `If a question touches health, say it is one for a doctor and suggest calling a close family member to talk about it. ` +
  `If the person sounds hurt, unwell or in danger, tell them to call someone for help right now.`;

export class Agent extends Context.Service<
  Agent,
  {
    ask(question: string): Effect.Effect<string, AiError.AiError>;
  }
>()("kazimo/kazimod/Agent") {
  static readonly layer = Layer.effect(
    Agent,
    Effect.gen(function* () {
      const config = yield* daemonConfig;
      const toolkit = yield* AgentToolkit;
      const model = yield* OpenAiLanguageModel.model(config.ai.llmModel).captureRequirements;

      const ask = Effect.fn("Agent.ask")(function* (question: string) {
        const session = yield* Chat.fromPrompt([
          { role: "system", content: systemPrompt(config.lang) },
          { role: "user", content: [{ type: "text", text: question }] },
        ]);
        for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
          const response = yield* session.generateText({ prompt: [], toolkit });
          if (response.toolCalls.length === 0) return response.text;
        }
        return "";
      }, Effect.provide(model));

      return Agent.of({ ask });
    }),
  ).pipe(Layer.provide([AgentToolkitLayer, clientLayer]));
}
