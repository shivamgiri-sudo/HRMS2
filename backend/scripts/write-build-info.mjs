/**
 * Stamp the compiled artifact with the commit it was built from.
 *
 * Runs as a postbuild step, so `dist/` always carries a build-info.json naming its own
 * provenance. GET /api/health/version reads it back.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * Nothing in production reported which commit was running. Confirming that a deploy had
 * actually landed meant reading GitHub Actions logs and trusting that the runner's
 * workspace matched the server — which is exactly the assumption a release gate is
 * supposed to test rather than make. The readiness audit lists this as Required, for the
 * backend and the workers separately; both run from this same dist, so one stamp covers
 * both and a divergence between them becomes visible instead of assumed.
 *
 * ── IT MUST NEVER FAIL THE BUILD ─────────────────────────────────────────────
 * `npm run build` gates the deploy. Build metadata is diagnostic, not functional, so a
 * missing git binary or a read-only filesystem must not stop a release: every failure path
 * writes what it can and exits 0. The endpoint reports "unknown" rather than lying, which
 * is the honest failure and still tells you something is wrong with the build environment.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "dist");
const outFile = join(outDir, "build-info.json");

/** CI exports the triggering SHA; a local build asks git. Neither is guaranteed. */
function resolveCommit() {
  const fromEnv = process.env.GITHUB_SHA || process.env.GIT_SHA;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    return execSync("git rev-parse HEAD", { cwd: here, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function resolveBranch() {
  const fromEnv = process.env.GITHUB_REF_NAME;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: here, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const info = {
  commit: resolveCommit(),
  branch: resolveBranch(),
  builtAt: new Date().toISOString(),
  nodeVersion: process.version,
};

try {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(info, null, 2) + "\n", "utf8");
  console.log(`[build-info] ${info.commit.slice(0, 8)} on ${info.branch} at ${info.builtAt}`);
} catch (error) {
  // Diagnostic only — never break a release over it.
  console.warn(`[build-info] could not write ${outFile}: ${error instanceof Error ? error.message : String(error)}`);
}

process.exit(0);
