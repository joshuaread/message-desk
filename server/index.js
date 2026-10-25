import express from "express";
import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig, loadDotEnv } from "./config.js";
import { checkFfmpeg, probe as probeAudio, analyze, makePreview, cleanExport } from "./ffmpeg.js";
import { detectSermon } from "./detect.js";
import { transcribe } from "./transcribe.js";
import { wordsToTranscript, textToParagraphs, clipForSuggestion, sermonKeyterms } from "./transcript.js";
import { buildHeuristicSeo, slugify } from "./seo.js";
import { xaiSeo } from "./xai.js";
import { renderImages, formatDate } from "./image.js";
import { MOTIFS, chooseMotif } from "./banner.js";
import { WpClient, buildContent, shouldEmbedAudio } from "./wordpress.js";
import { resolvePublishStatus } from "./guard.js";
import { defaultServiceDate } from "./dates.js";
import {
  createJob, loadJob, saveJob, setStep, jobPaths, cleanupOldJobs,
} from "./jobs.js";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(here, "../public");

function serviceFilename(dateIso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  if (!m) return "Message-cleaned.mp3";
  return `Message-${m[2]}-${m[3]}-${m[1].slice(2)}-cleaned.mp3`;
}

// Small async route wrapper so thrown errors become 500 JSON instead of hanging.
function wrap(handler) {
  return (req, res, next) => handler(req, res).catch(next);
}

/**
 * Build the Express app (all routes) without binding a port. Used by main()
 * and by the in-process e2e harness.
 */
