// Message Desk single-page UI. Talks only to this server's /api — no secrets
// ever live in the browser.
"use strict";

const state = {
  jobId: null,
  duration: 0,
  peaks: [],
  peaksPerSec: 8,
  sel: { in: 0, out: 0 },
  previewStop: null,
  image: { motif: null, motifs: [] },
};

const $ = (id) => document.getElementById(id);

function setStatus(el, msg, cls) {
  el.textContent = msg || "";
  el.className = "status" + (cls ? " " + cls : "");
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = typeof body === "object" && body && body.error ? body.error : String(body).slice(0, 300);
    throw new Error(err);
  }
  return body;
}

function show(id) {
  $(id).classList.remove("hidden");
}

function fmt(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// --- config ---------------------------------------------------------------
async function loadConfig() {
  try {
    const cfg = await api("/api/config");
    const bits = [];
    bits.push(cfg.xaiEnabled ? `xAI (${cfg.xaiModel})` : cfg.whisperEnabled ? "local whisper" : "no transcription");
    bits.push(cfg.wpConfigured ? "WordPress ready" : "WordPress not configured");
    $("env").textContent = bits.join(" · ");
    return cfg;
  } catch {
    $("env").textContent = "";
    return {};
  }
}

// --- waveform -------------------------------------------------------------
function drawWave() {
  const canvas = $("wave");
  const wrap = $("wave-wrap");
  const width = wrap.clientWidth;
  const height = 150;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const peaks = state.peaks;
  const slots = peaks.length / 2;
  if (!slots) return;
  const mid = height / 2;
  ctx.fillStyle = "#6f655a";
  for (let x = 0; x < width; x += 1) {
    const slot = Math.min(slots - 1, Math.floor((x / width) * slots));
    const min = peaks[slot * 2] ?? 0;
    const max = peaks[slot * 2 + 1] ?? 0;
    const y1 = mid - max * mid * 0.95;
    const y2 = mid - min * mid * 0.95;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  positionHandles();
}

function timeToX(t) {
  const width = $("wave-wrap").clientWidth;
  return state.duration > 0 ? (t / state.duration) * width : 0;
}
function xToTime(x) {
  const width = $("wave-wrap").clientWidth;
  return state.duration > 0 ? (x / width) * state.duration : 0;
}

function positionHandles() {
  const inX = timeToX(state.sel.in);
  const outX = timeToX(state.sel.out);
  $("handle-in").style.left = inX + "px";
  $("handle-out").style.left = outX + "px";
  const region = $("region");
  region.style.left = inX + "px";
  region.style.width = Math.max(0, outX - inX) + "px";
}

function clampSel() {
  state.sel.in = Math.max(0, Math.min(state.sel.in, state.duration - 0.5));
  state.sel.out = Math.min(state.duration, Math.max(state.sel.out, state.sel.in + 0.5));
}

function syncInputs() {
  $("in-time").value = state.sel.in.toFixed(1);
  $("out-time").value = state.sel.out.toFixed(1);
}

function updateSelection() {
  clampSel();
  positionHandles();
  syncInputs();
}

function initHandleDrag(handleId, edge) {
  const handle = $(handleId);
  let dragging = false;
  const move = (clientX) => {
    const rect = $("wave-wrap").getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    state.sel[edge] = xToTime(x);
    updateSelection();
  };
  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (dragging) move(e.clientX);
  });
  handle.addEventListener("pointerup", (e) => {
    dragging = false;
    try {
      handle.releasePointerCapture(e.pointerId);
    } catch {}
  });
}

// --- preview playback -----------------------------------------------------
function stopPreview() {
  const audio = $("preview");
  audio.pause();
  if (state.previewStop) {
    clearTimeout(state.previewStop);
    state.previewStop = null;
  }
}
function playFrom(start, stopAt) {
  if (!state.jobId) return;
  const audio = $("preview");
  stopPreview();
  const url = `/api/job/${state.jobId}/preview`;
  if (!audio.src.endsWith(url)) {
    audio.src = url;
    audio.load();
  }
  const ms = Math.max(500, (stopAt - start) * 1000);
  const armStop = () => {
    if (state.previewStop) clearTimeout(state.previewStop);
    state.previewStop = setTimeout(stopPreview, ms);
  };
  const seek = () => {
    audio.currentTime = start;
    armStop();
  };
  // play() must run directly inside the click (Safari/iOS block it otherwise).
  const p = audio.play();
  if (audio.readyState >= 1) seek();
  else audio.addEventListener("loadedmetadata", seek, { once: true });
  if (p && p.catch) {
    p.catch((err) => {
      console.error("preview play failed", err);
      alert("Preview couldn't play: " + (err && err.message ? err.message : err));
    });
  }
}

