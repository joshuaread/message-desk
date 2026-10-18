import { createServerFn } from "@tanstack/react-start";

type TimedWord = { text: string; start: number; end: number; speaker?: string };

export type TranscribeResult =
  | { ok: true; text: string; words: TimedWord[]; duration: number }
  | { ok: false; error: string };

export type SuggestResult =
  | { ok: true; title: string; scripture: string; summary: string }
  | { ok: false; error: string };

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return body.error?.message || body.message || text.slice(0, 280) || `xAI error ${response.status}`;
  } catch {
    return text.slice(0, 280) || `xAI error ${response.status}`;
  }
}

type SttInput = {
  url?: string;
  file?: Blob;
  filename?: string;
  keyterms: string[];
};

async function transcribeWithKey(apiKey: string, data: SttInput): Promise<TranscribeResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Add an xAI API key. It stays in this browser." };

  const send = () => {
    const form = new FormData();
    form.append("model", "grok-voice-transcribe-2.0");
    form.append("language", "en");
    form.append("format", "true");
    form.append("diarize", "true");
    for (const term of data.keyterms) form.append("keyterm", term);
    if (data.url) form.append("url", data.url);
    else if (data.file) form.append("file", data.file, data.filename || "sermon.mp3");
    return fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
  };

  try {
    let response = await send();
    if (response.status === 429 || response.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await send();
    }
    if (!response.ok) return { ok: false, error: await errorText(response) };
    const body = (await response.json()) as {
      text?: string;
      duration?: number;
      words?: Array<{ text?: string; start?: number; end?: number; speaker?: string | number }>;
    };
    const words: TimedWord[] = Array.isArray(body.words)
      ? body.words
          .map((word) => ({
            text: String(word.text ?? ""),
            start: Number(word.start ?? 0),
            end: Number(word.end ?? word.start ?? 0),
            speaker: word.speaker === undefined ? undefined : String(word.speaker),
          }))
          .filter((word) => word.text.trim())
      : [];
    return {
      ok: true,
      text: String(body.text ?? "").trim(),
      words,
      duration: Number(body.duration ?? 0),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    if (/timeout|aborted/i.test(message)) return { ok: false, error: "Transcription timed out. Try again." };
    return { ok: false, error: message };
  }
}

async function suggestWithKey(apiKey: string, data: { transcript: string; speaker: string }): Promise<SuggestResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Add an xAI API key. It stays in this browser." };
  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content:
              "You help Citizens Church in Wentzville publish Sunday sermons. " +
              "Reply with JSON only, no markdown: {\"title\":\"\",\"scripture\":\"\",\"summary\":\"\"}. " +
              "title: the preacher’s own title if they announce one, otherwise a plain specific bulletin title. No quotes, no subtitle, no clickbait, under 80 characters. " +
              "scripture: the primary preaching passage like \"Ephesians 4:31-32\", or an empty string if it is not clear. Do not list every aside. " +
              "summary: two calm concrete sentences. No marketing language.\n" +
              `Speaker: ${data.speaker || "unknown"}\nTranscript:\n${data.transcript}`,
          },
        ],
      }),
    });
    if (!response.ok) return { ok: false, error: await errorText(response) };
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const jsonText = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(jsonText) as { title?: unknown; scripture?: unknown; summary?: unknown };
    const title = clip(parsed.title, 120);
    if (!title) return { ok: false, error: "The suggestion came back without a title." };
    return {
      ok: true,
      title,
      scripture: clip(parsed.scripture, 80),
      summary: clip(parsed.summary, 500),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn’t suggest a title.";
    return { ok: false, error: message };
  }
}

/** Browser call. The key is the one typed on the page, not a server secret. */
export function transcribeAudioInBrowser(
  apiKey: string,
  input: { file: Blob; filename?: string; keyterms: string[] },
): Promise<TranscribeResult> {
  return transcribeWithKey(apiKey, input);
}

/** Browser call. The key is the one typed on the page, not a server secret. */
export function suggestSermonInBrowser(
  apiKey: string,
  input: { transcript: string; speaker: string },
): Promise<SuggestResult> {
  return suggestWithKey(apiKey, { transcript: clip(input.transcript, 14000), speaker: clip(input.speaker, 80) });
}

export const transcribeAudio = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = (input ?? {}) as { url?: unknown; audioBase64?: unknown; mime?: unknown; keyterms?: unknown };
    const url = typeof data.url === "string" ? data.url.trim() : "";
    const audioBase64 = typeof data.audioBase64 === "string" ? data.audioBase64 : "";
    if (!url && !audioBase64) throw new Error("Missing audio.");
    if (audioBase64 && audioBase64.length > 3_700_000) throw new Error("That audio piece is too large to send.");
    if (url && !/^https:\/\//i.test(url)) throw new Error("Transcription needs a public https audio URL.");
    const keyterms = Array.isArray(data.keyterms)
      ? data.keyterms.map((term) => clip(term, 50)).filter(Boolean).slice(0, 40)
      : [];
    const mime = data.mime === "audio/wav" ? "audio/wav" : "audio/mpeg";
    return { url, audioBase64, mime, keyterms };
  })
  .handler(async ({ data }): Promise<TranscribeResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Transcription isn’t available in this environment yet." };
    if (data.url) return transcribeWithKey(apiKey, { url: data.url, keyterms: data.keyterms });
    const binary = Uint8Array.from(atob(data.audioBase64), (char) => char.charCodeAt(0));
    return transcribeWithKey(apiKey, {
      file: new Blob([binary], { type: data.mime }),
      filename: data.mime === "audio/wav" ? "sermon.wav" : "sermon.mp3",
      keyterms: data.keyterms,
    });
  });

export const suggestSermon = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = (input ?? {}) as { transcript?: unknown; speaker?: unknown };
    const transcript = clip(data.transcript, 14000);
    if (transcript.length < 40) throw new Error("Transcribe the sermon before suggesting a title.");
    return { transcript, speaker: clip(data.speaker, 80) };
  })
  .handler(async ({ data }): Promise<SuggestResult> => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false, error: "Suggestions aren’t available in this environment yet." };
    return suggestWithKey(apiKey, data);
  });