export function buildApp(config, ffmpegInfo) {
  const defaultDate = (job) => defaultServiceDate(config.timezone, job?.source?.creationTime);

  let wp = null;
  const wpClient = () => {
    if (!wp) {
      wp = new WpClient({
        url: config.wpUrl,
        user: config.wpUser,
        appPassword: config.wpAppPassword,
        allowHttp: config.wpAllowHttp,
      });
    }
    return wp;
  };

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Optional HTTP Basic auth for the whole desk.
  if (config.deskPassword) {
    const expected = "Basic " + Buffer.from(`desk:${config.deskPassword}`).toString("base64");
    app.use((req, res, next) => {
      if ((req.headers.authorization ?? "") === expected) return next();
      res.set("WWW-Authenticate", 'Basic realm="Message Desk"').status(401).send("Authentication required.");
    });
  }

  const requireJob = async (req, res) => {
    const job = await loadJob(config.dataDir, String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "Job not found." });
      return null;
    }
    return job;
  };

  // --- Health + config -----------------------------------------------------
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      ffmpeg: ffmpegInfo.ffmpeg,
      transcription: config.xaiApiKey ? "xai" : config.whisperPython ? "whisper" : "none",
      wpConfigured: Boolean(config.wpUrl && config.wpUser && config.wpAppPassword),
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      xaiEnabled: Boolean(config.xaiApiKey),
      xaiModel: config.xaiModel,
      whisperEnabled: Boolean(config.whisperPython),
      whisperModel: config.whisperModel,
      wpConfigured: Boolean(config.wpUrl && config.wpUser && config.wpAppPassword),
      timezone: config.timezone,
      today: defaultDate(),
    });
  });

  // --- Upload (streamed to disk) + detect + preview ------------------------
  app.post("/api/upload", wrap(async (req, res) => {
    const job = await createJob(config.dataDir);
    const paths = jobPaths(config.dataDir, job.id);
    setStep(job, "upload", "running");

    const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 3 * 1024 * 1024 * 1024 } });
    let filename = "upload";
    let bytes = 0;
    let fileSeen = false;

    const done = new Promise((resolveDone, rejectDone) => {
      bb.on("file", (_name, stream, info) => {
        fileSeen = true;
        filename = info.filename || "upload";
        const out = createWriteStream(paths.source);
        stream.on("data", (chunk) => (bytes += chunk.length));
        stream.on("limit", () => rejectDone(new Error("File exceeds the 3GB limit.")));
        stream.pipe(out);
        out.on("error", rejectDone);
        out.on("finish", resolveDone);
      });
      bb.on("error", rejectDone);
      bb.on("close", () => {
        if (!fileSeen) rejectDone(new Error("No file was uploaded (field name must be 'file')."));
      });
    });
    req.pipe(bb);
    await done;

    setStep(job, "upload", "done");
    await saveJob(config.dataDir, job);

    // Probe + analyse + preview.
    setStep(job, "detect", "running");
    await saveJob(config.dataDir, job);
    const info = await probeAudio(paths.source);
    job.source = {
      filename, size: bytes, duration: info.duration,
      sampleRate: info.sampleRate, channels: info.channels, codec: info.codec,
      creationTime: info.creationTime,
    };
    const analysis = await analyze(paths.source);
    const duration = info.duration > 0 ? info.duration : analysis.duration;
    const detection = detectSermon(analysis.features, duration);
    job.analysis = { duration: analysis.duration, peaks: analysis.peaks, peaksPerSec: analysis.peaksPerSec };
    job.detection = detection;
    job.selection = { in: detection.start, out: detection.end };
    setStep(job, "detect", "done");
    await saveJob(config.dataDir, job);

    await makePreview(paths.source, paths.preview);

    res.json({
      id: job.id,
      source: job.source,
      detection,
      selection: job.selection,
      analysis: job.analysis,
      serviceDate: defaultDate(job),
    });
  }));

  app.get("/api/job/:id", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (job) res.json(job);
  }));

  app.get("/api/job/:id/preview", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    res.type("audio/mpeg").sendFile(jobPaths(config.dataDir, job.id).preview);
  }));
  app.get("/api/job/:id/cleaned", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    res.type("audio/mpeg").sendFile(jobPaths(config.dataDir, job.id).cleaned);
  }));
  app.get("/api/job/:id/image.png", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    res.type("image/png").sendFile(jobPaths(config.dataDir, job.id).png);
  }));
  app.get("/api/job/:id/image.jpg", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    res.type("image/jpeg").sendFile(jobPaths(config.dataDir, job.id).jpg);
  }));
  app.get("/api/job/:id/banner.svg", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    if (!job.image?.bannerSvg) {
      res.status(404).json({ error: "No banner generated yet." });
      return;
    }
    res.type("image/svg+xml").send(job.image.bannerSvg);
  }));

  // --- Export (trim + clean + loudnorm) ------------------------------------
  app.post("/api/job/:id/export", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    const paths = jobPaths(config.dataDir, job.id);
    const inSec = Number(req.body?.in ?? job.selection?.in ?? 0);
    const outSec = Number(req.body?.out ?? job.selection?.out ?? job.source?.duration ?? 0);
    if (!(outSec > inSec)) {
      res.status(400).json({ error: "Out point must be after the in point." });
      return;
    }
    job.selection = { in: inSec, out: outSec };
    setStep(job, "export", "running");
    await saveJob(config.dataDir, job);
    const result = await cleanExport(paths.source, paths.cleaned, inSec, outSec);
    // Loudness spec check: fail loudly if out of range.
    const lufsOk = result.lufs != null && Math.abs(result.lufs - -16) <= 1;
    const tpOk = result.truePeak != null && result.truePeak <= -1.5;
    result.inSpec = Boolean(lufsOk && tpOk);
    result.filename = serviceFilename(job.seo?.date ?? defaultDate(job));
    job.exportResult = result;
    setStep(job, "export", "done",
      result.inSpec ? `-16 LUFS / TP ${result.truePeak} dBTP` : `OUT OF SPEC: ${result.lufs} LUFS / TP ${result.truePeak}`);
    await saveJob(config.dataDir, job);
    res.json({ export: job.exportResult, selection: job.selection });
  }));

  // --- Transcribe ----------------------------------------------------------
  app.post("/api/job/:id/transcribe", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    const paths = jobPaths(config.dataDir, job.id);
    setStep(job, "transcribe", "running");
    await saveJob(config.dataDir, job);
    const speaker = String(req.body?.speaker ?? job.seo?.speaker ?? "");
    const scripture = String(req.body?.scripture ?? job.seo?.scripture ?? "");
    const target = job.exportResult ? paths.cleaned : paths.source;
    const result = await transcribe(config, target, sermonKeyterms(speaker, scripture));
    const text = result.words.length ? wordsToTranscript(result.words) : textToParagraphs(result.text);
    result.text = text || result.text;
    job.transcript = result;
    setStep(job, "transcribe", result.engine === "none" ? "error" : "done", result.note);
    await saveJob(config.dataDir, job);
    res.json({ transcript: result });
  }));

  // --- SEO -----------------------------------------------------------------
  app.post("/api/job/:id/seo", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    const transcript = job.transcript?.text ?? "";
    const speaker = String(req.body?.speaker ?? job.seo?.speaker ?? "");
    const series = String(req.body?.series ?? job.seo?.series ?? "");
    const date = String(req.body?.date ?? job.seo?.date ?? defaultDate(job));
    setStep(job, "seo", "running");
    await saveJob(config.dataDir, job);

    const base = buildHeuristicSeo(transcript, { speaker, series, date });
    let fields = base;
    let engine = "heuristic";
    let engineNote = "No xAI key — used the deterministic heuristic.";
    if (config.xaiApiKey && transcript) {
      try {
        const draft = await xaiSeo(config.xaiApiKey, config.xaiModel, clipForSuggestion(transcript), { speaker, series, date });
        fields = {
          ...base,
          title: draft.title || base.title,
          metaDescription: draft.metaDescription || base.metaDescription,
          excerpt: draft.excerpt || base.excerpt,
          body: draft.body || base.body,
          scripture: draft.scripture || base.scripture,
          scriptureRefs: draft.scriptureRefs?.length ? draft.scriptureRefs : base.scriptureRefs,
          tags: draft.tags?.length ? draft.tags : base.tags,
          categories: draft.categories?.length ? draft.categories : [],
          focusKeyphrase: draft.focusKeyphrase || base.focusKeyphrase,
          speaker: speaker || draft.speaker || base.speaker,
          series: series || draft.series || base.series,
          imageAlt: draft.imageAlt || "",
          slug: slugify(draft.title || base.title),
        };
        engine = "xai";
        engineNote = "SEO by xAI chat completions.";
      } catch (e) {
        engineNote = `xAI SEO failed (${e.message}); used heuristics.`;
      }
    }
    job.seo = fields;
    setStep(job, "seo", "done", engineNote);
    await saveJob(config.dataDir, job);
    res.json({ seo: fields, engine, note: engineNote });
  }));

  // User edits: overwrite stored SEO fields.
  app.put("/api/job/:id/seo", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    const incoming = req.body ?? {};
    const current = job.seo ?? buildHeuristicSeo("", { speaker: "", series: "", date: defaultDate(job) });
    const merged = { ...current, ...incoming };
    if (incoming.title && !incoming.slug) merged.slug = slugify(incoming.title);
    job.seo = merged;
    await saveJob(config.dataDir, job);
    res.json({ seo: merged });
  }));

  // --- Featured image ------------------------------------------------------
  app.post("/api/job/:id/image", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    const paths = jobPaths(config.dataDir, job.id);
    const seo = job.seo;
    const fields = {
      title: String(req.body?.title ?? seo?.title ?? "Sunday Message"),
      speaker: String(req.body?.speaker ?? seo?.speaker ?? ""),
      date: String(req.body?.date ?? seo?.date ?? defaultDate(job)),
      scripture: String(req.body?.scripture ?? seo?.scripture ?? ""),
      series: String(req.body?.series ?? seo?.series ?? ""),
    };
    // Motif choice is fed by the request keywords plus the SEO focus/tags.
    const reqKeywords = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
    const keywords = [...reqKeywords, seo?.focusKeyphrase, ...(seo?.tags ?? [])]
      .map((k) => String(k ?? "").trim())
      .filter(Boolean);
    // An explicit, valid motif overrides the automatic choice.
    const requested = typeof req.body?.motif === "string" ? req.body.motif : "";
    const motif = MOTIFS.includes(requested)
      ? requested
      : chooseMotif({ scripture: fields.scripture, title: fields.title, keywords });

    setStep(job, "image", "running");
    await saveJob(config.dataDir, job);
    const result = await renderImages(fields, paths.png, paths.jpg, { motif });
    await writeFile(paths.svg, result.svg);
    const alt =
      seo?.imageAlt ||
      `${fields.title} — Citizens Church${fields.speaker ? `, ${fields.speaker}` : ""}${fields.date ? `, ${formatDate(fields.date)}` : ""}`;
    job.image = {
      alt,
      filename: `${slugify(fields.title)}-citizens-church.png`,
      motif: result.motif,
      passageKey: result.passageKey,
      bannerSvg: result.bannerSvg,
    };
    setStep(job, "image", "done");
    await saveJob(config.dataDir, job);
    res.json({
      image: job.image,
      pngUrl: `/api/job/${job.id}/image.png?t=${Date.now()}`,
      motif: result.motif,
      motifs: MOTIFS,
      bannerSvg: result.bannerSvg,
      passageKey: result.passageKey,
    });
  }));

  // --- WordPress probe -----------------------------------------------------
  app.get("/api/wp/probe", wrap(async (_req, res) => {
    res.json(await wpClient().probe());
  }));

  // --- Publish (draft default; publish requires confirm) -------------------
  app.post("/api/job/:id/publish", wrap(async (req, res) => {
    const job = await requireJob(req, res);
    if (!job) return;
    const paths = jobPaths(config.dataDir, job.id);
    // Publish guard: never publish without the explicit flags.
    const decision = resolvePublishStatus(req.body?.status, req.body?.publish, req.body?.confirm);
    if (!decision.ok) {
      res.status(400).json({ error: decision.error });
      return;
    }
    const status = decision.status;

    if (!job.seo) {
      res.status(400).json({ error: "Generate the SEO fields first." });
      return;
    }
    try {
      await stat(paths.cleaned);
    } catch {
      res.status(400).json({ error: "Export the cleaned audio first." });
      return;
    }

    setStep(job, "publish", "running");
    await saveJob(config.dataDir, job);

    const client = wpClient();
    const probeResult = await client.probe();
    const seo = job.seo;

    // Login + capability guards — fail early with a clear message.
    if (!probeResult.authOk) {
      setStep(job, "publish", "error", probeResult.authMessage);
      await saveJob(config.dataDir, job);
      res.status(403).json({ error: probeResult.authMessage || "WordPress login failed.", probe: probeResult });
      return;
    }
    if (!probeResult.user.canUpload) {
      const msg = `The WordPress user "${probeResult.user.name}" cannot upload files (needs upload_files).`;
      setStep(job, "publish", "error", msg);
      await saveJob(config.dataDir, job);
      res.status(403).json({ error: msg, probe: probeResult });
      return;
    }
    if (status === "publish" && !probeResult.user.canPublish) {
      const msg = `The WordPress user "${probeResult.user.name}" cannot publish posts (needs publish_posts). Save as a draft instead.`;
      setStep(job, "publish", "error", msg);
      await saveJob(config.dataDir, job);
      res.status(403).json({ error: msg, probe: probeResult });
      return;
    }

    // Upload cleaned MP3.
    const audioName = serviceFilename(seo.date);
    const media = await client.uploadMedia(paths.cleaned, audioName, "audio/mpeg");

    // Upload featured image (PNG; WP blocks SVG uploads).
    let imageId = 0;
    try {
      await stat(paths.png);
      const alt = job.image?.alt ?? `${seo.title} — Citizens Church`;
      const img = await client.uploadMedia(paths.png, job.image?.filename ?? `${seo.slug}-citizens-church.png`, "image/png", alt);
      imageId = img.id;
    } catch {
      /* no image generated — continue without a featured image */
    }

    // Sermon meta (matches the real site's sermon_* structure).
    const meta = {
      sermon_speaker: seo.speaker,
      sermon_scripture: seo.scripture,
      sermon_series: seo.series,
      sermon_audio_url: media.source_url,
      sermon_transcript: (job.transcript?.text ?? "").replace(/\n\n/g, "\r\n\r\n"),
    };
    // SEO plugin meta ONLY when that plugin is detected.
    let seoPlugin = "none";
    if (probeResult.seo.yoast) {
      seoPlugin = "yoast";
      meta._yoast_wpseo_metadesc = seo.metaDescription;
      meta._yoast_wpseo_focuskw = seo.focusKeyphrase;
      meta._yoast_wpseo_title = seo.title;
    } else if (probeResult.seo.rankmath) {
      seoPlugin = "rankmath";
      meta.rank_math_description = seo.metaDescription;
      meta.rank_math_focus_keyword = seo.focusKeyphrase;
      meta.rank_math_title = seo.title;
    }

    const embedAudio = shouldEmbedAudio(probeResult.postType);
    const content = buildContent(seo.body, {
      audioUrl: media.source_url,
      audioMediaId: media.id,
      embedAudio,
    });

    const payload = {
      title: seo.title,
      slug: seo.slug,
      status,
      date: `${seo.date}T10:00:00`,
      excerpt: seo.excerpt,
      content,
      meta,
    };
    if (imageId) payload.featured_media = imageId;

    // Only set categories/tags when the target type supports those taxonomies.
    if (probeResult.taxonomies.includes("post_tag") && seo.tags?.length) {
      const ids = [];
      for (const tag of seo.tags.slice(0, 8)) {
        const id = await client.ensureTerm("tags", tag);
        if (id) ids.push(id);
      }
      if (ids.length) payload.tags = ids;
    }
    if (probeResult.taxonomies.includes("category") && seo.categories?.length) {
      const ids = [];
      for (const cat of seo.categories.slice(0, 3)) {
        const id = await client.ensureTerm("categories", cat);
        if (id) ids.push(id);
      }
      if (ids.length) payload.categories = ids;
    }

    const created = await client.createPost(probeResult.restBase, payload);

    // Report which meta WordPress actually kept (REST silently drops unregistered meta).
    let keptMeta = [];
    let fetchedLink = created.link;
    let fetchedStatus = created.status;
    try {
      const check = await client.fetch(`/wp-json/wp/v2/${probeResult.restBase}/${created.id}?context=edit`);
      if (check.ok) {
        const body = await check.json();
        const got = body.meta ?? {};
        keptMeta = Object.keys(meta).filter((key) => {
          const value = got[key];
          return value !== undefined && String(value ?? "") === String(meta[key] ?? "");
        });
        fetchedLink = body.link ?? fetchedLink;
        fetchedStatus = body.status ?? fetchedStatus;
      }
    } catch {
      /* best effort */
    }

    job.publish = {
      postId: created.id,
      link: fetchedLink,
      editLink: client.editLink(created.id),
      status: fetchedStatus,
      mediaId: media.id,
      audioUrl: media.source_url,
      imageId,
      keptMeta,
      seoPlugin,
    };
    setStep(job, "publish", "done");
    await saveJob(config.dataDir, job);

    res.json({ publish: job.publish, postType: probeResult.postType, audioEmbedded: embedAudio });
  }));

  // --- Static UI -----------------------------------------------------------
  app.use(express.static(PUBLIC_DIR));
  app.get("*", (_req, res) => res.sendFile(resolve(PUBLIC_DIR, "index.html")));

  // Error handler.
  app.use((err, _req, res, _next) => {
    console.error("[message-desk]", err.message);
    if (res.headersSent) return;
    res.status(500).json({ error: err.message });
  });

  return app;
}

async function main() {
  loadDotEnv();
  const config = loadConfig();

  let ffmpegInfo;
  try {
    ffmpegInfo = await checkFfmpeg();
    console.log(`[message-desk] ${ffmpegInfo.ffmpeg}`);
  } catch (err) {
    console.error(`[message-desk] FATAL: ${err.message}`);
    process.exit(1);
  }

  const removed = await cleanupOldJobs(config.dataDir).catch(() => 0);
  if (removed) console.log(`[message-desk] cleaned up ${removed} old job(s)`);

  const app = buildApp(config, ffmpegInfo);
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`[message-desk] listening on http://0.0.0.0:${config.port}`);
    console.log(`[message-desk] data dir: ${config.dataDir}`);
    if (config.deskPassword) console.log("[message-desk] UI protected by DESK_PASSWORD");
  });
}

// Only auto-start when run directly (not when imported by the e2e harness).
const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
