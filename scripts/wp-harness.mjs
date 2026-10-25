// Start a throwaway WordPress with WP Playground CLI for the tests. Mounts the
// test mu-plugins (sermon CPT + meta + theme render + app-password creds +
// Flywheel-mimic auth stripping) and waits until REST is up, then reads the
// generated application password. In-memory: nothing is persisted.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertNotLiveSite } from "../server/guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const MU_DIR = resolve(here, "../test/wp/mu-plugins");

async function waitFor(fn, { timeoutMs = 180_000, intervalMs = 1500, label = "condition" } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* keep polling */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * @param {{port?:number, log?:(m:string)=>void}} [opts]
 * @returns {Promise<{base:string, user:string, password:string, stop:()=>Promise<void>}>}
 */
export async function startPlayground(opts = {}) {
  const port = opts.port ?? 9400;
  const base = `http://127.0.0.1:${port}`;
  const log = opts.log ?? (() => {});
  // Safety: the throwaway WP must never be the live site.
  assertNotLiveSite(base);

  const args = [
    "-y", "@wp-playground/cli@latest", "server",
    `--port=${port}`,
    "--mount-before-install", `${MU_DIR}:/wordpress/wp-content/mu-plugins`,
    "--verbosity=quiet",
  ];
  log(`starting WP Playground on ${base}`);
  // detached:true => its own process group, so stop() can kill the whole tree
  // (npm exec -> sh -> node); otherwise the real server survives and holds the port.
  const proc = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env, detached: true });
  let out = "";
  proc.stdout.on("data", (c) => {
    out += c;
    log(`[wp] ${String(c).trim().slice(0, 200)}`);
  });
  proc.stderr.on("data", (c) => log(`[wp:err] ${String(c).trim().slice(0, 200)}`));

  let exited = false;
  proc.on("exit", (code) => {
    exited = true;
    log(`[wp] exited ${code}`);
  });

  const killGroup = (signal) => {
    try {
      process.kill(-proc.pid, signal); // negative pid => the whole process group
    } catch {
      try {
        proc.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };
  const stop = async () => {
    if (exited) return;
    killGroup("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    if (!exited) killGroup("SIGKILL");
  };

  try {
    // 1. REST root responds.
    await waitFor(
      async () => {
        if (exited) throw new Error("Playground process exited early");
        const res = await fetch(`${base}/wp-json/`);
        return res.ok;
      },
      { label: "WordPress REST root" },
    );
    log("WordPress REST is up");

    // 2. The fixture created the test user + application password.
    const creds = await waitFor(
      async () => {
        const res = await fetch(`${base}/wp-json/desk-test/v1/creds`);
        if (!res.ok) return null;
        const body = await res.json();
        return body.password ? body : null;
      },
      { label: "test application password" },
    );
    log(`test user ready: ${creds.user}`);

    return { base, user: creds.user, password: creds.password, stop };
  } catch (e) {
    await stop();
    throw new Error(`WP Playground did not come up: ${e.message}\n${out.slice(-500)}`);
  }
}
