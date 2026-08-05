import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { esiContributionPeriodStart } from "../payroll-governance.service.js";

/**
 * ESI coverage attaches for a whole contribution period.
 *
 * calculateNetSalary decides ESI from that month's gross alone
 * (gross <= esic_wage_limit), re-evaluated on every run. Under the ESI Act a
 * person covered at the start of a contribution period — April-September or
 * October-March — remains covered to the end of it even if a mid-period raise
 * takes them past the ceiling. The code drops them the month they cross.
 *
 * The deduction logic is deliberately NOT changed here. Correcting it would alter
 * the statutory calculation for every employee on every run, and the affected
 * population is small. Instead the payroll readiness check reports exactly who is
 * affected, so those cases can be handled without touching anyone else's pay.
 *
 * Against production for July 2026 the check finds 27 employees who crossed
 * mid-period — e.g. 19,570 -> 22,580 and 18,500 -> 30,000 — all first paid in
 * 2026-04, inside the April-September period.
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
