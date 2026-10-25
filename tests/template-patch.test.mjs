import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../wordpress/template-1615/patch-banner.php", import.meta.url).pathname;
const hasPhp = spawnSync("php", ["-v"]).status === 0;
const NEEDLE = "art.innerHTML=PB(passage)||(key==='jonah'?JONAHB:ARCHB);";
const tpl = `<script>(function(){function init(){var s=document.querySelector('.cs-single');\n  ${NEEDLE}\n  s.insertBefore(art,s.firstChild);}})();</script>`;

function run(content, ...flags) {
  const dir = mkdtempSync(join(tmpdir(), "tpl-"));
  const inp = join(dir, "tpl.html");
  const out = join(dir, "tpl-new.html");
  writeFileSync(inp, content);
  const r = spawnSync("php", [SCRIPT, inp, out, ...flags], { encoding: "utf8" });
  return { status: r.status, stderr: r.stderr, out: existsSync(out) ? readFileSync(out, "utf8") : null };
}

test("template patch: default uses the custom banner and drops has-img for explicit art", { skip: !hasPhp && "php not installed" }, () => {
  const r = run(tpl);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.out.includes("var cb=document.getElementById('cs-banner-svg'),cba=(cb&&cb.innerHTML.trim())||PB(passage);if(cba){s.classList.remove('has-img')}art.innerHTML=cba||(key==='jonah'?JONAHB:ARCHB);"));
  assert.ok(!r.out.includes(NEEDLE));
});

test("template patch: --minimal is the literal lookup only", { skip: !hasPhp && "php not installed" }, () => {
  const r = run(tpl, "--minimal");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out, tpl.replace(NEEDLE, "var cb=document.getElementById('cs-banner-svg');art.innerHTML=(cb&&cb.innerHTML.trim())||PB(passage)||(key==='jonah'?JONAHB:ARCHB);"));
});

test("template patch fails loudly without exactly one needle, or when already patched", { skip: !hasPhp && "php not installed" }, () => {
  for (const bad of ["<script></script>", tpl + tpl, run(tpl).out]) {
    const r = run(bad);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ERROR/);
    assert.equal(r.out, null, "nothing written");
  }
});
