// Wordless, flat SVG banner art in the Citizens Church sermon-banner style.
// A small motif library composited onto a warm hills scene (viewBox 0 0 1120
// 240). Palette only — sky/bg: #f1e6cf #ead9b8 #dcbf94 #ecdcbf; sun/highlights:
// #f4f3ee; accents: #c9a76d #8a6a2f; ink: #1a1a17. No gradients beyond the sky,
// no text, no outline-on-everything clip-art. renderable by @resvg/resvg-js.

// The exact site hills (three layers) and sun, reused by banner + featured.
const SKY_GRAD = `<linearGradient id="csb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e6cf"/><stop offset="1" stop-color="#dcbf94"/></linearGradient>`;
const HILLS_BACK =
  `<path d="M0 120C140 92 260 150 400 122S660 90 800 120s230 24 320 6V240H0Z" fill="#c9a76d" fill-opacity=".7"/>` +
  `<path d="M0 160C160 132 290 190 440 160S700 130 860 160s180 18 260 6V240H0Z" fill="#8a6a2f" fill-opacity=".9"/>`;
const WATER = `<path d="M0 204C170 184 300 222 460 204S720 184 880 204s160 12 240 4V240H0Z" fill="#1a1a17"/>`;

const sun = (cx = 900, cy = 86, r = 52, op = 0.8) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f4f3ee" fill-opacity="${String(op).replace(/^0\./, ".")}"/>`;

// The reusable cloud shape (the exact site boat-variant cloud path).
const CLOUD = "M0 40C-4 18 22 10 36 24C46 2 88 2 96 28C126 22 152 44 136 62H8C-4 62 -6 50 0 40Z";

export const FISH_WHALE =
  `<g transform="translate(470 204) scale(1.2)">` +
  `<path d="M-92 10C-92 -12 -64 -30 -22 -30C18 -30 46 -20 66 -8C74 -14 80 -24 82 -36C90 -32 98 -32 108 -38C104 -26 94 -14 80 -2C60 16 6 24 -40 22C-72 20 -92 18 -92 10Z" fill="#1a1a17"/>` +
  `<circle cx="-68" cy="-6" r="2.6" fill="#f4f3ee"/>` +
  `<path d="M-58 -31V-44M-58 -44C-61 -53 -70 -56 -76 -51M-58 -44C-55 -53 -46 -56 -40 -51" fill="none" stroke="#f4f3ee" stroke-width="2.4" stroke-linecap="round" stroke-opacity=".9"/></g>`;

