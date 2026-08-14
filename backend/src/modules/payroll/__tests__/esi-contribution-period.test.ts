import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { esiContributionPeriodStart } from "../payroll-governance.service.js";

/**
 * ESI coverage attaches for a whole contribution period.
 *
 * Under the ESI Act a person covered at the start of a contribution period —
 * April-September or October-March — remains covered to the end of it even if
 * a mid-period raise takes them past the ceiling.
 *
 * UPDATE 2026-08-14 (delta-audit P0, user-approved fix, this session):
 * calculateNetSalary's deduction logic now DOES enforce this — see
 * esicContinuityOverride in payroll.types.ts / payroll.service.ts and its
 * computation in payrollCalculate.service.ts, tested in
 * esi-continuity-override.test.ts and payroll-audit-fixes.test.ts. This file's
 * own scope stays what it always was (esiContributionPeriodStart's period-math
 * correctness, and this readiness check's report-not-block behaviour) — the
 * "does not alter any ESI deduction path" test below is about
 * payroll-governance.service.ts specifically (the readiness check itself,
 * which still only reports), not about payrollCalculate.service.ts, which is
 * where the real fix now lives.
 *
 * The originally-cited rationale for leaving the deduction unfixed — "would
 * alter the statutory calculation for every employee on every run" — turned
 * out not to describe the actual fix once traced: esicContinuityOverride only
 * changes the outcome for employees who were covered at period start and have
 * since crossed the ceiling (the same population this readiness check already
 * identifies), not everyone. Against production for July 2026 the check found
 * 27 such employees — e.g. 19,570 -> 22,580 and 18,500 -> 30,000 — all first
 * paid in 2026-04, inside the April-September period.
 */

describe("esiContributionPeriodStart", () => {
  it("maps April through September to the April period", () => {
    for (const m of ["04", "05", "06", "07", "08", "09"]) {
      expect(esiContributionPeriodStart(`2026-${m}`)).toBe("2026-04");
    }
  });

  it("maps October through December to the October period", () => {
    for (const m of ["10", "11", "12"]) {
      expect(esiContributionPeriodStart(`2026-${m}`)).toBe("2026-10");
    }
  });

  it("rolls the year back for January to March", () => {
    // The trap. January belongs to the period that opened the previous October, so
    // treating a period as "the last six months of this year" would start it at
    // 2026-10 for a 2026-01 run — a period that has not happened yet, matching
    // nothing and silently reporting no affected employees.
    for (const m of ["01", "02", "03"]) {
      expect(esiContributionPeriodStart(`2026-${m}`)).toBe("2025-10");
    }
  });

  it("never returns a month later than the run month", () => {
    for (let y = 2025; y <= 2027; y++) {
      for (let m = 1; m <= 12; m++) {
        const runMonth = `${y}-${String(m).padStart(2, "0")}`;
        expect(esiContributionPeriodStart(runMonth) <= runMonth, `${runMonth} looked forward`).toBe(true);
      }
    }
  });
});

describe("the readiness check reports rather than deducts", () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payroll-governance.service.ts"),
    "utf8",
  );

  it("raises the crossing as a warning, not a blocker", () => {
    const idx = SOURCE.indexOf("ESI_MID_PERIOD_CEILING_CROSSING");
    expect(idx).toBeGreaterThan(-1);
    // A blocker would stop payroll running at all over a 27-person edge case.
    expect(SOURCE.slice(idx, idx + 120)).toMatch(/"warning"/);
  });

  it("requires both a covered month and a later crossing, not merely being under the ceiling", () => {
    const idx = SOURCE.indexOf("ESI_MID_PERIOD_CEILING_CROSSING");
    const block = SOURCE.slice(Math.max(0, idx - 1800), idx);
    // Only the first half matches 775 employees against 27 real crossings.
    expect(block).toMatch(/HAVING MIN\(prior\.gross_salary\) <=/);
    expect(block).toMatch(/AND MAX\(prior\.gross_salary\) >/);
  });

  it("does not alter any ESI deduction path", () => {
    // The fix is observational. If this file ever starts writing esic_* values,
    // the deduction decision has moved here and the reconciliation this avoided
    // is owed.
    expect(SOURCE).not.toMatch(/UPDATE\s+salary_prep_line[\s\S]{0,200}esic/i);
  });
});
