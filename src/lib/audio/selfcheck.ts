import { detectSermon, type SecondFeature } from "./detect.ts";
import { encodeSermonMp3 } from "./encode.ts";
import { SAMPLE_SERMON, makeSampleService } from "./sample.ts";
import { analyzeWav, buildWav, bytesSource } from "./wav.ts";

function sec(partial: Partial<SecondFeature>): SecondFeature {
  return { rms: 0, zcr: 0, mod: 0, peak: 0, ...partial };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function serviceFeatures(): SecondFeature[] {
  const features: SecondFeature[] = [];
  const push = (count: number, feature: SecondFeature) => {
    for (let index = 0; index < count; index += 1) features.push({ ...feature });
  };
  push(8 * 60, sec({ rms: 0.28, zcr: 0.02, mod: 0.07, peak: 0.5 }));
  push(20, sec({ rms: 0.004, zcr: 0.01, mod: 0.1, peak: 0.01 }));
  for (let index = 0; index < 180; index += 1) {
    features.push(
      index % 11 === 10
        ? sec({ rms: 0.01, zcr: 0.05, mod: 0.4, peak: 0.05 })
        : sec({ rms: 0.11, zcr: 0.12, mod: 0.7, peak: 0.3 }),
    );
  }
  push(15, sec({ rms: 0.004, zcr: 0.01, mod: 0.1, peak: 0.01 }));
  for (let index = 0; index < 32 * 60; index += 1) {
    features.push(
      index % 14 === 13
        ? sec({ rms: 0.012, zcr: 0.04, mod: 0.5, peak: 0.04 })
        : sec({ rms: 0.13, zcr: 0.11, mod: 0.66, peak: 0.32 }),
    );
  }
  push(10, sec({ rms: 0.004, zcr: 0.01, mod: 0.2, peak: 0.01 }));
  push(6 * 60, sec({ rms: 0.26, zcr: 0.025, mod: 0.08, peak: 0.48 }));
  return features;
}

async function main(): Promise<void> {
  const features = serviceFeatures();
  const sermonStart = 8 * 60 + 20 + 180 + 15;
  const sermonEnd = sermonStart + 32 * 60;
  const found = detectSermon(features, features.length);
  console.log("service", found.start, found.end, found.confidence, found.reason);
  assert(found.start > sermonStart - 30 && found.start < sermonStart + 40, `service start ${found.start} expected near ${sermonStart}`);
  assert(found.end > sermonEnd - 40 && found.end < sermonEnd + 30, `service end ${found.end} expected near ${sermonEnd}`);

  const only: SecondFeature[] = [];
  for (let index = 0; index < 20 * 60; index += 1) {
    only.push(
      index < 2 || index > 20 * 60 - 3
        ? sec({ rms: 0.003, zcr: 0.01, mod: 0.1, peak: 0.01 })
        : sec({ rms: 0.12, zcr: 0.11, mod: 0.62, peak: 0.3 }),
    );
  }
  const solo = detectSermon(only, only.length);
  console.log("solo", solo.start, solo.end, solo.reason);
  assert(solo.start < 5 && solo.end > only.length - 6, "sermon-only file should keep the whole talk");

  const sample = makeSampleService();
  const analysis = await analyzeWav(bytesSource(sample));
  const detected = detectSermon(analysis.features, analysis.duration);
  const speech = detected.labels.filter((label) => label === "speech").length;
  const music = detected.labels.filter((label) => label === "music").length;
  console.log("sample", analysis.duration, detected.start, detected.end, { speech, music }, detected.reason);
  assert(Math.abs(detected.start - SAMPLE_SERMON.start) < 2.2, `sample start ${detected.start}`);
  assert(Math.abs(detected.end - SAMPLE_SERMON.end) < 2.8, `sample end ${detected.end}`);

  const tone = new Float32Array(4000);
  tone.fill(0.5);
  const wav24 = buildWav(tone, 16000, 24);
  const readBack = await analyzeWav(bytesSource(wav24));
  const peak = Math.max(...readBack.peaks.filter((_, index) => index % 2 === 1));
  console.log("24-bit peak", peak);
  assert(Math.abs(peak - 0.5) < 0.02, `24-bit peak ${peak}`);

  const mp3 = await encodeSermonMp3(bytesSource(sample), analysis.info, 20, 24, {
    cutRumble: true,
    tightenQuiet: true,
    normalize: true,
    bitrate: 96,
  });
  console.log("mp3 bytes", mp3.length, mp3[0], mp3[1]);
  assert(mp3.length > 200, "mp3 too small");
  assert(mp3[0] === 0xff || mp3[0] === 0x49, "mp3 missing frame sync");
  console.log("selfcheck ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
