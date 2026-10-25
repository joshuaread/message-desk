import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSermon } from "../server/detect.js";
import { analyzeMono } from "../server/features.js";

// Build a synthetic per-second feature track: music / speech / music.
function band(n, f) {
  return Array.from({ length: n }, () => ({ ...f }));
}
const MUSIC = { rms: 0.32, zcr: 0.015, mod: 0.05, peak: 0.5 };
const SPEECH = { rms: 0.16, zcr: 0.09, mod: 0.5, peak: 0.35 };

test("detects the speech region between music sections", () => {
  const features = [...band(60, MUSIC), ...band(120, SPEECH), ...band(60, MUSIC)];
  const d = detectSermon(features, features.length);
  assert.ok(Math.abs(d.start - 60) <= 10, `start ${d.start} near 60`);
  assert.ok(Math.abs(d.end - 180) <= 10, `end ${d.end} near 180`);
  assert.ok(d.confidence > 0.4, `confidence ${d.confidence}`);
});

test("sermon-only recording keeps nearly the whole thing", () => {
  const features = [...band(5, { rms: 0, zcr: 0, mod: 0, peak: 0 }), ...band(150, SPEECH), ...band(5, { rms: 0, zcr: 0, mod: 0, peak: 0 })];
  const d = detectSermon(features, features.length);
  assert.ok(d.start < 12, `start ${d.start} trims the quiet head`);
  assert.ok(d.end > 150, `end ${d.end} keeps the body`);
});

test("empty input is handled", () => {
  const d = detectSermon([], 0);
  assert.equal(d.start, 0);
  assert.equal(d.end, 0);
  assert.equal(d.confidence, 0);
});

test("analyzeMono produces per-second features and peaks from PCM", () => {
  const rate = 8000;
  const secs = 4;
  const samples = new Float32Array(rate * secs);
  // A 200 Hz tone -> low zero-crossing-rate, low modulation.
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / rate);
  }
  const a = analyzeMono(samples, rate);
  assert.equal(a.features.length, secs);
  assert.ok(a.peaks.length > 0);
  assert.ok(a.features[1].rms > 0.2, "tone has energy");
  assert.ok(a.features[1].zcr < 0.1, "tone has low zcr");
});
