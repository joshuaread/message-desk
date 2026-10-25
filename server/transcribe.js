// Transcription orchestrator: xAI STT first (when a key is set), local
// faster-whisper as the fallback, then a last-resort empty result. Always
// reports which engine produced the transcript and why.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { xaiTranscribe } from "./xai.js";

const here = dirname(fileURLToPath(import.meta.url));
const WHISPER_SCRIPT = resolve(here, "../scripts/whisper_transcribe.py");

function runWhisper(python, model, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, [WHISPER_SCRIPT, "--input", input, "--model", model], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`whisper exited ${code}: ${err.slice(-300)}`));
        return;
      }
      try {
        const json = JSON.parse(out);
        if (json.error) {
          reject(new Error(json.error));
          return;
        }
        resolvePromise({
          text: String(json.text ?? ""),
          duration: Number(json.duration ?? 0),
          words: json.words ?? [],
        });
      } catch (e) {
        reject(new Error(`whisper output was not JSON: ${e.message}`));
      }
    });
  });
}

/** @returns {Promise<import("./types.js").TranscriptResult>} */
export async function transcribe(config, filePath, keyterms) {
  let xaiError = "";
  if (config.xaiApiKey) {
    try {
      const r = await xaiTranscribe(config.xaiApiKey, filePath, keyterms);
      if (r.text || r.words.length) {
        return { engine: "xai", text: r.text, words: r.words, duration: r.duration, note: "Transcribed by xAI STT." };
      }
      xaiError = "xAI returned an empty transcript.";
    } catch (e) {
      xaiError = e instanceof Error ? e.message : String(e);
    }
  }

  if (config.whisperPython && existsSync(config.whisperPython) && existsSync(WHISPER_SCRIPT)) {
    const r = await runWhisper(config.whisperPython, config.whisperModel, filePath);
    return {
      engine: "whisper",
      text: r.text,
      words: r.words,
      duration: r.duration,
      note: xaiError
        ? `whisper (xAI rejected: ${xaiError})`
        : "whisper (no xAI key).",
    };
  }

  return {
    engine: "none",
    text: "",
    words: [],
    duration: 0,
    note: xaiError
      ? `xAI STT failed (${xaiError}) and no local whisper is configured.`
      : "No transcription engine configured (set XAI_API_KEY or WHISPER_PYTHON).",
  };
}
