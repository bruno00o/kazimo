import type { AiConfig } from "./config";

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
