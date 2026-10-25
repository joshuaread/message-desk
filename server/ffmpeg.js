// Everything that shells out to ffmpeg/ffprobe: capability check, probing,
// decoding to analysis PCM, the low-bitrate preview, and the clean+loudnorm
// export with output measurement.
import { spawn } from "node:child_process";
import { analyzeMono, ANALYSIS_RATE } from "./features.js";

/** @typedef {{ code:number, stdout:Buffer, stderr:string }} RunResult */

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let outLen = 0;
    const err = [];
    const max = opts.maxBuffer ?? Infinity;
    child.stdout.on("data", (chunk) => {
      outLen += chunk.length;
      if (outLen > max) {
        child.kill("SIGKILL");
        reject(new Error(`${cmd} produced too much output`));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

/** Verify ffmpeg + ffprobe are on PATH; returns the reported versions. */
export async function checkFfmpeg() {
  const read = async (cmd) => {
    try {
      const { code, stdout } = await run(cmd, ["-version"]);
      if (code !== 0) throw new Error();
      return stdout.toString("utf8").split("\n")[0]?.trim() ?? cmd;
    } catch {
      throw new Error(
        `${cmd} was not found on PATH. Install ffmpeg (e.g. "sudo apt install ffmpeg") and try again.`,
      );
    }
  };
  return { ffmpeg: await read("ffmpeg"), ffprobe: await read("ffprobe") };
}

export async function probe(input) {
  const { code, stdout, stderr } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "format=duration:format_tags=creation_time:stream=sample_rate,channels,codec_name",
    "-of", "json",
    input,
  ]);
  if (code !== 0) throw new Error(`Could not read that audio file. ${stderr.slice(0, 200)}`);
  const json = JSON.parse(stdout.toString("utf8"));
  const stream = json.streams?.[0];
  if (!stream) throw new Error("That file has no audio track.");
  return {
    duration: Number(json.format?.duration ?? 0),
    sampleRate: Number(stream.sample_rate ?? 0),
    channels: Number(stream.channels ?? 0),
    codec: String(stream.codec_name ?? ""),
    creationTime: String(json.format?.tags?.creation_time ?? ""),
  };
}

/** Decode the whole input to mono f32 PCM at the low analysis rate, then extract features + peaks. */
export async function analyze(input) {
  const { code, stdout, stderr } = await run(
    "ffmpeg",
    ["-nostdin", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", String(ANALYSIS_RATE), "-f", "f32le", "-"],
    // 8kHz mono f32 is ~32KB/s; cap at ~6h of audio to avoid runaway memory.
    { maxBuffer: 32_000 * 3600 * 6 },
  );
  if (code !== 0) throw new Error(`ffmpeg could not decode that file. ${stderr.slice(0, 200)}`);
  const usable = stdout.length - (stdout.length % 4);
  const copy = Buffer.from(stdout.subarray(0, usable));
  const samples = new Float32Array(copy.buffer, copy.byteOffset, usable / 4);
  return analyzeMono(samples, ANALYSIS_RATE);
}

/** A small mono low-bitrate mp3 of the entire source, used for scrubbing + region preview in the UI. */
export async function makePreview(input, outPath) {
  const { code, stderr } = await run("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-i", input,
    "-vn", "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-b:a", "48k",
    outPath,
  ]);
  if (code !== 0) throw new Error(`ffmpeg preview failed. ${stderr.slice(0, 200)}`);
}

const CLEAN_CHAIN = "highpass=f=80,afftdn=nf=-25";

function parseLoudnormJson(stderr) {
  const match = stderr.match(/\{[\s\S]*?"target_offset"[\s\S]*?\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export const TARGET_LUFS = -16;
export const AIM_TP = -1.5; // dBTP we aim for on the encoded MP3
export const MAX_TP = -1.5; // dBTP ceiling the output must satisfy

// --- Two-pass loudnorm ----------------------------------------------------
// Pass 1 measures the input; pass 2 feeds those measurements back so loudnorm
// runs in its accurate linear mode. A true-peak limiter (alimiter) sits after
// loudnorm so the measured true peak stays under the ceiling even after the
// MP3 encoder adds inter-sample overshoot.

/** Pass 1: measure the trimmed + cleaned input. */
async function measureInput(input, ss, t, loudnormTp) {
  const { stderr } = await run("ffmpeg", [
    "-nostdin", "-v", "info", "-y",
    "-ss", ss, "-i", input, "-t", t,
    "-vn", "-ac", "1", "-ar", "44100",
    "-af", `${CLEAN_CHAIN},loudnorm=I=${TARGET_LUFS}:TP=${loudnormTp.toFixed(2)}:LRA=11:print_format=json`,
    "-f", "null", "-",
  ]);
  return parseLoudnormJson(stderr);
}

/**
 * Pass 2: linear loudnorm using the measured values, a correction gain, a
 * true-peak limiter, and fades. The limiter guarantees the true-peak ceiling;
 * the correction gain is what we iterate to land integrated loudness on target
 * (limiting a −16 LUFS signal to −1.5 dBTP shaves a little loudness back off,
 * so we measure the encoded MP3 and trim the gain until it sits in spec).
 */
async function encodePass2(input, outPath, ss, t, fadeOutStart, measured, gainDb, limitTp) {
  let loud = `loudnorm=I=${TARGET_LUFS}:TP=${AIM_TP.toFixed(2)}:LRA=11`;
  if (measured) {
    loud +=
      `:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}:linear=true`;
  }
  const limit = Math.pow(10, limitTp / 20); // dBTP ceiling -> linear
  const parts = [CLEAN_CHAIN, loud];
  if (Math.abs(gainDb) > 0.01) parts.push(`volume=${gainDb.toFixed(2)}dB`);
  parts.push(`alimiter=limit=${limit.toFixed(5)}:level=false`);
  parts.push(`afade=t=in:st=0:d=0.3`, `afade=t=out:st=${fadeOutStart}:d=0.4`);
  const res = await run("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-ss", ss, "-i", input, "-t", t,
    "-vn", "-ac", "1", "-ar", "44100",
    "-af", parts.join(","),
    "-c:a", "libmp3lame", "-b:a", "112k",
    outPath,
  ]);
  if (res.code !== 0) throw new Error(`ffmpeg export failed. ${res.stderr.slice(0, 300)}`);
}

/**
 * Trim to [inSec,outSec], mono, high-pass ~80Hz, gentle denoise, two-pass
 * loudnorm to I=-16 LUFS / TP=-1.5 / LRA=11, a true-peak limiter, short fades,
 * 44.1kHz MP3. Both integrated loudness and true peak are verified on the
 * *encoded* MP3; a correction gain and the limiter ceiling are adjusted and the
 * file re-encoded until it is within spec (-16 ±1 LUFS and TP <= -1.5 dBTP).
 * @returns {Promise<{duration:number, lufs:number|null, truePeak:number|null, lra:number|null, passes:number}>}
 */
export async function cleanExport(input, outPath, inSec, outSec) {
  const duration = Math.max(0.1, outSec - inSec);
  const ss = inSec.toFixed(3);
  const t = duration.toFixed(3);
  const fadeOutStart = Math.max(0, duration - 0.4).toFixed(3);

  const measured = await measureInput(input, ss, t, AIM_TP).catch(() => null);

  let gainDb = 0;
  let limitTp = AIM_TP;
  let out = { lufs: null, truePeak: null, lra: null };
  let passes = 0;
  for (let i = 0; i < 6; i += 1) {
    await encodePass2(input, outPath, ss, t, fadeOutStart, measured, gainDb, limitTp);
    passes += 1;
    out = await measureLoudness(outPath);
    if (out.lufs == null || out.truePeak == null) break; // can't measure — accept
    const lufsErr = TARGET_LUFS - out.lufs; // +ve => too quiet, needs gain
    const tpOver = out.truePeak - MAX_TP; // +ve => too hot
    if (Math.abs(lufsErr) <= 0.5 && tpOver <= 0) break; // comfortably in spec
    if (Math.abs(lufsErr) > 0.3) gainDb += lufsErr;
    if (tpOver > 0) limitTp -= tpOver + 0.1; // tighten the ceiling
    if (limitTp < -9 || gainDb > 12 || gainDb < -12) break; // safety rails
  }

  return { duration, lufs: out.lufs, truePeak: out.truePeak, lra: out.lra, passes };
}

/** Measure a finished file with ebur128 (peak=true) for integrated LUFS + true peak. */
export async function measureLoudness(path) {
  const { stderr } = await run("ffmpeg", [
    "-nostdin", "-v", "info",
    "-i", path,
    "-af", "ebur128=peak=true:framelog=verbose",
    "-f", "null", "-",
  ]);
  // The ebur128 "Summary:" block reports Integrated loudness + True peak.
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufsMatch = summary.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  const tpMatch = summary.match(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
  const lraMatch = summary.match(/LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/);
  const num = (m) => {
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  };
  return { lufs: num(lufsMatch), truePeak: num(tpMatch), lra: num(lraMatch) };
}
