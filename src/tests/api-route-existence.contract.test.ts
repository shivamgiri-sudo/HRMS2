import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Catches frontend calls to endpoints the backend does not serve.
 *
 * Ten such calls were live at once, and none of them surfaced: each hook caught the
 * 404 and returned an empty state, so the agent quality dashboard, the executive
 * process breakdown and the client quality drill-down all rendered blank rather than
 * erroring. A missing route is a build failure now.
 *
 * The check is deliberately conservative — it only asserts that the first path segment
 * after /api is a mounted router prefix, plus an explicit allowlist of paths known to
 * be unimplemented. It will not catch a wrong sub-path under a real prefix, but it does
 * catch an entire prefix that does not exist.
 */
const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const APP_TS = join(ROOT, "backend/src/app.ts");

/** Paths the frontend calls that have no backend route. Each needs a fix or removal. */
const KNOWN_MISSING: ReadonlyArray<{ path: string; owner: string; note: string }> = [
  {
    path: "/api/performance-dashboard/ops",
    owner: "src/pages/UnifiedPerformanceCommandCenter.tsx",
    note: "performance-dashboard router has no /ops route",
  },
  {
    path: "/api/executive/quality-summary/process-breakdown",
    owner: "src/hooks/useExecutiveQuality.ts",
    note: "only /quality-summary exists on the executive router",
  },
  {
    path: "/api/quality-dashboard/client-drill",
    owner: "src/components/quality/ClientQualityDrillModal.tsx",
    note: "no client-drill routes exist anywhere in backend/src",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Router prefixes mounted via app.use("/api/...", ...). */
function mountedPrefixes(): Set<string> {
  const app = readFileSync(APP_TS, "utf8");
  const prefixes = new Set<string>();
  for (const m of app.matchAll(/app\.use\(\s*["'](\/api[^"']*)["']/g)) {
    prefixes.add(m[1]);
  }
  return prefixes;
}

/** Every /api/... literal referenced from src/. */
function referencedPaths(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/]*)/g)) {
      const path = m[1].replace(/\/+$/, "");
      if (!found.has(path)) found.set(path, file.slice(ROOT.length + 1).replace(/\\/g, "/"));
    }
  }
  return found;
}

describe("api route existence contract", () => {
  const prefixes = mountedPrefixes();

  it("parses mounted router prefixes from app.ts", () => {
    expect(prefixes.size).toBeGreaterThan(20);
    expect(prefixes.has("/api/dashboards")).toBe(true);
  });

  it("every /api path the frontend calls sits under a mounted router prefix", () => {
    const refs = referencedPaths();
    const allow = new Set(KNOWN_MISSING.map((k) => k.path));

    const orphans: string[] = [];
    for (const [path, file] of refs) {
      // Skip paths already tracked as known-missing; they are asserted separately.
      if ([...allow].some((a) => path.startsWith(a))) continue;
      // A path is satisfied if any mounted prefix is a prefix of it.
      const covered = [...prefixes].some((p) => path === p || path.startsWith(`${p}/`));
      if (!covered) orphans.push(`${path}  (${file})`);
    }

    expect(
      orphans.sort(),
      `These frontend calls do not fall under any router mounted in backend/src/app.ts, ` +
        `so they 404 at runtime:\n  ${orphans.sort().join("\n  ")}`,
    ).toEqual([]);
  });

  it("tracks the known-unimplemented endpoints so they are not forgotten", () => {
    // This is a ratchet, not an approval. Shrinking KNOWN_MISSING is the goal; growing
    // it requires a deliberate edit and shows up in review.
    expect(KNOWN_MISSING.length).toBeLessThanOrEqual(3);
    for (const entry of KNOWN_MISSING) {
      expect(entry.note.length, `${entry.path} needs a note explaining the gap`).toBeGreaterThan(10);
    }
  });

  it("agent quality data uses the self-scoped /api/agent routes", () => {
    // Regression pin: these four previously targeted /api/quality-dashboard/*/:id,
    // which does not exist. The real routes are self-scoped under /api/agent.
    const hook = readFileSync(join(SRC, "hooks/useAgentQualityData.ts"), "utf8");
    expect(hook).toContain("/api/agent/cq-score");
    expect(hook).toContain("/api/agent/weakness-detail");
    expect(hook).toContain("/api/agent/calls-review");
    expect(hook).toContain("/api/agent/call/");
    expect(hook).not.toContain("/api/quality-dashboard/cq-score");
    expect(hook).not.toContain("/api/quality-dashboard/weakness/");
  });
});
