#!/usr/bin/env node
// End-to-end test. Starts a throwaway WordPress (WP Playground) and an
// in-process Message Desk server, then drives the whole pipeline through the
// real browser UI — upload, detect, nudge, export, transcribe, SEO, image,
// draft, publish — and verifies the published sermon page renders the player
// (uploaded MP3) and the featured image, and that the REST post carries the
// sermon_* meta + featured_media. Writes evidence (summary JSON, SVG/PNG,
// screenshots) to evidence/.
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, copyFile, rm, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { startPlayground } from "./wp-harness.mjs";
import { loadDotEnv, loadConfig } from "../server/config.js";
import { checkFfmpeg } from "../server/ffmpeg.js";
import { buildApp } from "../server/index.js";
import { assertNotLiveSite } from "../server/guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const AUDIO_DIR = join(ROOT, "test", "audio");
const EVIDENCE = join(ROOT, "evidence");
const WHISPER_DEFAULT = "/workspace/venv-whisper/bin/python";

const log = (m) => console.error(`[e2e] ${m}`);
const round = (n, d = 2) => (typeof n === "number" ? Math.round(n * 10 ** d) / 10 ** d : n);

function resolveChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM,
    "/home/box/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
    "/home/box/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell",
    "/usr/bin/chromium",
    "/usr/bin/ungoogled-chromium",
  ].filter(Boolean);
  for (const exe of candidates) if (existsSync(exe)) return exe;
  try {
    const exe = chromium.executablePath();
    if (existsSync(exe)) return exe;
  } catch {
    /* ignore */
  }
  return null;
}

async function jobState(base, id) {
  const res = await fetch(`${base}/api/job/${id}`);
  if (!res.ok) throw new Error(`job ${id} fetch ${res.status}`);
  return res.json();
}