// --- pipeline steps -------------------------------------------------------
async function doUpload() {
  const file = $("file").files[0];
  if (!file) {
    setStatus($("upload-status"), "Choose a recording first.", "err");
    return;
  }
  setStatus($("upload-status"), "Uploading and analysing", "busy");
  $("upload-btn").disabled = true;
  try {
    const form = new FormData();
    form.append("file", file);
    const up = await api("/api/upload", { method: "POST", body: form });
    state.jobId = up.id;
    state.duration = up.analysis.duration || up.source.duration;
    state.peaks = up.analysis.peaks;
    state.peaksPerSec = up.analysis.peaksPerSec;
    state.sel = { in: up.selection.in, out: up.selection.out };
    setStatus(
      $("upload-status"),
      `${up.source.filename} · ${fmt(up.source.duration)} · ${up.source.codec} ${up.source.sampleRate || ""}Hz`,
      "ok",
    );
    show("card-detect");
    show("card-export");
    show("card-transcribe");
    show("card-seo");
    show("card-image");
    show("card-wp");
    $("detect-reason").textContent = up.detection.reason;
    $("seo-date").value = up.serviceDate;
    drawWave();
    updateSelection();
    $("runall-btn").disabled = false;
  } catch (e) {
    setStatus($("upload-status"), e.message, "err");
  } finally {
    $("upload-btn").disabled = false;
  }
}

async function doExport() {
  if (!state.jobId) return;
  setStatus($("export-status"), "Cleaning and normalising", "busy");
  const ex = await api(`/api/job/${state.jobId}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ in: state.sel.in, out: state.sel.out }),
  });
  const e = ex.export;
  const spec = e.inSpec ? "within spec" : "OUT OF SPEC";
  setStatus(
    $("export-status"),
    `${fmt(e.duration)} · ${e.lufs} LUFS · TP ${e.truePeak} dBTP · ${spec}`,
    e.inSpec ? "ok" : "err",
  );
  const audio = $("cleaned");
  audio.src = `/api/job/${state.jobId}/cleaned?t=${Date.now()}`;
  audio.classList.remove("hidden");
  const dl = $("cleaned-dl");
  dl.href = audio.src;
  dl.classList.remove("hidden");
  return ex;
}

async function doTranscribe() {
  if (!state.jobId) return;
  setStatus($("transcribe-status"), "Transcribing (this can take a minute)", "busy");
  const tr = await api(`/api/job/${state.jobId}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speaker: $("seo-speaker").value, scripture: $("seo-scripture").value }),
  });
  $("engine").textContent = tr.transcript.engine;
  $("transcript").value = tr.transcript.text;
  setStatus($("transcribe-status"), tr.transcript.note || "Done.", tr.transcript.engine === "none" ? "err" : "ok");
  return tr;
}

function fillSeo(seo) {
  $("seo-title").value = seo.title || "";
  $("seo-slug").value = seo.slug || "";
  $("seo-speaker").value = seo.speaker || "";
  if (seo.date) $("seo-date").value = seo.date;
  $("seo-scripture").value = seo.scripture || "";
  $("seo-series").value = seo.series || "";
  $("seo-focus").value = seo.focusKeyphrase || "";
  $("seo-tags").value = (seo.tags || []).join(", ");
  $("seo-meta").value = seo.metaDescription || "";
  $("seo-excerpt").value = seo.excerpt || "";
  $("seo-body").value = seo.body || "";
}

function readSeo() {
  return {
    title: $("seo-title").value,
    slug: $("seo-slug").value,
    speaker: $("seo-speaker").value,
    date: $("seo-date").value,
    scripture: $("seo-scripture").value,
    series: $("seo-series").value,
    focusKeyphrase: $("seo-focus").value,
    tags: $("seo-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
    metaDescription: $("seo-meta").value,
    excerpt: $("seo-excerpt").value,
    body: $("seo-body").value,
  };
}

async function doSeo() {
  if (!state.jobId) return;
  setStatus($("seo-status"), "Writing title and SEO", "busy");
  const seo = await api(`/api/job/${state.jobId}/seo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      speaker: $("seo-speaker").value,
      series: $("seo-series").value,
      date: $("seo-date").value,
    }),
  });
  fillSeo(seo.seo);
  $("seo-engine").textContent = seo.engine;
  setStatus($("seo-status"), seo.note || "Done.", "ok");
  return seo;
}

async function saveSeo() {
  if (!state.jobId) return;
  const seo = await api(`/api/job/${state.jobId}/seo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(readSeo()),
  });
  fillSeo(seo.seo);
  setStatus($("seo-status"), "Edits saved.", "ok");
}

