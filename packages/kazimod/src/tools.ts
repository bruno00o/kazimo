import type { ActivitySummary } from "@kazimo/shared";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { KioskBridge } from "./bridge";
import { type AgentConfig, daemonConfig } from "./config";

const FETCH_TIMEOUT_MS = 5000;
const HEADLINES_PER_FEED = 20;

const WMO_CONDITIONS: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "dense drizzle",
  56: "freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "rain showers",
  82: "violent rain showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

const conditionText = (code: number) => WMO_CONDITIONS[code] ?? `weather code ${code}`;

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    temperature_2m_min: number[];
    temperature_2m_max: number[];
    weather_code: number[];
    precipitation_probability_max: number[];
  };
}

const dayLine = (label: string, daily: OpenMeteoResponse["daily"], index: number) =>
  `${label}: ${Math.round(daily.temperature_2m_min[index] ?? 0)} to ` +
  `${Math.round(daily.temperature_2m_max[index] ?? 0)}C, ` +
  `${conditionText(daily.weather_code[index] ?? -1)}, ` +
  `${daily.precipitation_probability_max[index] ?? 0}% chance of rain.`;

interface GeocodingResponse {
  results?: Array<{ name: string; latitude: number; longitude: number; country?: string }>;
}

async function geocode(place: string, lang: string) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", place);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", lang.split("-")[0] ?? lang);
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`geocoding failed (${res.status})`);
  const data = (await res.json()) as GeocodingResponse;
  return data.results?.[0] ?? null;
}

async function weatherReport(agent: AgentConfig, lang: string, place?: string): Promise<string> {
  let latitude = agent.latitude;
  let longitude = agent.longitude;
  let where = agent.place ? ` in ${agent.place}` : "";
  if (place) {
    const found = await geocode(place, lang);
    if (!found) return `No place called "${place}" could be found.`;
    latitude = found.latitude;
    longitude = found.longitude;
    where = ` in ${found.name}${found.country ? `, ${found.country}` : ""}`;
  }
  if (latitude === null || longitude === null) {
    return "Weather is not configured on this device (no location set).";
  }
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,wind_speed_10m");
  url.searchParams.set(
    "daily",
    "temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max",
  );
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`open-meteo failed (${res.status})`);
  const data = (await res.json()) as OpenMeteoResponse;
  return [
    `Weather${where} now: ${Math.round(data.current.temperature_2m)}C ` +
      `(feels like ${Math.round(data.current.apparent_temperature)}C), ` +
      `${conditionText(data.current.weather_code)}, ` +
      `wind ${Math.round(data.current.wind_speed_10m)} km/h.`,
    dayLine("Today", data.daily, 0),
    dayLine("Tomorrow", data.daily, 1),
  ].join(" ");
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeXml = (text: string) =>
  text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => XML_ENTITIES[name] ?? "");

const firstTitle = (xml: string) => {
  const match = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  const title = match?.[1] ? decodeXml(match[1].trim()) : null;
  return title || null;
};

export const itemImage = (itemXml: string): string | null => {
  const match =
    itemXml.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image\/[^"]*"/) ??
    itemXml.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+\.(?:jpe?g|png|webp|gif)[^"]*)"/i) ??
    itemXml.match(/<media:(?:content|thumbnail)[^>]*medium="image"[^>]*url="([^"]+)"/) ??
    itemXml.match(/<img[^>]*src="([^"]+)"/);
  return match?.[1] ? decodeXml(match[1]) : null;
};

async function feedHeadlines(url: string): Promise<string[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`feed failed (${res.status})`);
  const xml = await res.text();
  const source = firstTitle(xml) ?? new URL(url).hostname;
  const items = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/g) ?? [];
  return items
    .map((item) => {
      const title = firstTitle(item);
      if (!title) return null;
      const image = itemImage(item);
      return `[${source}] ${title}${image ? ` (image: ${image})` : ""}`;
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, HEADLINES_PER_FEED);
}

async function newsReport(agent: AgentConfig): Promise<string> {
  if (!agent.newsFeeds || agent.newsFeeds.length === 0) {
    return "News is not configured on this device (no feeds set).";
  }
  const results = await Promise.allSettled(agent.newsFeeds.map(feedHeadlines));
  const headlines = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (headlines.length === 0) return "The news feeds could not be reached right now.";
  return `Latest headlines: ${headlines.join(" | ")}`;
}

const SEARCH_RESULTS = 5;

interface TavilyResponse {
  results: Array<{ title: string; url: string; content: string }>;
  images?: Array<string | { url: string; description?: string }>;
}

