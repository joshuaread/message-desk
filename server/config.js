// Runtime configuration, loaded from the environment (and an optional .env).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader (no dependency). Only sets keys that are not already in
 * process.env, so real environment variables win over the file.
 */
export function loadDotEnv(path = ".env") {
  let text;
  try {
    text = readFileSync(resolve(path), "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function loadConfig() {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  // Josh's machines may provide the live app password as CITIZENS_WP_APP_PASSWORD.
  const wpAppPassword =
    (process.env.WP_APP_PASSWORD ?? "").trim() ||
    (process.env.CITIZENS_WP_APP_PASSWORD ?? "").trim();
  return {
    port: Number.isFinite(port) ? port : 8080,
    deskPassword: process.env.DESK_PASSWORD ?? "",
    dataDir: resolve(process.env.DATA_DIR ?? "./data"),
    timezone: (process.env.TZ ?? "America/Chicago").trim() || "America/Chicago",
    xaiApiKey: (process.env.XAI_API_KEY ?? "").trim(),
    xaiModel: (process.env.XAI_MODEL ?? "grok-4.7").trim() || "grok-4.7",
    whisperPython: (process.env.WHISPER_PYTHON ?? "").trim(),
    whisperModel: (process.env.WHISPER_MODEL ?? "base.en").trim() || "base.en",
    wpUrl: (process.env.WP_URL ?? "").trim(),
    wpUser: (process.env.WP_USER ?? "").trim(),
    wpAppPassword,
    wpAllowHttp: /^(1|true|yes)$/i.test((process.env.WP_ALLOW_HTTP ?? "").trim()),
  };
}
