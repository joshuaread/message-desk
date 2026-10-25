// Featured image (1920x1080) for a sermon: wordless, flat SVG banner art in the
// Citizens Church site style (warm hills / arches, no text). The motif is chosen
// from scripture/title/keywords, rasterized with @resvg/resvg-js, and a JPG is
// produced via ffmpeg. The companion 1120x240 banner SVG is returned alongside.
import { Resvg } from "@resvg/resvg-js";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildFeaturedSvg, buildBannerSvg, chooseMotif, passageKey } from "./banner.js";

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(here, "../assets/fonts");
const FONT_FILES = [
  resolve(FONT_DIR, "Poppins-Regular.ttf"),
  resolve(FONT_DIR, "Poppins-Medium.ttf"),
  resolve(FONT_DIR, "Poppins-SemiBold.ttf"),
  resolve(FONT_DIR, "Poppins-Bold.ttf"),
];

const W = 1920;
const H = 1080;

export function escapeXml(input) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word wrap to a max characters-per-line budget, hard-breaking long words. */
export function wrapText(text, maxChars) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    let w = word;
    while (w.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const year = Number(m[1]);
  const month = months[Number(m[2]) - 1] ?? "";
  const day = Number(m[3]);
  return `${month} ${day}, ${year}`;
}

/** @typedef {{title:string, speaker:string, date:string, scripture:string, series:string, keywords?:string[]}} ImageFields */

/**
 * Build the wordless featured SVG (1920x1080). The motif is passed in, or chosen
 * automatically from the fields when omitted.
 */
export function buildSvg(fields, motif) {
  const m = motif || chooseMotif({
    scripture: fields.scripture,
    title: fields.title,
    keywords: fields.keywords,
  });
  return buildFeaturedSvg(m);
}

export function renderPng(svg) {
  const resvg = new Resvg(svg, {
    background: "#f1e6cf",
    fitTo: { mode: "width", value: W },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: "Poppins",
    },
  });
  return Buffer.from(resvg.render().asPng());
}

function pngToJpg(pngPath, jpgPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", pngPath, "-q:v", "3", jpgPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`jpg convert failed: ${err.slice(0, 200)}`)),
    );
  });
}

/**
 * Render the featured image to PNG + JPG on disk. Picks the motif via
 * chooseMotif (scripture/title/keywords) unless one is passed in opts.motif.
 * Returns the featured svg, the companion 1120x240 bannerSvg, the motif used,
 * and the normalized passageKey.
 */
export async function renderImages(fields, pngPath, jpgPath, opts = {}) {
  const motif = opts.motif || chooseMotif({
    scripture: fields.scripture,
    title: fields.title,
    keywords: fields.keywords,
  });
  const svg = buildFeaturedSvg(motif);
  const png = renderPng(svg);
  await writeFile(pngPath, png);
  await pngToJpg(pngPath, jpgPath);
  return { svg, bannerSvg: buildBannerSvg(motif), motif, passageKey: passageKey(fields.scripture || "") };
}
