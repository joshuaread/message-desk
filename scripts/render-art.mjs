// Render sample banner art to PNGs so the look can be eyeballed. Uses the real
// chooseMotif so the motif shown is the one the app would pick.
//   node scripts/render-art.mjs [outDir]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { chooseMotif, buildFeaturedSvg, buildBannerSvg } from "../server/banner.js";

const outDir = process.argv[2] || "/workspace/md-recon/art";

const samples = [
  { name: "jonah-1-17-fish", scripture: "Jonah 1:17", title: "What God Does When We Refuse to Listen", keywords: [] },
  { name: "jonah-1-7-16-boat", scripture: "Jonah 1:7-16", title: "Running from God", keywords: [] },
  { name: "romans-8-28-39", scripture: "Romans 8:28-39", title: "More Than Conquerors", keywords: [] },
];

function toPng(svg, width) {
  return Buffer.from(
    new Resvg(svg, { background: "#f1e6cf", fitTo: { mode: "width", value: width } }).render().asPng(),
  );
}

await mkdir(outDir, { recursive: true });
for (const s of samples) {
  const motif = chooseMotif(s);
  await writeFile(join(outDir, `${s.name}.png`), toPng(buildFeaturedSvg(motif), 1920));
  await writeFile(join(outDir, `${s.name}-banner.png`), toPng(buildBannerSvg(motif), 1120));
  console.log(`${s.name}: motif=${motif}`);
}
console.log(`\nWrote ${samples.length * 2} PNG(s) to ${outDir}`);
