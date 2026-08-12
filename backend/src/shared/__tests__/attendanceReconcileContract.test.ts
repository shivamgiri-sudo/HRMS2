/**
 * §3's reconciliation utility rewrites attendance that feeds payroll, so its safety
 * properties are pinned rather than trusted.
 *
 * It exists because a batch on 2026-06-30 18:15–18:20 re-derived attendance_status for three
 * dates but recomputed lwp_value on only two. For 2026-06-25 the LWP stayed at its
 * pre-update value of 1.0, so 65 employees marked `present` carry a full day of LWP and 5
 * `half_day` rows carry 1.00 where 0.50 is correct — 66 over-charged LWP days, ~₹790–1,305 a
 * head.
 *
 * The properties that matter:
 *   1. Dry run is the DEFAULT. Writing must take an explicit switch.
 *   2. It refuses any month whose payroll run is past PROCESSING/DRAFT. Rewriting attendance
 *      under a FINALIZED, LOCKED, DISBURSED or APPROVED run changes what was already paid.
 *   3. It never touches a locked row.
 *   4. It does not invent LWP. The attendance engine recomputes it; this only compares and
 *      persists what the engine returns. Encoding LWP rules here would be a second, rival
 *      payroll arithmetic.
 *   5. It prints before/after per row, because a repair with no evidence cannot be checked.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "..", "..", "scripts", "attendance-lwp-reconcile.ts");
const source = fs.readFileSync(SCRIPT, "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("dry run is the default", () => {
  it("only writes when an explicit apply switch is passed", () => {
    expect(code).toMatch(/--apply/);
    expect(code).toMatch(/APPLY\s*=.*includes\(["']--apply["']\)/);
  });

  it("guards the write behind that switch", () => {
    // upsertDailyRecord is the only thing that persists; it must sit behind APPLY.
    const at = code.indexOf("upsertDailyRecord");
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(Math.max(0, at - 400), at)).toMatch(/if\s*\(\s*APPLY/);
  });
});

describe("finalized-run protection", () => {
  it("refuses to rewrite attendance under a closed payroll run", () => {
    for (const s of ["FINALIZED", "DISBURSED", "LOCKED", "APPROVED"]) {
      expect(code).toContain(s);
    }
    expect(code).toMatch(/salary_prep_run/);
  });

  it("compares run status case-insensitively", () => {
    // Production stores 'FINALIZED' alongside lowercase 'approved'/'processing'/'draft'; a
    // case-sensitive check silently treats FINALIZED as unrecognised and lets the write through.
    expect(code).toMatch(/UPPER\(|toUpperCase\(\)/);
  });
});

describe("scope controls the brief requires", () => {
  it("takes a date range and an employee whitelist", () => {
    // Asserting the parsing, not a literal "--employees" string: options are read through
    // arg(name), so the flag text only appears in the usage banner and the missing-args
    // error. Matching those would pass on a script that documented the option and never
    // read it — which is the accepted-and-ignored-parameter bug that broke the employee
    // directory filter.
    expect(code).toMatch(/arg\(["']from["']\)/);
    expect(code).toMatch(/arg\(["']to["']\)/);
    expect(code).toMatch(/arg\(["']employees["']\)/);
    // ...and that the whitelist reaches the query rather than being parsed and dropped.
    expect(code).toMatch(/EMPLOYEES\.length/);
    expect(code).toMatch(/employee_code IN/);
  });

  it("never touches a locked row", () => {
    expect(code).toMatch(/is_locked\s*=\s*0/);
  });
});

describe("it recomputes rather than invents", () => {
  it("takes LWP from the attendance engine, not from its own rules", () => {
    expect(code).toMatch(/processEmployee/);
    expect(code).toMatch(/lwpValue/);
    // No hand-rolled LWP arithmetic — that would be a rival payroll calculation.
    expect(code).not.toMatch(/lwp\s*=\s*(0\.5|1\.0|1\b)/i);
  });

  it("prints before and after for every changed row", () => {
    expect(code).toMatch(/before/i);
    expect(code).toMatch(/after/i);
  });
});
