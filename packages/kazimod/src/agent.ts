import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { Context, Effect, Layer, Redacted } from "effect";
import { type AiError, Chat, LanguageModel, type Prompt } from "effect/unstable/ai";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";
import { type ComposerNode, decodeComposerReply } from "./a2ui";
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
const MAX_COMPOSER_ATTEMPTS = 2;
const MAX_CONVERSATION_EXCHANGES = 10;

const systemPrompt = (lang: string) =>
  `You are Kazimo, a friendly voice assistant for an elderly person. ` +
  `Today's date is ${new Date().toISOString().slice(0, 10)}: anything dated earlier already happened, never present it as upcoming. ` +
  `Answer in the language with BCP 47 code "${lang}". ` +
  `Be brief and warm: one or two spoken sentences, no lists, no markup. ` +
  `If you did not understand what was said, or it sounds like background noise, a stray word or nothing meant for you, simply say you did not catch it and ask them to say it again; never guess a subject or invent a topic, and never bring up health, calls or messages that were not mentioned. ` +
  `Answer from your own knowledge only for timeless facts that cannot have changed, like history, geography or how things work. ` +
  `For anything that can change over time, who currently holds an office or title, the latest news, prices, schedules, weather, results, or whatever the person means by now or current, always call Search first and answer only from what it returns: your memory may predate the change, and a confident wrong answer is the worst outcome. ` +
  `The configured feeds and location are the right ones for the person whatever their language: translate what matters from tool results into the answer language. ` +
  `If no tool covers the question, or a tool reports it is not configured or unreachable, say plainly that you cannot check that, and never improvise an answer from memory. ` +
  `When you answer from search results, state only what the results actually say; if they do not settle the question, say so. ` +
  `Saying you do not know is always a good answer; a confident wrong answer never is. ` +
  `You can reach the family through your tools: Contacts lists who is known, PlaceCall starts a video call, ` +
  `SendMessage sends a written message, ReadMessagesFrom reads back what one person wrote, ShowPhotos puts a photo they sent on the screen. ` +
  `Use these tools directly, without asking permission and without claiming not to know a name before the tool has said so. ` +
  `To send a message: as soon as you have the recipient and the message, even both in one sentence, repeat the message once and ask whether to send it; ` +
  `at the first yes call SendMessage. One confirmation exactly: never a second one, and never re-ask for something already said. ` +
  `The message is always the person's own words: if they have not said what to write, ask what the message should be, and never invent or embellish its content. ` +
  `If a tool reports a name matches nobody, say so instead of guessing. ` +
  `When the person signals they are finished, saying stop, enough, that is all, no thank you or goodbye, call EndChat to close the conversation. ` +
  `Never give medical advice: no diagnosis, no medication guidance, no reassurance about symptoms. ` +
  `If a question touches health, say it is one for a doctor and suggest calling a close family member to talk about it. ` +
  `If the person sounds hurt, unwell or in danger, tell them to call someone for help right now.`;

const composerSystemPrompt = (lang: string) =>
  `You compose the screen shown beside a spoken answer on a device for an elderly person, readable from two meters. ` +
  `Reply with a single JSON object and nothing else: {"tree": <node>} or {"tree": null}. ` +
  `A node is one of: ` +
  `{"kind":"title","text":string} | ` +
  `{"kind":"text","text":string} | ` +
  `{"kind":"number","value":string,"label"?:string} | ` +
  `{"kind":"image","query":string,"caption"?:string} | ` +
  `{"kind":"icon","name":"sun"|"cloud"|"rain"|"snow"|"fog"|"storm"|"wind"|"moon"|"phone"|"message"|"calendar"|"music"} | ` +
  `{"kind":"list","items":string[]} | ` +
  `{"kind":"step","index":number,"text":string} | ` +
  `{"kind":"divider"} | ` +
  `{"kind":"card","children":node[]} | ` +
  `{"kind":"row","children":node[]} | ` +
  `{"kind":"column","children":node[]}. ` +
  `The voice already speaks the answer: never repeat the spoken sentence. ` +
  `The screen carries what is hard to say aloud: a big number, a short list, steps, a date, a name, a picture. ` +
  `Images: add one, at most, when a picture genuinely helps, for a person, a place, a monument, an animal or a plant the answer is about; ` +
  `set query to a short search phrase for that picture, such as the person or place name, never a url. ` +
  `Icons: the sky icons (sun, cloud, rain, snow, fog, storm, wind, moon) are only for weather, one in each weather card; ` +
  `phone, message, calendar and music only for those exact subjects. ` +
  `Never add an icon for decoration or mood: if none of these icons is literally the subject, use no icon. ` +
  `When there are two or three comparable facts, put each in its own small card inside a row rather than one big card. ` +
  `Use very few elements and keep every text short. ` +
  `Write all visible text in the language with BCP 47 code "${lang}". ` +
  `Use {"tree": null} when nothing visual adds value, for example greetings or small talk.`;

