import { test } from "node:test";
import assert from "node:assert/strict";
import { Resvg } from "@resvg/resvg-js";
import { buildSermonMeta } from "../server/wordpress.js";
import { buildBannerSvg, siteBannerSvg, MOTIFS } from "../server/banner.js";

const seo = { speaker: "Daniel Williamson", scripture: "Jonah 1:17", series: "Jonah" };

test("publish meta carries the picked banner as sermon_banner_svg", () => {
  const meta = buildSermonMeta(seo, {
    audioUrl: "https://example.test/a.mp3",
    transcript: "one\n\ntwo",
    bannerSvg: buildBannerSvg("fish"),
    bannerId: "a1b2c3d4-e5f6",
  });
  assert.equal(meta.sermon_speaker, "Daniel Williamson");
  assert.equal(meta.sermon_scripture, "Jonah 1:17");
  assert.equal(meta.sermon_audio_url, "https://example.test/a.mp3");
  assert.equal(meta.sermon_transcript, "one\r\n\r\ntwo");
  const svg = meta.sermon_banner_svg;
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 240" preserveAspectRatio="xMidYMid slice" role="presentation">'));
  assert.ok(svg.includes('<g transform="translate(470 204) scale(1.2)">'), "fish motif kept");
  assert.ok(!svg.includes("<text"));
});

test("the motif the user cycled to is what gets sent", () => {
  const meta = buildSermonMeta(seo, { bannerSvg: buildBannerSvg("vine"), bannerId: "job1" });
  assert.equal(meta.sermon_banner_svg, siteBannerSvg(buildBannerSvg("vine"), "job1"));
});

test("no banner -> no sermon_banner_svg key (site falls back to its own art)", () => {
  assert.ok(!("sermon_banner_svg" in buildSermonMeta(seo, {})));
  assert.ok(!("sermon_banner_svg" in buildSermonMeta(seo, { bannerSvg: "not svg" })));
});

test("siteBannerSvg gives unique ids and rewrites every url(#id)", () => {
  for (const motif of MOTIFS) {
    const out = siteBannerSvg(buildBannerSvg(motif), "Job-42!");
    const ids = [...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, `${motif} has ids`);
    for (const id of ids) assert.ok(id.endsWith("-job42"), `${motif}: ${id} suffixed`);
    for (const [, ref] of out.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref), `${motif}: url(#${ref}) resolves`);
    assert.ok(!/\swidth="1120"\sheight="240"\sviewBox/.test(out), "root has no fixed size");
    // Still a valid, renderable SVG.
    assert.doesNotThrow(() => new Resvg(out, { fitTo: { mode: "width", value: 560 } }).render());
  }
  assert.notEqual(siteBannerSvg(buildBannerSvg("fish"), "a"), siteBannerSvg(buildBannerSvg("fish"), "b"));
});
