import { test } from "node:test";
import assert from "node:assert/strict";
import { Resvg } from "@resvg/resvg-js";
import {
  chooseMotif, passageKey, MOTIFS, nextMotif, buildBannerSvg, buildFeaturedSvg,
} from "../server/banner.js";

test("Jonah 1:17 with the refusal title chooses the fish", () => {
  assert.equal(
    chooseMotif({ scripture: "Jonah 1:17", title: "What God Does When We Refuse to Listen" }),
    "fish",
  );
});

test("Jonah 1:7-16 chooses the boat (not the fish)", () => {
  assert.equal(chooseMotif({ scripture: "Jonah 1:7-16", title: "Running from God" }), "boat");
});

test("Jonah 3 at Nineveh chooses the skyline", () => {
  assert.equal(
    chooseMotif({ scripture: "Jonah 3:1-5", title: "Jonah Preaches to Nineveh" }),
    "skyline",
  );
});

test("Jonah 4:6 chooses the vine", () => {
  assert.equal(chooseMotif({ scripture: "Jonah 4:6", title: "The Gourd" }), "vine");
});

test("Jonah 1:1-3 with no keywords falls back to plain hills", () => {
  assert.equal(chooseMotif({ scripture: "Jonah 1:1-3", title: "The Call" }), "hills");
});

test("a non-Jonah passage falls back to arches", () => {
  assert.equal(chooseMotif({ scripture: "Romans 8:28-39", title: "More Than Conquerors" }), "arches");
});

test("passageKey normalizes whitespace, case, and en dashes", () => {
  assert.equal(passageKey("Jonah 1:17"), "jonah1:17");
  assert.equal(passageKey("Jonah 1:7–16"), "jonah1:7-16"); // en dash
  assert.equal(passageKey("  Romans  8:28—39 "), "romans8:28-39"); // em dash + extra spaces
});

test("buildBannerSvg is wordless and 1120x240", () => {
  const svg = buildBannerSvg("fish");
  assert.ok(!svg.includes("<text"), "banner must contain no text");
  assert.ok(svg.includes("viewBox=\"0 0 1120 240\""), "banner must keep the 1120x240 viewBox");
});

test("buildFeaturedSvg is wordless and 1920x1080", () => {
  const svg = buildFeaturedSvg("boat");
  assert.ok(!svg.includes("<text"), "featured must contain no text");
  assert.ok(svg.includes("width=\"1920\"") && svg.includes("height=\"1080\""));
});

test("every motif renders with resvg without throwing", () => {
  for (const motif of MOTIFS) {
    assert.doesNotThrow(() => {
      new Resvg(buildBannerSvg(motif), { fitTo: { mode: "width", value: 1120 } }).render().asPng();
      new Resvg(buildFeaturedSvg(motif), { fitTo: { mode: "width", value: 640 } }).render().asPng();
    }, `motif ${motif} should render`);
  }
});

test("nextMotif cycles through the list and wraps", () => {
  assert.equal(nextMotif(MOTIFS[0]), MOTIFS[1]);
  assert.equal(nextMotif(MOTIFS[MOTIFS.length - 1]), MOTIFS[0]);
  assert.equal(nextMotif("not-a-motif"), MOTIFS[0]);
});

// The Jonah 1:17 whale that went live on citizenschur.ch (template key
// 'jonah1:17'). The repo banner must be the same art: only the gradient id
// (csj17 on the site, csb here) and the explicit width/height differ.
const LIVE_JONAH_1_17 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 240"><defs><linearGradient id="csj17" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e6cf"/><stop offset="1" stop-color="#dcbf94"/></linearGradient></defs><rect width="1120" height="240" fill="url(#csj17)"/><circle cx="900" cy="86" r="52" fill="#f4f3ee" fill-opacity=".8"/><path transform="translate(150 30) scale(0.75)" d="M0 40C-4 18 22 10 36 24C46 2 88 2 96 28C126 22 152 44 136 62H8C-4 62 -6 50 0 40Z" fill="#c9a76d" fill-opacity=".45"/><path d="M0 120C140 92 260 150 400 122S660 90 800 120s230 24 320 6V240H0Z" fill="#c9a76d" fill-opacity=".7"/><path d="M0 160C160 132 290 190 440 160S700 130 860 160s180 18 260 6V240H0Z" fill="#8a6a2f" fill-opacity=".9"/><g transform="translate(470 204) scale(1.2)"><path d="M-92 10C-92 -12 -64 -30 -22 -30C18 -30 46 -20 66 -8C74 -14 80 -24 82 -36C90 -32 98 -32 108 -38C104 -26 94 -14 80 -2C60 16 6 24 -40 22C-72 20 -92 18 -92 10Z" fill="#1a1a17"/><circle cx="-68" cy="-6" r="2.6" fill="#f4f3ee"/><path d="M-58 -31V-44M-58 -44C-61 -53 -70 -56 -76 -51M-58 -44C-55 -53 -46 -56 -40 -51" fill="none" stroke="#f4f3ee" stroke-width="2.4" stroke-linecap="round" stroke-opacity=".9"/></g><path d="M0 204C170 184 300 222 460 204S720 184 880 204s160 12 240 4V240H0Z" fill="#1a1a17"/></svg>';

test("fish banner is identical to the live Jonah 1:17 whale", () => {
  const ours = buildBannerSvg("fish")
    .replace(' width="1120" height="240"', "")
    .replace(/csb\b/g, "csj17");
  assert.equal(ours, LIVE_JONAH_1_17);
});

test("keywords match on word starts, not inside other words", () => {
  // "research"/"season" must not trip sea/storm; "amount" must not trip mount.
  assert.equal(chooseMotif({ scripture: "Romans 12:1", title: "Research the season", keywords: ["amount"] }), "arches");
  assert.equal(chooseMotif({ scripture: "Mark 4:35-41", title: "Peace in the storm" }), "storm");
  assert.equal(chooseMotif({ scripture: "Jonah 1:1-3", title: "Running", keywords: ["whale"] }), "fish");
});
