import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePublishStatus, isLiveSite, assertNotLiveSite, hostOf } from "../server/guard.js";

test("publish guard: draft is the default", () => {
  assert.deepEqual(resolvePublishStatus(undefined, undefined, undefined), { ok: true, status: "draft" });
  assert.deepEqual(resolvePublishStatus("draft", false, ""), { ok: true, status: "draft" });
});

test("publish guard: publishing needs both flags", () => {
  assert.equal(resolvePublishStatus("publish", undefined, undefined).ok, false);
  assert.equal(resolvePublishStatus("publish", true, undefined).ok, false);
  assert.equal(resolvePublishStatus("publish", true, "yes").ok, false);
  assert.equal(resolvePublishStatus(undefined, true, "publish").status, "publish");
  assert.deepEqual(resolvePublishStatus("publish", true, "publish"), { ok: true, status: "publish" });
});

test("live-site guard: citizenschur.ch is refused", () => {
  assert.ok(isLiveSite("https://citizenschur.ch"));
  assert.ok(isLiveSite("citizenschur.ch"));
  assert.ok(isLiveSite("https://www.citizenschur.ch/wp-json"));
  assert.ok(isLiveSite("http://CitizensChur.ch"));
  assert.equal(hostOf("https://citizenschur.ch/wp-json/"), "citizenschur.ch");
});

test("live-site guard: throwaway hosts are allowed", () => {
  assert.equal(isLiveSite("http://127.0.0.1:9400"), false);
  assert.equal(isLiveSite("http://localhost:8080"), false);
  assert.equal(isLiveSite("https://staging.example.com"), false);
  // Not fooled by a lookalike domain.
  assert.equal(isLiveSite("https://citizenschur.ch.evil.com"), false);
});

test("assertNotLiveSite throws only for the real site", () => {
  assert.throws(() => assertNotLiveSite("https://citizenschur.ch"), /Refusing to run tests/);
  assert.doesNotThrow(() => assertNotLiveSite("http://127.0.0.1:9400"));
});
