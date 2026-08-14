import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { type AiError, Chat, Tool, Toolkit } from "effect/unstable/ai";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { AI_BASE_URL_DEFAULT, daemonConfig } from "./config";

const CurrentTime = Tool.make("CurrentTime", {
  description: "Get the current date and time",
  success: Schema.Struct({
    iso: Schema.String,
    timeZone: Schema.String,
  }),
});

const AgentToolkit = Toolkit.make(CurrentTime);

const AgentToolkitLayer = AgentToolkit.toLayer(
  Effect.sync(() =>
    AgentToolkit.of({
      CurrentTime: () =>
        Effect.sync(() => ({
          iso: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })),
    }),
  ),
);

const stripNullToolCalls = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  HttpClient.transform(client, (effect, request) =>
    Effect.flatMap(effect, (response) => {
      if (!response.headers["content-type"]?.includes("application/json")) {
        return Effect.succeed(response);
      }
      return Effect.map(response.json, (body) => {
        const completion = body as { choices?: Array<{ message?: { tool_calls?: unknown } }> };
        for (const choice of completion.choices ?? []) {
          if (choice.message && choice.message.tool_calls === null) delete choice.message.tool_calls;
        }
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(body), {
            status: response.status,
            headers: { "content-type": "application/json" },
          }),
        );
      });
    }),
  );

const clientLayer = OpenAiClient.layerConfig({
  apiUrl: Config.withDefault(Config.string("KAZIMO_AI_BASE_URL"), AI_BASE_URL_DEFAULT),
  apiKey: Config.redacted("KAZIMO_AI_KEY").pipe(Config.option, Config.map(Option.getOrUndefined)),
  transformClient: stripNullToolCalls,
}).pipe(Layer.provide(FetchHttpClient.layer));

const MAX_AGENT_TURNS = 5;

const systemPrompt = (lang: string) =>
  `You are Kazimo, a friendly voice assistant for an elderly person. ` +
  `Answer in the language with BCP 47 code "${lang}". ` +
  `Be brief and warm: one or two spoken sentences, no lists, no markup. ` +
  `If you do not know something, say so plainly.`;

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