// --- motifs: each returns SVG fragments drawn over the hills scene ----------
const FRAGMENTS = {
  hills: () => "",

  // The exact site cloud + sailboat.
  boat: () =>
    `<path transform="translate(790 44) scale(0.9)" d="${CLOUD}" fill="#c9a76d" fill-opacity=".55"/>` +
    `<g transform="translate(400 116) rotate(-11) scale(1.3)">` +
    `<path d="M-30 0C-18 16 18 16 30 0Z" fill="#1a1a17"/>` +
    `<rect x="-1.5" y="-48" width="3" height="48" fill="#1a1a17"/>` +
    `<path d="M3 -46C24 -36 28 -14 29 -4H3Z" fill="#f4f3ee"/></g>`,

  // Great fish / whale: the exact shape live on citizenschur.ch under template
  // key 'jonah1:17' (featured media 2414). A faint cloud sits in the sky (drawn
  // before the hills), and the whale is drawn BEFORE the dark water band so it
  // breaches out of it: dark body, raised fluke, light eye and spout.
  fish: () => ({
    sky: `<path transform="translate(150 30) scale(0.75)" d="${CLOUD}" fill="#c9a76d" fill-opacity=".45"/>`,
    under: FISH_WHALE,
  }),

  // Storm: stacked clouds with a few slanted rain strokes.
  storm: () =>
    `<path transform="translate(430 28) scale(1.7)" d="${CLOUD}" fill="#c9a76d" fill-opacity=".55"/>` +
    `<path transform="translate(470 40) scale(1.5)" d="${CLOUD}" fill="#8a6a2f" fill-opacity=".85"/>` +
    `<g stroke="#1a1a17" stroke-width="3" stroke-linecap="round" stroke-opacity=".45">` +
    `<path d="M560 140 L550 162"/><path d="M596 140 L586 162"/>` +
    `<path d="M632 140 L622 162"/><path d="M668 140 L658 162"/></g>`,

  // Nineveh: flat-roofed blocks with a central stepped ziggurat on the horizon.
  skyline: () =>
    `<g fill="#1a1a17">` +
    `<rect x="356" y="152" width="30" height="40"/><rect x="390" y="138" width="40" height="54"/>` +
    `<rect x="434" y="158" width="26" height="34"/>` +
    `<rect x="470" y="150" width="92" height="42"/><rect x="482" y="138" width="68" height="14"/>` +
    `<rect x="494" y="126" width="44" height="14"/><rect x="508" y="116" width="16" height="12"/>` +
    `<rect x="566" y="146" width="34" height="46"/><rect x="604" y="160" width="28" height="32"/>` +
    `<rect x="636" y="140" width="44" height="52"/><rect x="684" y="156" width="30" height="36"/></g>`,

  // Jonah's vine: a dark climbing stem with leaves and a gourd growing off the hill.
  vine: () =>
    `<path d="M556 206C536 182 580 166 558 140C540 120 574 104 560 82" fill="none" stroke="#1a1a17" stroke-width="5" stroke-linecap="round"/>` +
    `<g fill="#1a1a17">` +
    `<path d="M556 176C540 168 528 176 524 188C540 190 552 184 556 176Z"/>` +
    `<path d="M560 150C576 142 590 150 594 162C578 164 566 158 560 150Z"/>` +
    `<path d="M558 120C542 112 530 120 526 132C542 134 554 128 558 120Z"/>` +
    `<path d="M560 98C576 90 590 98 594 110C578 112 566 106 560 98Z"/></g>` +
    `<circle cx="560" cy="80" r="9" fill="#8a6a2f"/>`,

  // Simple dark cross standing on the hill.
  cross: () =>
    `<g fill="#1a1a17"><rect x="552" y="92" width="16" height="114"/><rect x="528" y="118" width="64" height="15"/></g>`,

  // Open book silhouette with a light spine.
  book: () =>
    `<path d="M486 150C518 136 548 136 560 146C572 136 602 136 634 150L634 182C602 168 572 168 560 178C548 168 518 168 486 182Z" fill="#1a1a17"/>` +
    `<path d="M560 146L560 178" stroke="#f4f3ee" stroke-width="2.5"/>`,

  // A dove gliding in the sky.
  dove: () =>
    `<g transform="translate(500 60)" fill="#f4f3ee">` +
    `<path d="M0 26C26 14 60 12 96 24C78 26 64 32 58 46C50 32 34 28 0 26Z"/>` +
    `<path d="M58 24C68 6 92 -4 114 -2C100 8 96 20 98 32C86 24 72 22 58 24Z"/>` +
    `<circle cx="110" cy="-2" r="4"/></g>`,

  // A larger peak layer with a snow cap plus a nearer dark peak.
  mountain: () =>
    `<path d="M300 206L540 70L706 206Z" fill="#8a6a2f" fill-opacity=".9"/>` +
    `<path d="M540 70L566 118L532 110L516 130L498 112Z" fill="#f4f3ee" fill-opacity=".8"/>` +
    `<path d="M560 206L742 104L910 206Z" fill="#1a1a17"/>`,

  // arches uses the arch base rather than the hills scene (handled below).
  arches: () => "",
};

/** Ordered list of motif names (used by the UI "Try another" cycle). */
export const MOTIFS = [
  "hills", "boat", "fish", "storm", "skyline", "vine",
  "cross", "book", "dove", "mountain", "arches",
];

/** Next motif in the cycle; wraps around. Unknown input starts at the front. */
export function nextMotif(current) {
  const i = MOTIFS.indexOf(current);
  return MOTIFS[(i + 1) % MOTIFS.length];
}

/**
 * Normalize a scripture reference to a compact lookup key: lowercase, all
 * whitespace stripped, en/em dashes folded to a hyphen.
 * "Jonah 1:17" -> "jonah1:17"   "Jonah 1:7–16" -> "jonah1:7-16"
 */