async function searchReport(agent: AgentConfig, query: string): Promise<string> {
  if (!agent.searchKey) return "Web search is not configured on this device (no search key set).";
  const res = await fetch(agent.searchUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${agent.searchKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query, max_results: SEARCH_RESULTS }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  const data = (await res.json()) as TavilyResponse;
  if (data.results.length === 0) return "The search returned no results.";
  return data.results.map((result) => `${result.title} (${result.url}): ${result.content}`).join(" | ");
}

const MAX_IMAGE_RESULTS = 4;
const IMAGE_SEARCH_TIMEOUT_MS = 12_000;

async function imageSearchReport(agent: AgentConfig, query: string): Promise<string> {
  if (!agent.searchKey) return "Image search is not configured on this device (no search key set).";
  const res = await fetch(agent.searchUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${agent.searchKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      max_results: 1,
      include_images: true,
      include_image_descriptions: true,
    }),
    signal: AbortSignal.timeout(IMAGE_SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`image search failed (${res.status})`);
  const data = (await res.json()) as TavilyResponse;
  const images = (data.images ?? []).slice(0, MAX_IMAGE_RESULTS);
  if (images.length === 0) return "The image search returned no images.";
  return images
    .map((image) => (typeof image === "string" ? image : `${image.description ?? "image"}: ${image.url}`))
    .join(" | ");
}

const reportOrFallback = (run: () => Promise<string>, fallback: string) =>
  Effect.promise(async () => {
    try {
      return { report: await run() };
    } catch {
      return { report: fallback };
    }
  });

const CurrentTime = Tool.make("CurrentTime", {
  description: "Get the current date and time",
  success: Schema.Struct({
    iso: Schema.String,
    timeZone: Schema.String,
  }),
});

const Weather = Tool.make("Weather", {
  description:
    "Get the current weather and the forecast for today and tomorrow, at the device location by default",
  parameters: Schema.Struct({
    place: Schema.optionalKey(
      Schema.String.annotate({
        description: "A town or place name, only when the person asks about somewhere else",
      }),
    ),
  }),
  success: Schema.Struct({ report: Schema.String }),
});

const News = Tool.make("News", {
  description: "Get the latest headlines from the news feeds configured on the device",
  success: Schema.Struct({ report: Schema.String }),
});

const Search = Tool.make("Search", {
  description:
    "Search the web for current facts not covered by other tools, such as opening hours, events or dates",
  parameters: Schema.Struct({
    query: Schema.String.annotate({
      description: "The search query, phrased in the language most likely to find results",
    }),
  }),
  success: Schema.Struct({ report: Schema.String }),
});

const ImageSearch = Tool.make("ImageSearch", {
  description:
    "Search the web for images of a place, person, animal or thing. Use when the person asks to see something. The screen can only display image urls returned by this tool.",
  parameters: Schema.Struct({
    query: Schema.String.annotate({
      description: "What the image should show, phrased as a short English search query",
    }),
  }),
  success: Schema.Struct({ report: Schema.String }),
});

const UnreadMessages = Tool.make("UnreadMessages", {
  description:
    "List the messages and photos that arrived while the person was away or asleep. Use when asked about new or unread messages. Reading them marks them as seen.",
  success: Schema.Struct({ report: Schema.String }),
});

const MissedCalls = Tool.make("MissedCalls", {
  description:
    "List the calls that rang without being answered. Use when asked who called or about missed calls. Reading them marks them as seen.",
  success: Schema.Struct({ report: Schema.String }),
});

const AnswerCall = Tool.make("AnswerCall", {
  description:
    "Answer the incoming call that is ringing right now. Use when the person asks to pick up, answer or take the call.",
  success: Schema.Struct({ report: Schema.String }),
});

export const AgentToolkit = Toolkit.make(
  CurrentTime,
  Weather,
  News,
  Search,
  ImageSearch,
  UnreadMessages,
  MissedCalls,
  AnswerCall,
);

const timeOf = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const unreadReport = (activity: ActivitySummary) => {
  if (activity.unread.length === 0) return "There are no unread messages.";
  const lines = activity.unread.map((item) =>
    item.kind === "photo"
      ? `${item.from} sent a photo at ${timeOf(item.timestamp)}${item.body ? ` with the caption: ${item.body}` : ""}`
      : `${item.from} wrote at ${timeOf(item.timestamp)}: ${item.body ?? ""}`,
  );
  return lines.join(" | ");
};

const missedReport = (activity: ActivitySummary) => {
  if (activity.missed.length === 0) return "There are no missed calls.";
  return activity.missed.map((call) => `${call.from} called at ${timeOf(call.timestamp)}`).join(" | ");
};

export const AgentToolkitLayer = AgentToolkit.toLayer(
  Effect.gen(function* () {
    const config = yield* daemonConfig;
    const bridge = yield* KioskBridge;
    return AgentToolkit.of({
      CurrentTime: () =>
        Effect.sync(() => ({
          iso: new Date().toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })),
      Weather: ({ place }) =>
        reportOrFallback(
          () => weatherReport(config.agent, config.lang, place),
          "The weather service could not be reached right now.",
        ),
      News: () =>
        reportOrFallback(() => newsReport(config.agent), "The news feeds could not be reached right now."),
      Search: ({ query }) =>
        reportOrFallback(
          () => searchReport(config.agent, query),
          "The web search could not be reached right now.",
        ),
      ImageSearch: ({ query }) =>
        reportOrFallback(
          () => imageSearchReport(config.agent, query),
          "The image search could not be reached right now.",
        ),
      UnreadMessages: () =>
        Effect.sync(() => {
          const report = unreadReport(bridge.activity());
          bridge.clearActivity("unread");
          return { report };
        }),
      MissedCalls: () =>
        Effect.sync(() => {
          const report = missedReport(bridge.activity());
          bridge.clearActivity("missed");
          return { report };
        }),
      AnswerCall: () =>
        Effect.sync(() => {
          const ringing = bridge.activity().ringing;
          if (!ringing) return { report: "No call is ringing right now." };
          bridge.send({ type: "answer-call" });
          return { report: `Answering the call from ${ringing.from}.` };
        }),
    });
  }),
);
