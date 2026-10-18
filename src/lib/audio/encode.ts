import { forEachMonoBlock, frameCount, type WavInfo, type WavSource } from "./wav.ts";

export type CleanOptions = {
  cutRumble: boolean;
  tightenQuiet: boolean;
  normalize: boolean;
  bitrate: number;
};

function makeHighpass(sampleRate: number, frequency: number): (sample: number) => number {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * 0.707);
  const a0 = 1 + alpha;
  const b0 = (1 + cosine) / 2 / a0;
  const b1 = -(1 + cosine) / a0;
  const b2 = (1 + cosine) / 2 / a0;
  const a1 = (-2 * cosine) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (sample: number) => {
    const output = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = sample;
    y2 = y1;
    y1 = output;
    return output;
  };
}

function makeLowpass(sampleRate: number, frequency: number): (sample: number) => number {
  const amount = 1 - Math.exp((-2 * Math.PI * frequency) / sampleRate);
  let state = 0;
  return (sample: number) => {
    state += amount * (sample - state);
    return state;
  };
}

export function chooseOutRate(sampleRate: number): number {
  if (sampleRate <= 24000) {
    const allowed = [8000, 11025, 12000, 16000, 22050, 24000];
    return allowed.includes(sampleRate) ? sampleRate : 16000;
  }
  if (sampleRate % 24000 === 0) return 24000;
  return 22050;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

function limit(sample: number): number {
  const threshold = 0.89;
  const abs = Math.abs(sample);
  if (abs <= threshold) return sample;
  const sign = sample < 0 ? -1 : 1;
  const over = abs - threshold;
  return sign * (threshold + (1 - threshold) * Math.tanh(over / (1 - threshold)));
}

export async function encodeSermonMp3(
  source: WavSource,
  info: WavInfo,
  startSec: number,
  endSec: number,
  options: CleanOptions,
  onProgress?: (ratio: number, label: string) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const totalFrames = frameCount(info);
  const startFrame = Math.max(0, Math.min(totalFrames - 1, Math.floor(startSec * info.sampleRate)));
  const endFrame = Math.max(startFrame + 1, Math.min(totalFrames, Math.ceil(endSec * info.sampleRate)));
  const frames = endFrame - startFrame;
  if (frames < info.sampleRate * 0.4) throw new Error("Select at least half a second of audio.");

  const highpassHz = options.cutRumble ? 80 : 20;
  const outRate = chooseOutRate(info.sampleRate);
  const blockSize = Math.max(1, Math.round(info.sampleRate * 0.02));
  const highpass = makeHighpass(info.sampleRate, highpassHz);
  const blockRms: number[] = [];
  let sumSq = 0;
  let count = 0;
  let peak = 0;
  let blockSum = 0;
  let blockCount = 0;
  let seen = 0;

  await forEachMonoBlock(source, info, startFrame, endFrame, (block) => {
    for (let index = 0; index < block.length; index += 1) {
      const filtered = highpass(block[index] ?? 0);
      const abs = Math.abs(filtered);
      if (abs > peak) peak = abs;
      sumSq += filtered * filtered;
      count += 1;
      blockSum += filtered * filtered;
      blockCount += 1;
      if (blockCount >= blockSize) {
        blockRms.push(Math.sqrt(blockSum / blockCount));
        blockSum = 0;
        blockCount = 0;
      }
    }
    seen += block.length;
    onProgress?.(Math.min(0.4, (seen / frames) * 0.4), "Measuring the sermon");
  }, signal);
  if (blockCount > 0) blockRms.push(Math.sqrt(blockSum / blockCount));

  const rms = Math.sqrt(sumSq / Math.max(1, count));
  let makeup = 1;
  if (options.normalize) {
    makeup = 0.158 / Math.max(rms, 1e-6);
    if (peak * makeup > 0.94) makeup = 0.94 / Math.max(peak, 1e-6);
    makeup = Math.min(makeup, 8);
  } else if (peak > 0.98) {
    makeup = 0.94 / peak;
  }

  const quiet = percentile(blockRms, 0.15);
  const mid = percentile(blockRms, 0.5);
  const gate = options.tightenQuiet && quiet < mid * 0.35;
  const gateAt = quiet * 1.8;
  const gainFor = (blockIndex: number) => {
    if (!gate) return 1;
    const level = blockRms[blockIndex];
    if (level === undefined) return 1;
    return level < gateAt ? 0.18 : 1;
  };

  const fadeIn = Math.min(Math.round(info.sampleRate * 0.04), Math.floor(frames * 0.15));
  const fadeOut = Math.min(Math.round(info.sampleRate * 0.12), Math.floor(frames * 0.15));
  const filter = makeHighpass(info.sampleRate, highpassHz);
  const lowpass =
    outRate < info.sampleRate * 0.95 ? makeLowpass(info.sampleRate, outRate * 0.45) : (sample: number) => sample;
  const step = info.sampleRate / outRate;
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, outRate, options.bitrate);
  const pcm = new Int16Array(1152);
  let pcmCount = 0;
  const parts: Uint8Array[] = [];
  const pushPcm = (sample: number) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    pcm[pcmCount] = (clipped < 0 ? clipped * 32768 : clipped * 32767) | 0;
    pcmCount += 1;
    if (pcmCount === 1152) {
      const encoded = encoder.encodeBuffer(pcm);
      if (encoded.length) parts.push(encoded.slice());
      pcmCount = 0;
    }
  };

  let position = 0;
  let previous = 0;
  let hasPrevious = false;
  let processed = 0;

  await forEachMonoBlock(source, info, startFrame, endFrame, (block) => {
    const filtered = new Float32Array(block.length);
    for (let index = 0; index < block.length; index += 1) {
      const at = processed + index;
      const blockIndex = Math.floor(at / blockSize);
      const previousGain = gainFor(blockIndex - 1);
      const nextGain = gainFor(blockIndex);
      const blend = (at % blockSize) / blockSize;
      let envelope = 1;
      if (fadeIn > 0 && at < fadeIn) envelope = at / fadeIn;
      else if (fadeOut > 0 && at > frames - fadeOut) envelope = Math.max(0, (frames - at) / fadeOut);
      const shaped = limit(filter(block[index] ?? 0) * makeup * (previousGain + (nextGain - previousGain) * blend) * envelope);
      filtered[index] = lowpass(shaped);
    }
    if (!hasPrevious) {
      previous = filtered[0] ?? 0;
      hasPrevious = true;
    }
    while (position < filtered.length) {
      const index = Math.floor(position);
      const fraction = position - index;
      const left = index <= 0 ? previous : (filtered[index - 1] ?? previous);
      const right = filtered[index] ?? left;
      pushPcm(left + (right - left) * fraction);
      position += step;
    }
    position -= filtered.length;
    previous = filtered[filtered.length - 1] ?? previous;
    processed += block.length;
    onProgress?.(0.4 + Math.min(0.6, (processed / frames) * 0.6), "Encoding MP3");
  }, signal);

  if (pcmCount > 0) {
    const encoded = encoder.encodeBuffer(pcm.subarray(0, pcmCount));
    if (encoded.length) parts.push(encoded.slice());
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail.slice());

  let length = 0;
  for (const part of parts) length += part.length;
  const mp3 = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    mp3.set(part, offset);
    offset += part.length;
  }
  if (mp3.length < 64) throw new Error("Encoding produced an empty MP3. Try the trim again.");
  return mp3;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 8192;
  for (let index = 0; index < bytes.length; index += stride) {
    const slice = bytes.subarray(index, index + stride);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
