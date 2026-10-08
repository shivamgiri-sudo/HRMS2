import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A report that declares `branchScoped: true` and then applies no row-scope predicate is making
 * a promise it does not keep — the worst shape in this area, because it reads as enforced.
 * payroll-readiness-status was exactly that: it declared branch scoping, a grain of "one row per
 * run per branch" and a primary key of (payroll_month, branch_name), while every one of those
 * depended on salary_prep_run.branch_id, which is NULL on all 66 runs.
 *
 * THE DETECTOR IS THE POINT OF THIS TEST, and it is why the check is written this way.
 *
 * Three earlier attempts matched a hand-written list of helper names and each one was wrong:
 * the first missed `appendMasterBranchScope` and reported 14 offenders, the second missed
 * `appendCandidateScopeConditions` and reported 5. Both numbers were mostly false positives
 * against code that scopes perfectly well. A scan that invents its own idea of what "scoped"
 * looks like will keep condemning working code and, worse, keep missing the real thing.
 *
 * So the helper list is DERIVED from the source: any function whose body actually constrains
 * rows by the caller's scope. Add a new scope helper and this test finds it on its own.
 */

const ROOT = process.cwd();
const R = "src/modules/reporting";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** What "constrains rows by caller scope" looks like, regardless of the wrapper's name. */
const CONSTRAINS = /scope\.branchScope|scope\.branchIds|reportBranchScope|ReportScopeAccessDeniedError/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    if (f.isDirectory()) { if (f.name !== "__tests__") out.push(...sourceFiles(`${dir}/${f.name}`)); }
    else if (f.name.endsWith(".ts")) out.push(`${dir}/${f.name}`);
  }
  return out;
}

/** Every function in the reporting module that constrains rows by scope. */
function scopeHelpers(): Set<string> {
  const helpers = new Set<string>();
  for (const f of sourceFiles(R)) {
    for (const part of read(f).split(/(?=\n(?:export )?(?:async )?function )/)) {
      const n = /^\n(?:export )?(?:async )?function (\w+)\(/.exec(part);
      if (n && CONSTRAINS.test(part)) helpers.add(n[1]);
    }
  }
  return helpers;
}

/** code -> executor function name, from EXECUTOR_MAP's source. */
function executorMap(): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /"([a-z0-9-]+)":\s*([A-Za-z0-9_]+),/g;
  const src = read(`${R}/executors/index.ts`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) map[m[1]] = m[2];
  return map;
}

/** Catalogue entries, sliced so a flag can never be read from a neighbouring entry. */
function catalogEntries(): Map<string, string> {
  const cat = read(`${R}/report-catalog.ts`);
  const marks: Array<{ code: string; at: number }> = [];
  const re = /\n    code: "([a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cat))) marks.push({ code: m[1], at: m.index });
  const out = new Map<string, string>();
  marks.forEach((mk, i) =>
    out.set(mk.code, cat.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : cat.length)));
  return out;
}

function executorBodies(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(resolve(ROOT, `${R}/executors`)).filter(f => f.endsWith(".executor.ts"))) {
    for (const part of read(`${R}/executors/${f}`).split(/(?=\nexport async function )/)) {
      const n = /^\nexport async function (\w+)\(/.exec(part);
      if (n) out[n[1]] = part;
    }
  }
  return out;
}

describe("declared branch scoping is actually applied", () => {
  it("derives its helper list from the source rather than guessing names", () => {
    const helpers = scopeHelpers();
    // Guards the test itself: if this collapses to nothing, every report below would "pass"
    // by looking unscoped-but-unchecked, which is how a green suite hides a regression.
    expect(helpers.size).toBeGreaterThan(5);
    for (const known of ["appendScopeConditions", "appendMasterBranchScope",
                         "appendCandidateScopeConditions"]) {
      expect(helpers, `${known} must be discovered, not assumed`).toContain(known);
    }
  });

  it("no report declares branchScoped: true while applying no scope", () => {
    const helpers = scopeHelpers();
    const calls = new RegExp(String.raw`\b(${[...helpers].join("|")})\s*\(`);
    const entries = catalogEntries();
    const bodies = executorBodies();

    const offenders: string[] = [];
    for (const [code, fn] of Object.entries(executorMap())) {
      const entry = entries.get(code);
      if (!entry || !/\n    branchScoped:\s*true/.test(entry)) continue;
      const body = bodies[fn];
      if (!body) continue;
      const stripped = body.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      if (calls.test(stripped) || helpers.has(fn)) continue;
      offenders.push(`${code} (${fn})`);
    }
    expect(
      offenders,
      "these promise branch scoping and enforce none — either scope them, or set " +
        "branchScoped: false and record why:\n" + offenders.join("\n"),
    ).toEqual([]);
  });
});
