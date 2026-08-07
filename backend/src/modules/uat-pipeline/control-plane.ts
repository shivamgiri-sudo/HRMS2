/**
 * Loading and matching for the two control-plane files at the repository root:
 *
 *   uat/protected-paths.json      the path floor      (dimension one)
 *   uat/capability-registry.json  business capability (dimension two)
 *
 * These files are the authoritative source. The typed wrappers in protected-paths.ts and
 * capability-registry.ts read these same bytes, and so does the CI diff gate, so there is
 * exactly one definition of what is protected rather than a TypeScript copy that can drift
 * from the JSON the gate reads.
 *
 * Both files are deny-tier: the pipeline can never modify the mechanism that decides
 * whether its own modification is acceptable.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTROL_PLANE_DIR = "uat";

/**
 * Walk upward from this file until a directory containing uat/protected-paths.json is
 * found. Deliberately a search rather than a fixed number of "../" segments: this module
 * sits at backend/src/modules/uat-pipeline in development (run through tsx) and at
 * backend/dist/modules/uat-pipeline after a build, which are different depths. A hard-coded
 * relative path works in exactly one of those and fails at runtime in the other.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, CONTROL_PLANE_DIR, "protected-paths.json"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "[uat] Could not locate uat/protected-paths.json by walking up from " +
      dirname(fileURLToPath(import.meta.url)) +
      ". The control-plane files must ship with the application; without them the pipeline " +
      "cannot classify risk and must not fall back to a permissive default."
  );
}

let cachedRoot: string | null = null;
export function repoRoot(): string {
  if (!cachedRoot) cachedRoot = findRepoRoot();
  return cachedRoot;
}

export interface LoadedControlFile<T> {
  data: T;
  /** sha256 of the exact bytes, recorded on every scan so a verdict stays reproducible. */
  sha256: string;
}

/**
 * Read and parse a control-plane file. Deliberately NOT cached across calls in a way that
 * survives a file edit: the sha is recorded per scan, and an admin editing the registry
 * should take effect on the next scan rather than at the next process restart. The files
 * are a few KB, so the read cost is irrelevant next to the correctness gain.
 */
export function readControlPlaneFile<T>(filename: string): LoadedControlFile<T> {
  const full = join(repoRoot(), CONTROL_PLANE_DIR, filename);
  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch (err) {
    // Fail loud. A missing control-plane file must never degrade to "nothing is protected".
    throw new Error(
      `[uat] Cannot read control-plane file ${full}: ${(err as Error).message}. ` +
        "Refusing to continue: risk classification without the control plane would pass " +
        "payroll and auth changes as safe."
    );
  }
  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`[uat] ${filename} is not valid JSON: ${(err as Error).message}`);
  }
  return { data, sha256: createHash("sha256").update(raw, "utf8").digest("hex") };
}

// ── Glob matching ─────────────────────────────────────────────────────────────

const globCache = new Map<string, RegExp>();

/**
 * Minimal glob -> RegExp. Supports the three forms the control-plane files actually use:
 *
 *   **         any characters including "/"      backend/src/modules/payroll/**
 *   *          any characters except "/"        backend/scripts/uat-*.mjs
 *   exact                                        backend/src/app.ts
 *
 * Implemented here rather than pulled from a package on purpose. Checklist item BR-07
 * forbids the pipeline from adding npm dependencies; the module enforcing that rule
 * adding one of its own would be a poor look, and every pattern in use is this simple.
 */
export function globToRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) return cached;

  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // "**/" should also match zero directories, so a/**/b.ts matches a/b.ts
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    out += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${out}$`);
  globCache.set(pattern, re);
  return re;
}

/** Normalises Windows separators so a rule written with "/" matches on either platform. */
export function normalisePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchGlob(pattern: string, filePath: string): boolean {
  return globToRegExp(pattern).test(normalisePath(filePath));
}

/**
 * Table-name matching. Same "*" semantics but case-insensitive and anchored, because
 * MySQL identifiers arrive from user prose in whatever case the reporter typed.
 */
export function matchTablePattern(pattern: string, candidate: string): boolean {
  const key = `table:${pattern}`;
  let re = globCache.get(key);
  if (!re) {
    const body = pattern
      .split("*")
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[A-Za-z0-9_]*");
    re = new RegExp(`^${body}$`, "i");
    globCache.set(key, re);
  }
  return re.test(candidate);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
