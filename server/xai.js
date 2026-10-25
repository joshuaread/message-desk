// xAI clients: speech-to-text + chat-completions SEO. Both degrade to local
// fallbacks in the callers; these functions throw on any error.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const STT_URL = "https://api.x.ai/v1/stt";
const CHAT_URL = "https://api.x.ai/v1/chat/completions";

async function errorText(response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    return body.error?.message || body.message || text.slice(0, 280) || `xAI error ${response.status}`;
  } catch {
    return text.slice(0, 280) || `xAI error ${response.status}`;
  }
}

/**
 * xAI speech-to-text. Option fields MUST come before the file; the file is last.
 * @returns {Promise<{text:string, words:Array<{text:string,start:number,end:number,speaker?:string}>, duration:number}>}
 */
export async function xaiTranscribe(apiKey, filePath, keyterms) {
  const key = apiKey.trim();
  if (!key) throw new Error("No xAI API key.");
  const bytes = await readFile(filePath);
  const form = new FormData();
  // Option fields first...
  form.append("model", "grok-voice-transcribe-2.0");
  form.append("language", "en");
  form.append("format", "true");
  for (const term of keyterms) form.append("keyterm", term);
  // ...file last.
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), basename(filePath));

  const send = () =>
    fetch(STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(600_000),
    });

  let response = await send();
  if (response.status === 429 || response.status === 503) {
    await new Promise((r) => setTimeout(r, 1500));
    response = await send();
  }
  if (!response.ok) throw new Error(await errorText(response));
  const body = await response.json();
  const words = Array.isArray(body.words)
    ? body.words
        .map((word) => ({
          text: String(word.text ?? ""),
          start: Number(word.start ?? 0),
          end: Number(word.end ?? word.start ?? 0),
          speaker: word.speaker === undefined ? undefined : String(word.speaker),
        }))
        .filter((word) => word.text.trim())
    : [];
  return { text: String(body.text ?? "").trim(), words, duration: Number(body.duration ?? 0) };
}

/** Extract the first balanced JSON object from a model reply (handles ```json fences). */
export function extractJsonObject(raw) {
  const text = raw.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON in model reply.");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    else if (!inString && ch === "{") depth += 1;
    else if (!inString && ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in model reply.");
}

/**
 * Ask xAI chat completions for the sermon SEO fields.
 * @returns {Promise<Object>} a partial SeoFields draft
 */
export async function xaiSeo(apiKey, model, transcript, input) {
  const key = apiKey.trim();
  if (!key) throw new Error("No xAI API key.");
  const prompt =
    "You help Citizens Church in Wentzville publish Sunday sermons for their website. " +
    "Read the transcript and reply with JSON only (no markdown) with exactly these keys: " +
    '{"title":"","metaDescription":"","excerpt":"","body":"","scripture":"","scriptureRefs":[],"tags":[],"categories":[],"speaker":"","series":"","focusKeyphrase":"","imageAlt":""}. ' +
    "title: a real, compelling sermon title under 70 characters — NOT the first spoken sentence, no clickbait. " +
    "metaDescription: a concrete summary under 155 characters. " +
    'excerpt: two calm concrete sentences in this style: "The message walks through <ref> as ... It treats <theme> as ...". ' +
    "body: three to five short paragraphs summarising the message, separated by blank lines. " +
    'scripture: the primary passage normalized like "Jonah 1:7-16" or empty. scriptureRefs: all passages referenced, normalized. ' +
    "speaker: the preacher's name if stated, else empty. series: the series name if obvious, else empty. " +
    "tags: 4-8 lowercase keyword topics. categories: 1-3 broad categories. focusKeyphrase: the main search phrase. " +
    "imageAlt: descriptive alt text for a branded title graphic. " +
    `\nSpeaker (if known): ${input.speaker || "unknown"}\nSeries (if known): ${input.series || "none"}\nService date: ${input.date}\n` +
    `Transcript:\n${transcript}`;

  const response = await fetch(CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(await errorText(response));
  const body = await response.json();
  const content = body.choices?.[0]?.message?.content ?? "";
  const parsed = extractJsonObject(content);

  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  return {
    title: str(parsed.title),
    metaDescription: str(parsed.metaDescription),
    excerpt: str(parsed.excerpt),
    body: str(parsed.body),
    scripture: str(parsed.scripture),
    scriptureRefs: arr(parsed.scriptureRefs),
    tags: arr(parsed.tags),
    categories: arr(parsed.categories),
    speaker: str(parsed.speaker),
    series: str(parsed.series),
    focusKeyphrase: str(parsed.focusKeyphrase),
    imageAlt: str(parsed.imageAlt),
  };
}