export function passageKey(scripture) {
  return String(scripture || "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Pick a motif from scripture + title + keywords via a small keyword map.
 * Rules run in priority order (see README / task spec).
 */
export function chooseMotif({ scripture = "", title = "", keywords = [] } = {}) {
  const key = passageKey(scripture);
  const kw = Array.isArray(keywords) ? keywords.join(" ") : String(keywords || "");
  const hay = `${title} ${kw}`.toLowerCase();
  const has = (...terms) => terms.some((t) => new RegExp(`\\b${t}(?:s|es|ed|ing)?\\b`).test(hay));
  const isJonah = key.startsWith("jonah") || /\bjonah\b/.test(hay);

  // Chapter / start-verse, only parsed for Jonah passages.
  const m = /jonah(\d+)(?::(\d+))?/.exec(key);
  const chapter = m ? Number(m[1]) : null;
  const startVerse = m && m[2] ? Number(m[2]) : null;
  const inRange = (lo, hi) => startVerse != null && startVerse >= lo && startVerse <= hi;

  // 1. Great fish — Jonah 1:17 wins over the generic Jonah 1 boat range.
  if (key.includes("jonah1:17") || has("fish", "whale", "swallow", "belly")) return "fish";
  // 2. Jonah 2 — inside the fish.
  if (chapter === 2) return "fish";
  // 3. The storm at sea — Jonah 1:4-16, or boat/ship/sail words anywhere.
  if ((chapter === 1 && inRange(4, 16)) || has("boat", "ship", "sail")) return "boat";
  if (has("storm", "sea", "wind", "waves", "tempest")) return isJonah ? "boat" : "storm";
  // 4. Nineveh / the city.
  if (has("nineveh", "city")) return "skyline";
  // 5. The vine / gourd — Jonah 4:6-10 or plant words.
  if ((chapter === 4 && inRange(6, 10)) || has("vine", "plant", "gourd", "shade")) return "vine";
  // 6-9. Thematic words.
  if (has("cross", "crucif\\w*", "resurrection")) return "cross";
  if (has("word", "scripture", "book")) return "book";
  if (has("spirit", "dove", "peace")) return "dove";
  if (has("mountain", "sinai", "mount")) return "mountain";
  // 10. Any other Jonah passage — the plain hills.
  if (isJonah) return "hills";
  // 11. Fallback for everything else.
  return "arches";
}

// The exact site arch pattern, reused at both sizes. patternTransform lets the
// featured band anchor one clean arcade row flush to the bottom.
const ARCH_PATTERN = (id, transform = "") =>
  `<pattern id="${id}" width="140" height="240" patternUnits="userSpaceOnUse"${transform ? ` patternTransform="${transform}"` : ""}>` +
  `<path d="M25 240V150a45 45 0 0 1 90 0v90" fill="none" stroke="#1a1a17" stroke-width="1.6" stroke-opacity=".8"/>` +
  `<path d="M47 240V152a23 23 0 0 1 46 0v88" fill="none" stroke="#1a1a17" stroke-width="1.6" stroke-opacity=".8"/></pattern>`;

// A fragment is a string (drawn over the whole scene) or {sky, under, over}:
// sky = before the hills, under = between the brown hills and the dark water.
function layers(motif) {
  const f = (FRAGMENTS[motif] || FRAGMENTS.hills)();
  return typeof f === "string" ? { sky: "", under: "", over: f } : { sky: "", under: "", over: "", ...f };
}
function scene(motif) {
  const l = layers(motif);
  return `${sun(900, 86, 52, motif === "storm" ? 0.5 : 0.8)}${l.sky}${HILLS_BACK}${l.under}${WATER}${l.over}`;
}

/** Wordless 1120x240 banner SVG for the given motif. */
export function buildBannerSvg(motif) {
  if (motif === "arches") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="240" viewBox="0 0 1120 240">` +
      `<defs>${ARCH_PATTERN("csarch")}</defs>` +
      `<rect width="1120" height="240" fill="#ecdcbf"/>` +
      `<rect width="1120" height="240" fill="url(#csarch)"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="240" viewBox="0 0 1120 240">` +
    `<defs>${SKY_GRAD}</defs>` +
    `<rect width="1120" height="240" fill="url(#csb)"/>` +
    `${scene(motif)}</svg>`;
}

/**
 * Wordless 1920x1080 featured SVG: the same scene, scaled to fill the width and
 * dropped to the bottom, with a taller warm gradient sky above and the sun moved
 * up into the top-right of the full canvas. No text.
 */
export function buildFeaturedSvg(motif) {
  if (motif === "arches") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">` +
      `<defs>${ARCH_PATTERN("csarchf")}</defs>` +
      `<rect width="1920" height="1080" fill="#ecdcbf"/>` +
      // The banner arcade at the same 2.2x scale as the hills featured image,
      // pinned to the bottom so the arches stand tall instead of a thin strip.
      `<g transform="translate(-14 552) scale(2.2)"><rect width="900" height="240" fill="url(#csarchf)"/></g></svg>`;
  }
  // Same layout as the live Jonah 1:17 featured image: the whole banner scene
  // (sun included) scaled 2.2x, cropped to x 120..993 and pinned to the bottom,
  // with the warm gradient sky extended above. Every motif sits in that window.
  const scale = 2.2;
  const offsetX = -120 * scale;
  const offsetY = 1080 - 240 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">` +
    `<defs><linearGradient id="csbf" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#f1e6cf"/><stop offset=".55" stop-color="#ead9b8"/>` +
    `<stop offset="1" stop-color="#dcbf94"/></linearGradient></defs>` +
    `<rect width="1920" height="1080" fill="url(#csbf)"/>` +
    `<g transform="translate(${offsetX} ${offsetY}) scale(${scale})">${scene(motif)}</g></svg>`;
}

/**
 * Prepare a banner SVG for the citizenschur.ch sermon template (meta
 * `sermon_banner_svg`): drop the fixed root width/height so it scales like the
 * site's own banners, add the site's preserveAspectRatio/role, and suffix every
 * id (and its url(#id) references) so gradients never clash with the page's
 * built-in banners (which use ids like csb / csarch).
 */
export function siteBannerSvg(svg, suffix) {
  const s = String(svg || "").trim();
  if (!s.startsWith("<svg")) return "";
  const tag = (String(suffix || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)) || "md";
  const ids = [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  let out = s.replace(/^<svg\b[^>]*>/, (root) =>
    root
      .replace(/\s(width|height|preserveAspectRatio|role)="[^"]*"/g, "")
      .replace(/>$/, ' preserveAspectRatio="xMidYMid slice" role="presentation">'),
  );
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`\\sid="${esc}"`, "g"), ` id="${id}-${tag}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, "g"), `url(#${id}-${tag})`);
  }
  return out;
}
