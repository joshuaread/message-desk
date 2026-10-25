import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScriptures } from "../server/seo.js";

test("numeric references normalize", () => {
  assert.equal(extractScriptures("Turn to Jonah 1:7-16 today.").primary, "Jonah 1:7-16");
  assert.equal(extractScriptures("Psalm 23 is a comfort.").primary, "Psalm 23");
  assert.equal(extractScriptures("We read 1 Corinthians 13:4-7.").primary, "1 Corinthians 13:4-7");
  // En-dash ranges.
  assert.equal(extractScriptures("Romans 8:28–39 reminds us").primary, "Romans 8:28-39");
});

test("Psalms collapses to Psalm", () => {
  assert.equal(extractScriptures("Psalms 100 calls us to praise").primary, "Psalm 100");
});

test("spoken chapter + verses are parsed", () => {
  const r = extractScriptures("turn to Jonah chapter one verses seven through sixteen");
  assert.equal(r.primary, "Jonah 1:7-16");
});

test("spoken chapter only", () => {
  const r = extractScriptures("open your Bible to John chapter ten");
  assert.equal(r.primary, "John 10");
});

test("multi-word book names win", () => {
  const r = extractScriptures("from Song of Solomon 2:1 we learn");
  assert.equal(r.primary, "Song of Solomon 2:1");
});

test("primary is the most-mentioned reference", () => {
  const text = "Jonah 1 opens the book. Later in Jonah 1:7 the lot is cast. Jonah 1:7 again.";
  const r = extractScriptures(text);
  assert.equal(r.primary, "Jonah 1:7");
  assert.ok(r.refs.includes("Jonah 1"));
});

test("no false positives on ordinary prose", () => {
  const r = extractScriptures("We gathered on a cold morning to sing and pray.");
  assert.equal(r.primary, "");
  assert.equal(r.refs.length, 0);
});
