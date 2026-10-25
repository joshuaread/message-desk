// Branded 1920x1080 featured image. Built as an SVG (Citizens Church look —
// warm dark charcoal background, warm gold/tan accent, off-white Poppins type)
// and rasterized with @resvg/resvg-js using the bundled OFL fonts so it renders
// the same on a fresh server with no system fonts. JPG is produced via ffmpeg.
import { Resvg } from "@resvg/resvg-js";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

/** @typedef {{title:string, speaker:string, date:string, scripture:string, series:string}} ImageFields */

export function buildSvg(fields) {
  const title = (fields.title || "Sunday Message").trim();
  let titleSize = 118;
  if (title.length > 26) titleSize = 96;
  if (title.length > 44) titleSize = 78;
  if (title.length > 70) titleSize = 64;
  const maxChars = Math.max(10, Math.floor((W - 320) / (titleSize * 0.55)));
  const lines = wrapText(title, maxChars).slice(0, 4);
  const lineHeight = titleSize * 1.12;

  const metaBits = [fields.speaker, formatDate(fields.date), fields.scripture]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  const meta = metaBits.join("   ·   ");
  const series = (fields.series ?? "").trim();

  const blockHeight = lines.length * lineHeight;
  const titleTop = H / 2 - blockHeight / 2 + titleSize * 0.8;

  const titleTspans = lines
    .map((line, i) => `<tspan x="160" y="${Math.round(titleTop + i * lineHeight)}">${escapeXml(line)}</tspan>`)
    .join("");

  const metaY = Math.round(titleTop + (lines.length - 1) * lineHeight + 120);
  const seriesSvg = series
    ? `<text x="160" y="${metaY + 64}" font-family="Poppins" font-weight="400" font-size="34" fill="#b8ad9e" letter-spacing="1">Series: ${escapeXml(series)}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#211d1a"/>
      <stop offset="0.6" stop-color="#1a1613"/>
      <stop offset="1" stop-color="#0f0c0a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.18" r="0.6">
      <stop offset="0" stop-color="#c9a36a" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#c9a36a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g fill="none" stroke="#c9a36a" stroke-opacity="0.16">
    <circle cx="1720" cy="150" r="120" stroke-width="2"/>
    <circle cx="1720" cy="150" r="200" stroke-width="2"/>
    <circle cx="1720" cy="150" r="300" stroke-width="2"/>
  </g>
  <rect x="160" y="${Math.round(titleTop - titleSize - 70)}" width="96" height="6" fill="#c9a36a"/>
  <text x="160" y="${Math.round(titleTop - titleSize - 14)}" font-family="Poppins" font-weight="600" font-size="34" fill="#c9a36a" letter-spacing="8">CITIZENS CHURCH</text>
  <text font-family="Poppins" font-weight="700" font-size="${titleSize}" fill="#f4efe8">${titleTspans}</text>
  ${meta ? `<text x="160" y="${metaY}" font-family="Poppins" font-weight="500" font-size="40" fill="#d8cdbd" letter-spacing="1">${escapeXml(meta)}</text>` : ""}
  ${seriesSvg}
</svg>`;
}

export function renderPng(svg) {
  const resvg = new Resvg(svg, {
    background: "#15110e",
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

/** Render the SVG to both PNG and JPG on disk. */
export async function renderImages(fields, pngPath, jpgPath) {
  const svg = buildSvg(fields);
  const png = renderPng(svg);
  await writeFile(pngPath, png);
  await pngToJpg(pngPath, jpgPath);
  return { svg };
}