const composerRequest = (question: string, reports: string[], speech: string) =>
  `Question: ${question}\n` +
  `Tool reports:\n${reports.length ? reports.join("\n") : "(none)"}\n` +
  `Spoken answer: ${speech}\n` +
  `Compose the screen now.`;

const parseComposerReply = (text: string): ComposerNode | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return decodeComposerReply(JSON.parse(text.slice(start, end + 1))).tree;
};

export interface AgentReply {
  speech: string;
  reports: string[];
  screenClaimed: boolean;
  final: boolean;
}

interface Conversation {
  session: Chat.Service;
  lastUsed: number;
  exchanges: number;
}

export interface ComposedScreen {
  tree: ComposerNode | null;
  error: string | null;
}

export class Agent extends Context.Service<
  Agent,
  {
    ask(question: string): Effect.Effect<AgentReply, AiError.AiError>;
    conversationAlive(): Effect.Effect<boolean>;
    endConversation(): Effect.Effect<void>;
    compose(
      question: string,
      reports: string[],
      speech: string,
    ): Effect.Effect<ComposedScreen, AiError.AiError>;
  }
>()("kazimo/kazimod/Agent") {
  static readonly layer = Layer.effect(
    Agent,
    Effect.gen(function* () {
      const config = yield* daemonConfig;
      const toolkit = yield* AgentToolkit;
      const model = yield* OpenAiLanguageModel.model(config.ai.llmModel).captureRequirements;

      let conversation: Conversation | null = null;

      const liveConversation = (): Conversation | null => {
        if (!conversation) return null;
        const expired =
          Date.now() - conversation.lastUsed >= config.chatTtlMs ||
          conversation.exchanges >= MAX_CONVERSATION_EXCHANGES;
        return expired ? null : conversation;
      };

      const ask = Effect.fn("Agent.ask")(function* (question: string) {
        const kept = liveConversation() ?? {
          session: yield* Chat.fromPrompt([{ role: "system", content: systemPrompt(config.lang) }]),
          lastUsed: Date.now(),
          exchanges: 0,
        };
        conversation = kept;
        const reports: string[] = [];
        let prompt: Prompt.MessageEncoded[] = [{ role: "user", content: [{ type: "text", text: question }] }];
        let speech = "";
        let screenClaimed = false;
        let final = false;
        let ended = false;
        for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
          const response = yield* kept.session.generateText({ prompt, toolkit });
          prompt = [];
          for (const part of response.toolResults) {
            const result = part.result as Record<string, unknown>;
            const report = typeof result.report === "string" ? result.report : JSON.stringify(result);
            reports.push(`${part.name}: ${report}`);
            if (result.screen === true) screenClaimed = true;
            if (result.done === true) final = true;
            if (result.end === true) ended = true;
          }
          if (response.toolCalls.length === 0) {
            speech = response.text;
            break;
          }
        }
        kept.lastUsed = Date.now();
        kept.exchanges += 1;
        if (ended) conversation = null;
        return { speech, reports, screenClaimed, final };
      }, Effect.provide(model));

      const conversationAlive = () => Effect.sync(() => liveConversation() !== null);

      const endConversation = () =>
        Effect.sync(() => {
          conversation = null;
        });

      const compose = Effect.fn("Agent.compose")(function* (
        question: string,
        reports: string[],
        speech: string,
      ) {
        const languageModel = yield* LanguageModel.LanguageModel;
        const messages: Prompt.MessageEncoded[] = [
          { role: "system", content: composerSystemPrompt(config.lang) },
          { role: "user", content: [{ type: "text", text: composerRequest(question, reports, speech) }] },
        ];
        let lastError = "empty reply";
        for (let attempt = 0; attempt < MAX_COMPOSER_ATTEMPTS; attempt++) {
          const response = yield* languageModel.generateText({ prompt: messages });
          try {
            const tree = parseComposerReply(response.text);
            return { tree, error: null };
          } catch (error) {
            lastError = String(error);
            messages.push(
              { role: "assistant", content: [{ type: "text", text: response.text }] },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `That reply was invalid: ${lastError}. Reply again with only a valid JSON object.`,
                  },
                ],
              },
            );
          }
        }
        return { tree: null, error: lastError };
      }, Effect.provide(model));

      return Agent.of({ ask, conversationAlive, endConversation, compose });
    }),
  ).pipe(Layer.provide([AgentToolkitLayer, clientLayer]));
}
