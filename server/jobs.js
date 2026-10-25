// Per-job state kept on disk under DATA_DIR. Each job owns a directory with its
// uploaded source, generated artefacts, and a job.json state file.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** @typedef {"upload"|"detect"|"export"|"transcribe"|"seo"|"image"|"publish"} JobStep */

const STEPS = ["upload", "detect", "export", "transcribe", "seo", "image", "publish"];

export function jobDir(dataDir, id) {
  return join(dataDir, id);
}

export function jobPaths(dataDir, id) {
  const dir = jobDir(dataDir, id);
  return {
    dir,
    state: join(dir, "job.json"),
    source: join(dir, "source"),
    preview: join(dir, "preview.mp3"),
    cleaned: join(dir, "cleaned.mp3"),
    png: join(dir, "image.png"),
    jpg: join(dir, "image.jpg"),
    svg: join(dir, "image.svg"),
  };
}

export async function createJob(dataDir) {
  const id = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const dir = jobDir(dataDir, id);
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  const steps = {};
  for (const step of STEPS) steps[step] = { state: "pending" };
  const job = { id, createdAt: now, updatedAt: now, steps };
  await saveJob(dataDir, job);
  return job;
}

export async function saveJob(dataDir, job) {
  job.updatedAt = Date.now();
  await writeFile(jobPaths(dataDir, job.id).state, JSON.stringify(job, null, 2));
}

export async function loadJob(dataDir, id) {
  const path = jobPaths(dataDir, id).state;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export function setStep(job, step, state, message) {
  job.steps[step] = { state, message };
}

/** Remove job directories older than maxAgeDays. Called once at startup. */
export async function cleanupOldJobs(dataDir, maxAgeDays = 7) {
  if (!existsSync(dataDir)) return 0;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of await readdir(dataDir)) {
    const dir = join(dataDir, entry);
    try {
      const info = await stat(dir);
      if (info.isDirectory() && info.mtimeMs < cutoff) {
        await rm(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}
