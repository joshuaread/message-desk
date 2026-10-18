export type SecondFeature = {
  rms: number;
  zcr: number;
  mod: number;
  peak: number;
};

export type RegionKind = "silence" | "speech" | "music";

export type Detection = {
  start: number;
  end: number;
  confidence: number;
  reason: string;
  labels: RegionKind[];
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function lengthPhrase(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} seconds`;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  if (s === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${m} min ${s} sec`;
}

type Run = { start: number; end: number };

export function detectSermon(features: SecondFeature[], durationSec?: number): Detection {
  const count = features.length;
  const duration = durationSec ?? count;
  if (count === 0 || duration <= 0) {
    return {
      start: 0,
      end: 0,
      confidence: 0,
      reason: "No audio to scan.",
      labels: [],
    };
  }

  const rms = features.map((feature) => feature.rms);
  const sorted = [...rms].sort((a, b) => a - b);
  const p05 = percentile(sorted, 0.05);
  const p50 = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const noise = p05 < p50 * 0.5 ? p05 : p50 * 0.06;
  const silenceCut = Math.max(noise * 3.2, p50 * 0.045, 1e-6);

  const localCv = new Array<number>(count);
  const radius = 8;
  for (let index = 0; index < count; index += 1) {
    let sum = 0;
    let sumSq = 0;
    let seen = 0;
    const from = Math.max(0, index - radius);
    const to = Math.min(count - 1, index + radius);
    for (let cursor = from; cursor <= to; cursor += 1) {
      const value = rms[cursor] ?? 0;
      sum += value;
      sumSq += value * value;
      seen += 1;
    }
    const mean = sum / seen;
    const variance = Math.max(0, sumSq / seen - mean * mean);
    localCv[index] = Math.sqrt(variance) / (mean + 1e-8);
  }

  const speechP = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    const feature = features[index] ?? { rms: 0, zcr: 0, mod: 0, peak: 0 };
    if (feature.rms <= silenceCut) {
      speechP[index] = 0;
      continue;
    }
    const modScore = clamp((feature.mod - 0.16) / 0.42, 0, 1);
    const cvScore = clamp(((localCv[index] ?? 0) - 0.16) / 0.42, 0, 1);
    const zcrScore = feature.zcr >= 0.035 ? 1 : feature.zcr / 0.035;
    // Steady tones (pads, a band without drums in the analysis band) are not speech,
    // even when a nearby silence inflates the longer loudness window.
    if (modScore < 0.15 && feature.zcr < 0.08) {
      speechP[index] = 0.05;
      continue;
    }
    const loudMusic =
      p90 > silenceCut * 2 && feature.rms > p90 * 0.9 && feature.mod < 0.32 && cvScore < 0.45;
    const presence = clamp(feature.rms / (silenceCut * 2.4), 0, 1);
    const texture = 0.12 + 0.5 * modScore + 0.38 * cvScore;
    speechP[index] = presence * texture * (0.5 + 0.5 * zcrScore) * (loudMusic ? 0.35 : 1);
  }

  const smooth = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    let sum = 0;
    let seen = 0;
    for (let cursor = index - 3; cursor <= index + 3; cursor += 1) {
      if (cursor < 0 || cursor >= count) continue;
      sum += speechP[cursor] ?? 0;
      seen += 1;
    }
    smooth[index] = sum / seen;
  }

  const labels: RegionKind[] = smooth.map((probability, index) => {
    const feature = features[index];
    if (!feature || feature.rms <= silenceCut) return "silence";
    if (probability >= 0.4) return "speech";
    return "music";
  });

  const micro: Run[] = [];
  let cursor = 0;
  while (cursor < count) {
    if (labels[cursor] !== "speech") {
      cursor += 1;
      continue;
    }
    const start = cursor;
    let end = cursor + 1;
    while (end < count) {
      if (labels[end] === "speech") {
        end += 1;
        continue;
      }
      let next = end;
      while (next < count && labels[next] !== "speech" && next - end < 4) next += 1;
      if (next < count && labels[next] === "speech" && next - end <= 3.5) {
        let music = 0;
        for (let index = end; index < next; index += 1) {
          if (labels[index] === "music") music += 1;
        }
        if (music <= 1) {
          end = next + 1;
          continue;
        }
      }
      break;
    }
    micro.push({ start, end });
    cursor = end;
  }

  const runs: Run[] = [];
  for (const run of micro) {
    const previous = runs[runs.length - 1];
    if (!previous) {
      runs.push({ ...run });
      continue;
    }
    const gap = run.start - previous.end;
    let music = 0;
    for (let index = previous.end; index < run.start; index += 1) {
      if (labels[index] === "music") music += 1;
    }
    const left = previous.end - previous.start;
    const right = run.end - run.start;
    const ratio = Math.min(left, right) / Math.max(left, right);
    const bridge = gap <= 10 && music <= 2 && (gap <= 3.5 || ratio >= 0.4);
    if (bridge) previous.end = run.end;
    else runs.push({ ...run });
  }

  const minDur = count < 180 ? Math.max(5, count * 0.18) : Math.min(6 * 60, Math.max(50, count * 0.08));

  function scoreRun(run: Run): number {
    const span = run.end - run.start;
    if (span < minDur) return 0;
    let sum = 0;
    for (let index = run.start; index < run.end; index += 1) sum += smooth[index] ?? 0;
    const mean = sum / span;
    const mid = (run.start + run.end) / 2 / count;
    let position = 1;
    if (mid < 0.12) position = 0.78;
    else if (mid > 0.93) position = 0.84;
    return mean * Math.sqrt(span) * position;
  }

  let best: Run | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const run of runs) {
    const score = scoreRun(run);
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = run;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  let content = 0;
  let speechSeconds = 0;
  for (let index = 0; index < count; index += 1) {
    if ((features[index]?.rms ?? 0) > silenceCut) content += 1;
    if (labels[index] === "speech") speechSeconds += 1;
  }
  const sermonOnly = content > 30 && speechSeconds > content * 0.88;

  let startIdx = 0;
  let endIdx = count;
  if (sermonOnly || !best) {
    while (startIdx < count && (features[startIdx]?.rms ?? 0) <= silenceCut) startIdx += 1;
    endIdx = count;
    while (endIdx > startIdx && (features[endIdx - 1]?.rms ?? 0) <= silenceCut) endIdx -= 1;
  } else {
    startIdx = best.start;
    endIdx = best.end;
    while (startIdx < endIdx - 1 && (features[startIdx]?.rms ?? 0) <= silenceCut) startIdx += 1;
    while (endIdx > startIdx + 1 && (features[endIdx - 1]?.rms ?? 0) <= silenceCut) endIdx -= 1;
  }

  let start = Math.max(0, startIdx - 0.35);
  let end = Math.min(duration, endIdx + 0.4);
  if (!(end - start >= 0.5)) {
    start = 0;
    end = duration;
  }

  const margin = bestScore > 0 ? (bestScore - secondScore) / bestScore : 0;
  let confidence = sermonOnly ? 0.78 : clamp(0.34 + margin * 0.45 + (best ? 0.18 : 0), 0.2, 0.94);
  if (!best && !sermonOnly) confidence = 0.28;

  const phrase = lengthPhrase(end - start);
  const at = clock(start);
  let reason: string;
  if (!best && !sermonOnly) {
    reason = "Couldn’t separate speaking from the music. The whole recording is selected — set the handles yourself.";
  } else if (sermonOnly) {
    reason = `This already sounds like the sermon — one voice almost the whole way. Quiet edges are trimmed. ${phrase}, from ${at}.`;
  } else {
    reason = `Guessed ${phrase} of speaking starting at ${at}, after the louder music. Drag the handles if the welcome or the closing song is still inside.`;
  }

  return { start, end, confidence, reason, labels };
}
