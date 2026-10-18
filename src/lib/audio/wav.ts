import type { SecondFeature } from "./detect.ts";

export const PEAKS_PER_SEC = 8;

export type WavSource = {
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
};

export type WavInfo = {
  channels: number;
  sampleRate: number;
  bits: number;
  audioFormat: 1 | 3;
  blockAlign: number;
  dataOffset: number;
  dataSize: number;
};

export type Analysis = {
  info: WavInfo;
  duration: number;
  peaks: Float32Array;
  peaksPerSec: number;
  features: SecondFeature[];
};

type Parse =
  | { complete: true; info: WavInfo }
  | { complete: false; error?: string };

function fourcc(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return "";
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function tryParse(bytes: Uint8Array, fileSize: number): Parse {
  if (bytes.length < 12) return { complete: false, error: "This file is too small to be a WAV." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = fourcc(bytes, 0);
  if (riff !== "RIFF" && riff !== "RF64") {
    return { complete: false, error: "This isn’t a WAV file. Export PCM WAV from the recorder." };
  }
  if (fourcc(bytes, 8) !== "WAVE") {
    return { complete: false, error: "This isn’t a WAV file." };
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let blockAlign = 0;
  let sawFmt = false;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const id = fourcc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (id !== "data" && dataStart + size > bytes.length) return { complete: false };
    if (id === "fmt ") {
      if (size < 16) return { complete: false, error: "This WAV is missing its format header." };
      audioFormat = view.getUint16(dataStart, true);
      channels = view.getUint16(dataStart + 2, true);
      sampleRate = view.getUint32(dataStart + 4, true);
      blockAlign = view.getUint16(dataStart + 12, true);
      bits = view.getUint16(dataStart + 14, true);
      if (audioFormat === 0xfffe && size >= 40) {
        audioFormat = view.getUint16(dataStart + 24, true);
      }
      sawFmt = true;
    } else if (id === "data") {
      dataOffset = dataStart;
      dataSize = size === 0xffffffff ? Math.max(0, fileSize - dataStart) : size;
      break;
    }
    const step = 8 + size + (size & 1);
    if (step <= 0) return { complete: false, error: "Couldn’t read this WAV." };
    offset += step;
  }

  if (!sawFmt || dataOffset < 0) return { complete: false };
  if (audioFormat !== 1 && audioFormat !== 3) {
    return {
      complete: false,
      error: "This WAV is compressed. Export 16-bit or 24-bit PCM from the recorder.",
    };
  }
  if (channels < 1 || channels > 8 || sampleRate < 8000 || sampleRate > 192000) {
    return { complete: false, error: "This WAV uses a sample rate or channel count Message Desk can’t read." };
  }
  if (![8, 16, 24, 32].includes(bits)) {
    return { complete: false, error: "Export 16-bit or 24-bit PCM WAV. This bit depth isn’t supported." };
  }
  if (!blockAlign) blockAlign = channels * (bits / 8);
  dataSize = Math.min(dataSize, Math.max(0, fileSize - dataOffset));
  dataSize -= dataSize % blockAlign;
  return {
    complete: true,
    info: { channels, sampleRate, bits, audioFormat, blockAlign, dataOffset, dataSize },
  };
}

export async function readWavInfo(source: WavSource): Promise<WavInfo> {
  let size = Math.min(source.size, 65536);
  let lastError = "Couldn’t find the audio in this WAV.";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = await source.read(0, size);
    const parsed = tryParse(bytes, source.size);
    if (parsed.complete) return parsed.info;
    if (parsed.error) lastError = parsed.error;
    if (size >= source.size || size >= 8 * 1024 * 1024) break;
    size = Math.min(source.size, Math.max(size * 4, 256 * 1024), 8 * 1024 * 1024);
  }
  throw new Error(lastError);
}

function readSample(view: DataView, offset: number, bits: number, format: 1 | 3): number {
  if (format === 3 && bits === 32) return view.getFloat32(offset, true);
  if (bits === 16) return view.getInt16(offset, true) / 32768;
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 24) {
    const b0 = view.getUint8(offset);
    const b1 = view.getUint8(offset + 1);
    const b2 = view.getUint8(offset + 2);
    let value = b0 | (b1 << 8) | (b2 << 16);
    if (value & 0x800000) value |= ~0xffffff;
    return value / 8388608;
  }
  if (bits === 32) return view.getInt32(offset, true) / 2147483648;
  throw new Error(`Unsupported WAV sample format (${bits}-bit).`);
}