async function doImage(motif) {
  if (!state.jobId) return;
  // Persist current edits first so the image uses them.
  await saveSeo().catch(() => {});
  setStatus($("image-status"), "Rendering featured image", "busy");
  const body = readSeo();
  if (motif) body.motif = motif;
  const img = await api(`/api/job/${state.jobId}/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  state.image = { motif: img.motif, motifs: img.motifs || [] };
  // Banner preview (1120x240 SVG) inline, featured PNG beside it.
  const banner = $("banner-preview");
  banner.src = "data:image/svg+xml;utf8," + encodeURIComponent(img.bannerSvg);
  banner.classList.remove("hidden");
  const el = $("image-preview");
  el.src = img.pngUrl;
  el.classList.remove("hidden");
  $("image-motif").textContent = `motif: ${img.motif}`;
  $("image-next").classList.remove("hidden");
  setStatus($("image-status"), img.image.alt, "ok");
  return img;
}

// Cycle to the next motif in the list returned by the server.
function tryAnotherMotif() {
  const motifs = state.image.motifs;
  if (!motifs.length) return doImage();
  const i = motifs.indexOf(state.image.motif);
  return doImage(motifs[(i + 1) % motifs.length]);
}

async function doProbe() {
  setStatus($("probe-info"), "Checking the site", "busy");
  try {
    const p = await api("/api/wp/probe");
    const caps = [];
    if (p.user.canUpload) caps.push("upload");
    if (p.user.canEdit) caps.push("edit");
    if (p.user.canPublish) caps.push("publish");
    const seoName = p.seo.yoast ? "Yoast" : p.seo.rankmath ? "RankMath" : "no SEO plugin";
    const line = p.authOk
      ? `${p.site} — signed in as ${p.user.name} [${caps.join(", ") || "no caps"}] · post type "${p.postType}" · ${seoName}`
      : `${p.site} — ${p.authMessage}`;
    setStatus($("probe-info"), line, p.authOk ? "ok" : "err");
  } catch (e) {
    setStatus($("probe-info"), e.message, "err");
  }
}

async function doPublish(live) {
  if (!state.jobId) return;
  if (live && !confirm("Publish this sermon LIVE on the website now?")) return;
  await saveSeo().catch(() => {});
  setStatus($("publish-status"), live ? "Publishing live" : "Saving draft", "busy");
  try {
    const body = live
      ? { status: "publish", publish: true, confirm: "publish" }
      : { status: "draft" };
    const pub = await api(`/api/job/${state.jobId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const p = pub.publish;
    setStatus($("publish-status"), `${p.status} · post ${p.postId} · meta kept: ${p.keptMeta.join(", ") || "none"}`, "ok");
    $("publish-result").innerHTML =
      `<a href="${p.link}" target="_blank" rel="noopener">View post</a> · ` +
      `<a href="${p.editLink}" target="_blank" rel="noopener">Edit in WordPress</a>`;
  } catch (e) {
    setStatus($("publish-status"), e.message, "err");
  }
}

async function runAll() {
  $("runall-btn").disabled = true;
  try {
    await doExport();
    await doTranscribe();
    await doSeo();
    await doImage();
  } catch (e) {
    setStatus($("upload-status"), "Run all stopped: " + e.message, "err");
  } finally {
    $("runall-btn").disabled = false;
  }
}

// --- wire up --------------------------------------------------------------
function wire() {
  $("upload-btn").addEventListener("click", doUpload);
  $("runall-btn").addEventListener("click", runAll);

  initHandleDrag("handle-in", "in");
  initHandleDrag("handle-out", "out");

  document.querySelectorAll(".step").forEach((btn) => {
    btn.addEventListener("click", () => {
      const edge = btn.dataset.edge;
      state.sel[edge] += Number(btn.dataset.delta);
      updateSelection();
    });
  });
  $("in-time").addEventListener("change", () => {
    const v = parseFloat($("in-time").value);
    if (!Number.isNaN(v)) {
      state.sel.in = v;
      updateSelection();
    }
  });
  $("out-time").addEventListener("change", () => {
    const v = parseFloat($("out-time").value);
    if (!Number.isNaN(v)) {
      state.sel.out = v;
      updateSelection();
    }
  });

  $("play-in").addEventListener("click", () => playFrom(state.sel.in, Math.min(state.sel.out, state.sel.in + 6)));
  $("play-out").addEventListener("click", () => playFrom(Math.max(state.sel.in, state.sel.out - 6), state.sel.out));
  $("stop-region").addEventListener("click", stopPreview);

  $("export-btn").addEventListener("click", () => doExport().catch((e) => setStatus($("export-status"), e.message, "err")));
  $("transcribe-btn").addEventListener("click", () => doTranscribe().catch((e) => setStatus($("transcribe-status"), e.message, "err")));
  $("seo-btn").addEventListener("click", () => doSeo().catch((e) => setStatus($("seo-status"), e.message, "err")));
  $("seo-save").addEventListener("click", () => saveSeo().catch((e) => setStatus($("seo-status"), e.message, "err")));
  $("image-btn").addEventListener("click", () => doImage().catch((e) => setStatus($("image-status"), e.message, "err")));
  $("image-next").addEventListener("click", () => tryAnotherMotif().catch((e) => setStatus($("image-status"), e.message, "err")));
  $("probe-btn").addEventListener("click", doProbe);
  $("publish-btn").addEventListener("click", () => doPublish(false));
  $("publish-live-btn").addEventListener("click", () => doPublish(true));

  window.addEventListener("resize", () => {
    if (state.peaks.length) drawWave();
  });
}

loadConfig();
wire();

// Test hook: lets the e2e read the current job id / selection from the page.
window.MESSAGE_DESK = state;
