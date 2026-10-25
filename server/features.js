// Per-second feature extraction + waveform peaks from a mono PCM stream.
// ffmpeg decodes any input (m4a/mp3/wav, any rate/depth) to a low mono analysis
// rate, so even a multi-GB board recording is cheap to scan.

export const PEAKS_PER_SEC = 8;
export const ANALYSIS_RATE = 8000;

/**
 * @typedef {{ rms:number, zcr:number, mod:number, peak:number }} SecondFeature
 * @typedef {{ duration:number, peaks:number[], peaksPerSec:number, features:SecondFeature[] }} Analysis
 */

/**
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Analysis}
 */
export function analyzeMono(samples, sampleRate) {
  const totalFrames = samples.length;
  const duration = totalFrames / sampleRate;
  const peakCount = Math.max(1, Math.ceil(duration * PEAKS_PER_SEC));
  const peaks = new Array(peakCount * 2);
  for (let index = 0; index < peakCount; index += 1) {
    peaks[index * 2] = 1;
    peaks[index * 2 + 1] = -1;
  }

  const subLength = Math.max(1, Math.round(sampleRate * 0.05));
  const buckets = new Map();

  const pushAnalysis = (second, sample) => {
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

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    const sample = samples[frameIndex] ?? 0;
    const time = frameIndex / sampleRate;
    const peakIndex = Math.min(peakCount - 1, Math.floor(time * PEAKS_PER_SEC));
    const minSlot = peakIndex * 2;
    const maxSlot = minSlot + 1;
    if (sample < (peaks[minSlot] ?? 1)) peaks[minSlot] = sample;
    if (sample > (peaks[maxSlot] ?? -1)) peaks[maxSlot] = sample;
    pushAnalysis(Math.floor(time), sample);
  }

  for (let index = 0; index < peakCount; index += 1) {
    if ((peaks[index * 2] ?? 1) > (peaks[index * 2 + 1] ?? -1)) {
      peaks[index * 2] = 0;
      peaks[index * 2 + 1] = 0;
    }
  }

  const seconds = Math.max(1, Math.ceil(duration));
  const features = [];
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

  return { duration, peaks, peaksPerSec: PEAKS_PER_SEC, features };
}