export function decodeMono(bytes: Uint8Array, info: Pick<WavInfo, "channels" | "bits" | "audioFormat" | "blockAlign">): Float32Array {
  const channels = info.channels;
  const bytesPer = info.blockAlign;
  const frames = Math.floor(bytes.length / bytesPer);
  const out = new Float32Array(frames);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (info.audioFormat === 1 && info.bits === 16 && channels === 1) {
    for (let index = 0; index < frames; index += 1) out[index] = view.getInt16(index * 2, true) / 32768;
    return out;
  }
  if (info.audioFormat === 1 && info.bits === 16 && channels === 2) {
    for (let index = 0; index < frames; index += 1) {
      const offset = index * 4;
      out[index] = (view.getInt16(offset, true) + view.getInt16(offset + 2, true)) / 65536;
    }
    return out;
  }
  if (info.audioFormat === 3 && info.bits === 32 && channels === 1) {
    for (let index = 0; index < frames; index += 1) out[index] = view.getFloat32(index * 4, true);
    return out;
  }
  if (info.audioFormat === 3 && info.bits === 32 && channels === 2) {
    for (let index = 0; index < frames; index += 1) {
      const offset = index * 8;
      out[index] = (view.getFloat32(offset, true) + view.getFloat32(offset + 4, true)) / 2;
    }
    return out;
  }
  const sampleBytes = info.bits / 8;
  for (let index = 0; index < frames; index += 1) {
    let sum = 0;
    const base = index * bytesPer;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += readSample(view, base + channel * sampleBytes, info.bits, info.audioFormat);
    }
    out[index] = sum / channels;
  }
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export async function forEachMonoBlock(
  source: WavSource,
  info: WavInfo,
  startFrame: number,
  endFrame: number,
  onBlock: (samples: Float32Array) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const bytesPer = info.blockAlign;
  let position = info.dataOffset + startFrame * bytesPer;
  const end = info.dataOffset + endFrame * bytesPer;
  let pending = new Uint8Array(0);
  while (position < end) {
    if (signal?.aborted) throw new Error("Cancelled");
    const take = Math.min(1024 * 1024, end - position);
    const chunk = await source.read(position, position + take);
    if (chunk.length === 0) break;
    position += chunk.length;
    const merged = pending.length ? concat(pending, chunk) : chunk;
    const usable = merged.length - (merged.length % bytesPer);
    pending = merged.slice(usable);
    if (usable > 0) await onBlock(decodeMono(merged.subarray(0, usable), info));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

type Bucket = {
  sumSq: number;
  count: number;
  crossings: number;
  previous: number;
  hasPrevious: boolean;
  subSumSq: number;
  subCount: number;
  subRms: number[];
  peak: number;
};

export async function analyzeWav(
  source: WavSource,
  options?: { signal?: AbortSignal; onProgress?: (ratio: number) => void },
): Promise<Analysis> {
  const info = await readWavInfo(source);
  const totalFrames = Math.floor(info.dataSize / info.blockAlign);
  if (totalFrames < info.sampleRate / 10) throw new Error("This WAV has almost no audio.");
  const duration = totalFrames / info.sampleRate;
  const peakCount = Math.max(1, Math.ceil(duration * PEAKS_PER_SEC));
  const peaks = new Float32Array(peakCount * 2);
  for (let index = 0; index < peakCount; index += 1) {
    peaks[index * 2] = 1;
    peaks[index * 2 + 1] = -1;
  }

  const decimate = Math.max(1, Math.round(info.sampleRate / 8000));
  const analysisRate = info.sampleRate / decimate;
  const subLength = Math.max(1, Math.round(analysisRate * 0.05));
  const buckets = new Map<number, Bucket>();
  let frameIndex = 0;
  let decimSum = 0;
  let decimCount = 0;

  const pushAnalysis = (second: number, sample: number) => {
    let bucket = buckets.get(second);
    if (!bucket) {
      bucket = {
        sumSq: 0,
        count: 0,
        crossings: 0,
        previous: 0,
        hasPrevious: false,
        subSumSq: 0,
        subCount: 0,
        subRms: [],
        peak: 0,
      };
      buckets.set(second, bucket);
    }
    const abs = Math.abs(sample);
    if (abs > bucket.peak) bucket.peak = abs;
    bucket.sumSq += sample * sample;
    bucket.count += 1;
    if (bucket.hasPrevious) {
      const crossed = (sample >= 0 && bucket.previous < 0) || (sample < 0 && bucket.previous >= 0);
      if (crossed && (abs > 0.0008 || Math.abs(bucket.previous) > 0.0008)) bucket.crossings += 1;
    }
    bucket.previous = sample;
    bucket.hasPrevious = true;
    bucket.subSumSq += sample * sample;
    bucket.subCount += 1;
    if (bucket.subCount >= subLength) {
      bucket.subRms.push(Math.sqrt(bucket.subSumSq / bucket.subCount));
      bucket.subSumSq = 0;
      bucket.subCount = 0;
    }
  };

  await forEachMonoBlock(source, info, 0, totalFrames, (block) => {
    for (let index = 0; index < block.length; index += 1) {
      const sample = block[index] ?? 0;
      const time = frameIndex / info.sampleRate;
      const peakIndex = Math.min(peakCount - 1, Math.floor(time * PEAKS_PER_SEC));
      const minSlot = peakIndex * 2;
      const maxSlot = minSlot + 1;
      if (sample < (peaks[minSlot] ?? 1)) peaks[minSlot] = sample;
      if (sample > (peaks[maxSlot] ?? -1)) peaks[maxSlot] = sample;
      decimSum += sample;
      decimCount += 1;
      if (decimCount >= decimate) {
        pushAnalysis(Math.floor(time), decimSum / decimCount);
        decimSum = 0;
        decimCount = 0;
      }
      frameIndex += 1;
    }
    options?.onProgress?.(frameIndex / totalFrames);
  }, options?.signal);

  for (let index = 0; index < peakCount; index += 1) {
    if ((peaks[index * 2] ?? 1) > (peaks[index * 2 + 1] ?? -1)) {
      peaks[index * 2] = 0;
      peaks[index * 2 + 1] = 0;
    }
  }

  const seconds = Math.max(1, Math.ceil(duration));
  const features: SecondFeature[] = [];
  for (let second = 0; second < seconds; second += 1) {
    const bucket = buckets.get(second);
    if (!bucket || bucket.count === 0) {
      features.push({ rms: 0, zcr: 0, mod: 0, peak: 0 });
      continue;
    }
    if (bucket.subCount > 0) {
      bucket.subRms.push(Math.sqrt(bucket.subSumSq / bucket.subCount));
    }
    let mod = 0;
    if (bucket.subRms.length >= 2) {
      let sum = 0;
      let sumSq = 0;
      for (const value of bucket.subRms) {
        sum += value;
        sumSq += value * value;
      }
      const mean = sum / bucket.subRms.length;
      const variance = Math.max(0, sumSq / bucket.subRms.length - mean * mean);
      mod = mean > 1e-5 ? Math.sqrt(variance) / mean : 0;
    }
    features.push({
      rms: Math.sqrt(bucket.sumSq / bucket.count),
      zcr: bucket.crossings / bucket.count,
      mod,
      peak: bucket.peak,
    });
  }

  return { info, duration, peaks, peaksPerSec: PEAKS_PER_SEC, features };
}

export function fileSource(file: File): WavSource {
  return {
    size: file.size,
    async read(start, end) {
      const buffer = await file.slice(start, end).arrayBuffer();
      return new Uint8Array(buffer);
    },
  };
}

export function bytesSource(bytes: Uint8Array): WavSource {
  return {
    size: bytes.length,
    async read(start, end) {
      const from = Math.max(0, start);
      const to = Math.min(bytes.length, end);
      return bytes.subarray(from, to);
    },
  };
}

export function frameCount(info: WavInfo): number {
  return Math.floor(info.dataSize / info.blockAlign);
}

export function buildWav(samples: Float32Array, sampleRate: number, bits: 16 | 24 = 16): Uint8Array {
  const channels = 1;
  const blockAlign = bits / 8;
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set([82, 73, 70, 70], 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  bytes.set([100, 97, 116, 97], 36);
  view.setUint32(40, dataSize, true);
  let offset = 44;
  if (bits === 16) {
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
      view.setInt16(offset, Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), true);
      offset += 2;
    }
  } else {
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
      let value = Math.max(-8388608, Math.min(8388607, Math.round(sample * 8388607)));
      if (value < 0) value += 0x1000000;
      bytes[offset] = value & 0xff;
      bytes[offset + 1] = (value >> 8) & 0xff;
      bytes[offset + 2] = (value >> 16) & 0xff;
      offset += 3;
    }
  }
  return bytes;
}
