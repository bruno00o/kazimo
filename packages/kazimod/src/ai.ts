import type { AiConfig } from "./config";

const MISTRAL_CATALOG_VOICES: Record<string, string> = {
  en: "en_paul_neutral",
  fr: "fr_marie_neutral",
};

async function ttsSource(ai: AiConfig, lang: string): Promise<Record<string, string> | null> {
  const ref = ai.ttsRef ? Bun.file(ai.ttsRef.replaceAll("{lang}", lang)) : null;
  if (ref && (await ref.exists())) {
    return { ref_audio: Buffer.from(await ref.arrayBuffer()).toString("base64") };
  }
  const voice = ai.ttsVoice ?? MISTRAL_CATALOG_VOICES[lang.split("-")[0] ?? lang];
  return voice ? { voice } : null;
}

export async function speak(ai: AiConfig, text: string, lang: string): Promise<Uint8Array | null> {
  if (!ai.key) throw new Error("KAZIMO_AI_KEY not configured");
  const source = await ttsSource(ai, lang);
  if (!source) return null;
  const body = { model: ai.ttsModel, input: text, ...source };
  const res = await fetch(`${ai.baseUrl}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${ai.key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`speech failed (${res.status}): ${await res.text()}`);
  const result = (await res.json()) as { audio_data: string };
  return Buffer.from(result.audio_data, "base64");
}

export async function transcribe(ai: AiConfig, wav: Uint8Array, language: string): Promise<string> {
  if (!ai.key) throw new Error("KAZIMO_AI_KEY not configured");
  const form = new FormData();
  form.append("model", ai.sttModel);
  form.append("language", language);
  form.append("file", new File([wav], "capture.wav", { type: "audio/wav" }));
  const res = await fetch(`${ai.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${ai.key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription failed (${res.status}): ${await res.text()}`);
  const result = (await res.json()) as { text: string };
  return result.text;
}
