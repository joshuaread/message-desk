#!/usr/bin/env node
// Generate a synthetic "Sunday service" recording for the tests:
//   worship music (loud, low zero-crossing tones) -> the spoken message
//   (espeak-ng, high zero-crossing, ~4 Hz syllable modulation) -> closing
//   music / announcements. A sidecar JSON records the true speech in/out so the
//   e2e can assert detection lands within tolerance.
//
// Outputs (into test/audio/, gitignored):
//   sunday-service.m4a   AAC phone-style recording
//   sunday-service.wav   48 kHz stereo board-style recording
//   sunday-service.json  { speechStart, speechEnd, ... }
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../test/audio");

function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise(Buffer.concat(out)) : reject(new Error(`${cmd} failed: ${err.slice(-300)}`)),
    );
  });
}

async function ffprobeDuration(path) {
  const out = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path,
  ]);
  return Number(out.toString().trim());
}

// A short sermon. Mentions the passage in spoken form so the scripture parser
// and the themed-title heuristic have something real to work with.
const SERMON = `Good morning, Citizens Church. It is good to be together this morning.
If you have your Bible, turn with me to Jonah chapter one, verses seven through sixteen.
This is the story of a storm, and of a man who was running from God.
I want to ask you one simple question this morning. What are you afraid of?
Because fear has a way of showing us what we really worship.
The sailors were afraid of the storm, so they cried out, each one to his own god.
Jonah was afraid of obedience, so he ran toward the sea.
Fear reveals what we worship. When we are afraid, we reach for whatever we trust the most.
The sailors cast lots, and the lot fell on Jonah. They asked him, who are you, and what have you done?
And Jonah told them the truth. I worship the Lord, the God of heaven, who made the sea and the dry land.
Here is the good news this morning. The same God who sends the storm also calms the sea.
When Jonah was thrown into the water, the raging sea grew calm.
And the men feared the Lord, and they worshiped him.
So this is my invitation to you today. Stop striving. Stop running.
Name your fear, and then bring it to the Lord who made the sea and the dry land.
Let your fear lead you back to worship. Let us pray.`;

function musicFilter(freqs, dur) {
  // Chord of pure tones (low zero-crossing) + slow tremolo + a little pink noise.
  const inputs = freqs.map((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=${dur}`]).flat();
  inputs.push("-f", "lavfi", "-i", `anoisesrc=d=${dur}:color=pink:amplitude=0.06`);
  const chordIns = freqs.map((_, i) => `[${i}]`).join("");
  const noiseIdx = freqs.length;
  const filter =
    `${chordIns}amix=inputs=${freqs.length}:normalize=1[ch];` +
    `[ch]tremolo=f=1.6:d=0.7[tm];` +
    `[tm][${noiseIdx}]amix=inputs=2:weights='1 0.25':normalize=0,volume=3.2,` +
    `aformat=sample_fmts=s16:channel_layouts=stereo,aresample=44100[out]`;
  return { inputs, filter };
}

async function makeMusic(path, freqs, dur) {
  const { inputs, filter } = musicFilter(freqs, dur);
  await run("ffmpeg", ["-nostdin", "-v", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", path]);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const tmp = (name) => join(OUT_DIR, name);

  // 1. Speech via espeak-ng.
  const speechRaw = tmp("speech-raw.wav");
  await run("espeak-ng", ["-v", "en-us", "-s", "155", "-w", speechRaw, SERMON]);
  // Mix a little room noise under the speech so it reads as a real recording,
  // and normalise to 44.1k stereo.
  const speech = tmp("speech.wav");
  const speechDur = await ffprobeDuration(speechRaw);
  await run("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-i", speechRaw,
    "-f", "lavfi", "-i", `anoisesrc=d=${speechDur}:color=pink:amplitude=0.012`,
    "-filter_complex",
    "[0]volume=1.0[v];[v][1]amix=inputs=2:weights='1 0.2':normalize=0," +
      "aformat=sample_fmts=s16:channel_layouts=stereo,aresample=44100[out]",
    "-map", "[out]", speech,
  ]);
  const realSpeechDur = await ffprobeDuration(speech);

  // 2. Worship music before, announcements/music after.
  const preDur = 120;
  const tailDur = 90;
  const pre = tmp("pre.wav");
  const tail = tmp("tail.wav");
  await makeMusic(pre, [196, 247, 294, 392], preDur); // G major-ish chord
  await makeMusic(tail, [174, 220, 261, 349], tailDur); // F major-ish chord

  // 3. Concatenate pre + speech + tail -> full service WAV (48k stereo board).
  const wavOut = tmp("sunday-service.wav");
  await run("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    "-i", pre, "-i", speech, "-i", tail,
    "-filter_complex",
    "[0:a][1:a][2:a]concat=n=3:v=0:a=1,aformat=sample_fmts=s16:channel_layouts=stereo,aresample=48000[out]",
    "-map", "[out]", "-c:a", "pcm_s16le", wavOut,
  ]);

  // 4. Encode the AAC .m4a phone recording from the same timeline.
  const m4aOut = tmp("sunday-service.m4a");
  await run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", wavOut, "-c:a", "aac", "-b:a", "128k", m4aOut]);

  const truth = {
    speechStart: Math.round(preDur * 10) / 10,
    speechEnd: Math.round((preDur + realSpeechDur) * 10) / 10,
    preLen: preDur,
    speechLen: Math.round(realSpeechDur * 10) / 10,
    tailLen: tailDur,
    totalLen: Math.round((preDur + realSpeechDur + tailDur) * 10) / 10,
    scripture: "Jonah 1:7-16",
    tolerance: 10,
  };
  await writeFile(tmp("sunday-service.json"), JSON.stringify(truth, null, 2));

  // Tidy intermediates.
  for (const f of ["speech-raw.wav", "speech.wav", "pre.wav", "tail.wav"]) {
    await rm(tmp(f), { force: true });
  }

  console.log("Wrote test audio to", OUT_DIR);
  console.log(JSON.stringify(truth, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
