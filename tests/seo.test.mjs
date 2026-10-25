import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, buildHeuristicSeo, extractTitle } from "../server/seo.js";

test("slugify basics", () => {
  assert.equal(slugify("Fear Reveals What We Worship"), "fear-reveals-what-we-worship");
  assert.equal(slugify("Grace & Truth"), "grace-and-truth");
  assert.equal(slugify("  Hello, World!  "), "hello-world");
  assert.equal(slugify("Don't Worry"), "dont-worry");
  assert.equal(slugify(""), "sermon");
});

test("slugify trims to <= 60 chars on a word boundary", () => {
  const long = "a ".repeat(60) + "end";
  const s = slugify(long);
  assert.ok(s.length <= 60, `len ${s.length}`);
  assert.ok(!s.endsWith("-"));
});

test("extractTitle pulls an announced title", () => {
  assert.equal(extractTitle('The title of this message is "Fear and Faith".'), "Fear and Faith");
  assert.equal(extractTitle("I'm calling this one Running From God today"), "Running From God Today");
});

const JONAH = `Good morning. Turn to Jonah chapter one verses seven through sixteen.
What are you afraid of? Fear has a way of showing us what we really worship.
The sailors were afraid, so they cried out to their gods. Jonah was afraid, so he ran.
Fear reveals what we worship. When we are afraid we reach for whatever we trust most.
The men feared the Lord and they worshiped him. Stop striving and call on the Lord.`;

test("heuristic SEO: a real title, never the first sentence", () => {
  const seo = buildHeuristicSeo(JONAH, { speaker: "Daniel Williamson", series: "Jonah", date: "2026-10-18" });
  assert.notEqual(seo.title.toLowerCase(), "good morning");
  assert.ok(!seo.title.toLowerCase().startsWith("good morning"));
  assert.equal(seo.title, "Fear Reveals What We Worship");
  assert.equal(seo.scripture, "Jonah 1:7-16");
  assert.equal(seo.slug, "fear-reveals-what-we-worship");
  assert.ok(seo.metaDescription.length <= 155, `meta len ${seo.metaDescription.length}`);
  assert.ok(seo.excerpt.length > 0);
  assert.ok(seo.body.includes("\n\n"), "body has paragraphs");
  assert.equal(seo.speaker, "Daniel Williamson");
  assert.equal(seo.series, "Jonah");
  assert.equal(seo.date, "2026-10-18");
});

test("heuristic SEO falls back gracefully on empty transcript", () => {
  const seo = buildHeuristicSeo("", { speaker: "", series: "", date: "2026-10-18" });
  assert.equal(seo.title, "Sunday Message");
  assert.equal(seo.slug, "sunday-message");
  assert.ok(seo.metaDescription.length <= 155);
});