async function httpJson(base, path, opts) {
  const res = await fetch(base + path, opts);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

async function main() {
  // --- citizenschur.ch guard: never run the tests against the real site. ---
  loadDotEnv();
  assertNotLiveSite(process.env.WP_URL ?? "");

  // --- Ensure the synthetic service recording + truth exist. ---
  if (!existsSync(join(AUDIO_DIR, "sunday-service.m4a"))) {
    log("generating test audio");
    const r = spawnSync(process.execPath, [join(here, "make-test-audio.mjs")], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("make-test-audio failed");
  }
  const truth = JSON.parse(await readFile(join(AUDIO_DIR, "sunday-service.json"), "utf8"));
  const m4a = join(AUDIO_DIR, "sunday-service.m4a");
  const wav = join(AUDIO_DIR, "sunday-service.wav");

  const exe = resolveChromium();
  if (!exe) throw new Error("No Chromium for Playwright. Run: npx playwright install chromium");
  log(`chromium: ${exe}`);

  await mkdir(EVIDENCE, { recursive: true });
  const ffmpegInfo = await checkFfmpeg();

  const summary = { startedAt: new Date().toISOString(), truth, assertions: [] };
  const assert = (name, cond, detail) => {
    summary.assertions.push({ name, pass: Boolean(cond), detail });
    if (!cond) throw new Error(`ASSERTION FAILED: ${name} — ${detail ?? ""}`);
    log(`ok: ${name}${detail ? ` (${detail})` : ""}`);
  };

  let wp = null;
  let server = null;
  let browser = null;
  const dataDir = join(EVIDENCE, "_jobdata");
  await rm(dataDir, { recursive: true, force: true });

  try {
    wp = await startPlayground({ port: Number(process.env.WP_PORT ?? 9400), log });
    summary.wordpress = { base: wp.base, user: wp.user };

    // In-process Message Desk server against the throwaway WP.
    const config = loadConfig();
    config.wpUrl = wp.base;
    config.wpUser = wp.user;
    config.wpAppPassword = wp.password;
    config.wpAllowHttp = true;
    config.dataDir = dataDir;
    if (!config.whisperPython && existsSync(WHISPER_DEFAULT)) config.whisperPython = WHISPER_DEFAULT;
    assertNotLiveSite(config.wpUrl);

    const app = buildApp(config, ffmpegInfo);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    summary.desk = base;
    log(`desk server on ${base}`);
    log(`transcription engine configured: ${config.xaiApiKey ? "xai (fallback: whisper)" : config.whisperPython ? "whisper" : "none"}`);

    browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Auto-accept the "publish live?" confirm().
    context.on("page", (pg) => pg.on("dialog", (d) => d.accept().catch(() => {})));
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") log(`[browser] ${m.text().slice(0, 160)}`);
    });
    await page.goto(base, { waitUntil: "load" });

    // 1. Upload + detect.
    log("UI: upload + detect");
    await page.setInputFiles("#file", m4a);
    await page.click("#upload-btn");
    await page.waitForSelector("#upload-status.ok", { timeout: 120_000 });
    await page.waitForSelector("#card-detect:not(.hidden)", { timeout: 5_000 });
    const jobId = await page.evaluate(() => window.MESSAGE_DESK?.jobId);
    assert("got a job id", jobId, jobId);

    let job = await jobState(base, jobId);
    const det = job.detection;
    const inErr = Math.abs(det.start - truth.speechStart);
    const outErr = Math.abs(det.end - truth.speechEnd);
    summary.detection = {
      detectedIn: round(det.start, 1), detectedOut: round(det.end, 1),
      truthIn: truth.speechStart, truthOut: truth.speechEnd,
      inErrSec: round(inErr, 1), outErrSec: round(outErr, 1),
      confidence: round(det.confidence),
    };
    await page.screenshot({ path: join(EVIDENCE, "desk-1-after-detect.png"), fullPage: true });
    assert("detection in within ±10s", inErr <= truth.tolerance, `${round(inErr, 1)}s`);
    assert("detection out within ±10s", outErr <= truth.tolerance, `${round(outErr, 1)}s`);

    // 2. Nudge (exercise the ±5s buttons; net-zero so the selection stays good).
    log("UI: nudge handles");
    await page.click('.step[data-edge="in"][data-delta="-5"]');
    await page.click('.step[data-edge="in"][data-delta="5"]');
    await page.click('.step[data-edge="out"][data-delta="5"]');
    await page.click('.step[data-edge="out"][data-delta="-5"]');
    const nudged = await page.evaluate(() => window.MESSAGE_DESK?.sel);
    summary.nudge = { in: round(nudged.in, 1), out: round(nudged.out, 1) };

    // 3. Export (clean + loudnorm).
    log("UI: export");
    await page.click("#export-btn");
    await page.waitForSelector("#export-status.ok, #export-status.err", { timeout: 180_000 });
    job = await jobState(base, jobId);
    const ex = job.exportResult;
    summary.export = {
      durationSec: round(ex.duration, 1), lufs: ex.lufs, truePeak: ex.truePeak, lra: ex.lra,
      passes: ex.passes, inSpec: ex.inSpec, filename: ex.filename,
    };
    assert("export LUFS within -16 ±1", ex.lufs != null && Math.abs(ex.lufs + 16) <= 1, `${ex.lufs} LUFS`);
    assert("export true peak <= -1.5 dBTP", ex.truePeak != null && ex.truePeak <= -1.5, `${ex.truePeak} dBTP`);

    // 4. Transcribe.
    log("UI: transcribe (may take a while)");
    await page.click("#transcribe-btn");
    await page.waitForSelector("#transcribe-status.ok, #transcribe-status.err", { timeout: 420_000 });
    job = await jobState(base, jobId);
    assert("a transcript was produced", job.transcript && job.transcript.engine !== "none" && job.transcript.text.length > 0,
      `${job.transcript?.engine}`);
    summary.transcript = {
      engine: job.transcript.engine,
      note: job.transcript.note,
      chars: job.transcript.text.length,
      words: job.transcript.words.length,
      sample: job.transcript.text.slice(0, 160),
    };

    // 5. SEO.
    log("UI: SEO");
    await page.fill("#seo-speaker", "Daniel Williamson");
    await page.fill("#seo-series", "Jonah");
    await page.click("#seo-btn");
    await page.waitForSelector("#seo-status.ok", { timeout: 180_000 });
    job = await jobState(base, jobId);
    const seo = job.seo;
    summary.seo = {
      engine: job.steps.seo.message,
      title: seo.title, slug: seo.slug, scripture: seo.scripture,
      metaDescription: seo.metaDescription, excerpt: seo.excerpt,
      tags: seo.tags, date: seo.date,
    };
    await page.screenshot({ path: join(EVIDENCE, "desk-2-after-seo.png"), fullPage: true });
    assert("SEO title is not the first spoken sentence", seo.title && !/^good morning/i.test(seo.title), seo.title);
    // The verses are transcribed reliably as digits ("chapter 1, verses 7 through
    // 16"); the book depends on ASR hearing "Jonah" vs "John". Assert the parser
    // produced a normalized <Book> 1:7-16 reference (exact-book parsing is unit-tested).
    assert("SEO scripture parsed to Book chapter:verses", /^[1-3]?\s?[A-Za-z]+ 1:7-16$/.test(seo.scripture), seo.scripture);

    // 6. Image.
    log("UI: featured image");
    await page.click("#image-btn");
    await page.waitForSelector("#image-preview:not(.hidden)", { timeout: 60_000 });
    job = await jobState(base, jobId);
    summary.image = job.image;
    assert("image alt text set", job.image && job.image.alt.length > 0, job.image?.alt);

    // 7. Publish guard: an unconfirmed publish must be rejected.
    const guard = await httpJson(base, `/api/job/${jobId}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "publish" }),
    });
    assert("publish guard rejects unconfirmed publish", guard.status === 400, `status ${guard.status}`);

    // 8. Probe + draft + live publish via the UI.
    log("UI: probe");
    await page.click("#probe-btn");
    await page.waitForSelector("#probe-info.ok", { timeout: 60_000 });

    log("UI: save draft");
    await page.click("#publish-btn");
    await page.waitForSelector("#publish-status.ok, #publish-status.err", { timeout: 120_000 });
    job = await jobState(base, jobId);
    assert("draft created", job.publish && job.publish.status === "draft", job.publish?.status);

    log("UI: publish live");
    await page.click("#publish-live-btn");
    await page.waitForFunction(
      () => {
        const el = document.getElementById("publish-status");
        return el && (el.textContent || "").includes("publish");
      },
      { timeout: 120_000 },
    );
    job = await jobState(base, jobId);
    const pub = job.publish;
    summary.publish = {
      postId: pub.postId, status: pub.status, link: pub.link,
      mediaId: pub.mediaId, imageId: pub.imageId,
      audioUrl: pub.audioUrl, keptMeta: pub.keptMeta, seoPlugin: pub.seoPlugin,
    };
    assert("post is published", pub.status === "publish", pub.status);
    assert("featured image attached", pub.imageId > 0, `media ${pub.imageId}`);
    assert("sermon_* meta kept by WP",
      ["sermon_speaker", "sermon_scripture", "sermon_audio_url", "sermon_transcript"].every((k) => pub.keptMeta.includes(k)),
      pub.keptMeta.join(","));

    // 9. Verify the published page HTML + REST shape.
    log("verifying published sermon page");
    const pageHtml = await (await fetch(pub.link)).text();
    const audioCount = (pageHtml.match(/<audio\b/gi) || []).length;
    const mp3Src = new RegExp(`<audio[\\s\\S]*?${pub.mediaId ? "" : ""}cleaned[^"'<> ]*\\.mp3`, "i").test(pageHtml) ||
      pageHtml.includes(pub.audioUrl);
    const imgFound = pageHtml.includes("--cs-img") && /citizens-church[^"')]*\.png/i.test(pageHtml);
    summary.verify = { pageUrl: pub.link, audioCount, mp3InPlayer: mp3Src, featuredImageInHeader: imgFound };
    assert("exactly one <audio> player on the page", audioCount === 1, `found ${audioCount}`);
    assert("player source is the uploaded cleaned MP3", mp3Src, pub.audioUrl);
    assert("featured image rendered in the sermon header", imgFound);

    // REST shape.
    const restPost = await (await fetch(`${wp.base}/wp-json/wp/v2/sermon/${pub.postId}`)).json();
    assert("REST post has featured_media", restPost.featured_media === pub.imageId, `${restPost.featured_media}`);
    assert("REST meta has sermon_audio_url", restPost.meta?.sermon_audio_url === pub.audioUrl);

    await page.goto(pub.link, { waitUntil: "load" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(EVIDENCE, "sermon-3-published-page.png"), fullPage: true });

    // Phone-width shot of the desk for the "phone-friendly" claim.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pphone = await phone.newPage();
    await pphone.goto(base, { waitUntil: "load" });
    await pphone.screenshot({ path: join(EVIDENCE, "desk-4-phone.png"), fullPage: true });
    await phone.close();

    // 10. WAV path: detection + export only (board-style 48k stereo input).
    log("WAV: upload + detect + export");
    const wavBytes = await readFile(wav);
    const form = new FormData();
    form.append("file", new Blob([wavBytes]), "sunday-service.wav");
    const wup = await (await fetch(`${base}/api/upload`, { method: "POST", body: form })).json();
    const wInErr = Math.abs(wup.selection.in - truth.speechStart);
    const wOutErr = Math.abs(wup.selection.out - truth.speechEnd);
    const wex = await (await fetch(`${base}/api/job/${wup.id}/export`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ in: wup.selection.in, out: wup.selection.out }),
    })).json();
    summary.wav = {
      detectedIn: round(wup.selection.in, 1), detectedOut: round(wup.selection.out, 1),
      inErrSec: round(wInErr, 1), outErrSec: round(wOutErr, 1),
      lufs: wex.export.lufs, truePeak: wex.export.truePeak, inSpec: wex.export.inSpec,
    };
    assert("WAV detection within ±10s", wInErr <= truth.tolerance && wOutErr <= truth.tolerance,
      `in ${round(wInErr, 1)}s / out ${round(wOutErr, 1)}s`);
    assert("WAV export within loudness spec", wex.export.inSpec, `${wex.export.lufs} LUFS / ${wex.export.truePeak} dBTP`);

    // --- Evidence artefacts. ---
    const jobDir = join(dataDir, jobId);
    for (const [src, dst] of [
      [join(jobDir, "image.svg"), join(EVIDENCE, "featured-image.svg")],
      [join(jobDir, "image.png"), join(EVIDENCE, "featured-image.png")],
      [join(jobDir, "cleaned.mp3"), join(EVIDENCE, "cleaned.mp3")],
    ]) {
      try {
        await copyFile(src, dst);
      } catch {
        /* optional */
      }
    }

    summary.ok = true;
    summary.finishedAt = new Date().toISOString();
    await writeFile(join(EVIDENCE, "e2e-summary.json"), JSON.stringify(summary, null, 2));

    log("E2E PASSED");
    console.log("\n=== evidence ===");
    const files = await readdir(EVIDENCE);
    for (const f of files.sort()) console.log("  evidence/" + f);
    console.log("\n=== summary ===");
    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    summary.ok = false;
    summary.error = e.message;
    try {
      await writeFile(join(EVIDENCE, "e2e-summary.json"), JSON.stringify(summary, null, 2));
    } catch {
      /* ignore */
    }
    log("E2E FAILED: " + e.message);
    throw e;
  } finally {
    try {
      if (browser) await browser.close();
    } catch {}
    try {
      if (server) server.close();
    } catch {}
    try {
      if (wp) await wp.stop();
    } catch {}
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  },
);
