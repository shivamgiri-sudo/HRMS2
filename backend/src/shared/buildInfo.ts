/**
 * The build stamp scripts/write-build-info.mjs leaves in dist/ — read once, shared by every
 * process that has to say which code it is running.
 *
 * WHY IT IS SHARED RATHER THAN COPIED
 *   The release certificate has to prove backend runtime SHA, worker runtime SHA and built
 *   artifact SHA all agree. Only the API served its version; the worker reported nothing, so
 *   its SHA could only be INFERRED from having restarted in the same batch as the API. A
 *   worker left running stale code would satisfy that inference and nobody would know.
 *
 *   The obvious fix — a second copy of the loader in the worker entrypoint — would make the
 *   two able to disagree about where the stamp lives or what a missing file means, which is
 *   the drift this codebase keeps producing. One loader, two callers.
 *
 * PATH NOTE
 *   Resolved relative to this module, and both consumers sit two directories below dist/:
 *   dist/src/routes/health.routes.js and dist/src/workers/all-workers.js, with this at
 *   dist/src/shared/buildInfo.js. So `../../build-info.json` is dist/build-info.json from all
 *   three.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  commit: string;
  branch: string;
  builtAt: string;
}

export const UNKNOWN_BUILD: BuildInfo = { commit: "unknown", branch: "unknown", builtAt: "unknown" };

/**
 * Cached after the first read: the file cannot change without a redeploy, and a redeploy
 * replaces the process. Any failure resolves to "unknown" rather than throwing — a diagnostic
 * must not be the thing that breaks, and "unknown" is a truthful answer that still says
 * something is wrong with how the artifact was built. The release certificate treats
 * "unknown" as a FAILURE, which is the point.
 */
let cached: BuildInfo | null = null;

export function readBuildInfo(): BuildInfo {
  if (cached) return cached;
  try {
    const path = fileURLToPath(new URL("../../build-info.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<BuildInfo>;
    cached = {
      commit: parsed.commit || "unknown",
      branch: parsed.branch || "unknown",
      builtAt: parsed.builtAt || "unknown",
    };
  } catch {
    cached = UNKNOWN_BUILD;
  }
  return cached;
}

/** Test seam — the cache is module state and would leak between cases. */
export function __resetBuildInfoCacheForTests(): void {
  cached = null;
}
