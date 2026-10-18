import { buildWav } from "./wav.ts";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type Kind = "silence" | "music" | "speech";

const TIMELINE: Array<{ dur: number; kind: Kind }> = [
  { dur: 1, kind: "silence" },
  { dur: 8, kind: "music" },
  { dur: 2, kind: "silence" },
  { dur: 4, kind: "speech" },
  { dur: 5, kind: "silence" },
  { dur: 22, kind: "speech" },
  { dur: 2, kind: "silence" },
  { dur: 6, kind: "music" },
  { dur: 1, kind: "silence" },
];

export const SAMPLE_SERMON = { start: 20, end: 42 };

export function makeSampleService(): Uint8Array {
  const sampleRate = 22050;
  const total = TIMELINE.reduce((sum, part) => sum + part.dur, 0);
  const samples = new Float32Array(Math.floor(total * sampleRate));
  const rng = makeRng(0x5eed);
  let offset = 0;
  for (const part of TIMELINE) {
    const frames = Math.floor(part.dur * sampleRate);
    for (let index = 0; index < frames; index += 1) {
      const time = index / sampleRate;
      let value = 0;
      if (part.kind === "silence") {
        value = (rng() * 2 - 1) * 0.003;
      } else if (part.kind === "music") {
        const trem = 0.94 + 0.06 * Math.sin(2 * Math.PI * 0.22 * time);
        value =
          trem *
          (0.34 * Math.sin(2 * Math.PI * 196 * time) +
            0.2 * Math.sin(2 * Math.PI * 247 * time) +
            0.14 * Math.sin(2 * Math.PI * 294 * time));
      } else {
        const phase = (time * 4.15) % 1;
        let env = 0.015;
        if (phase >= 0.08 && phase <= 0.58) {
          env = 0.04 + 0.96 * Math.sin(Math.PI * ((phase - 0.08) / 0.5));
        }
        value = (rng() * 2 - 1) * 0.22 * env;
      }
      samples[offset + index] = value;
    }
    offset += frames;
  }
  return buildWav(samples, sampleRate, 16);
}
