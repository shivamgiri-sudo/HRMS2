/**
 * A finalised payroll run must not be recalculable.
 *
 * `calculatePayrollRun` refuses to run when the run's status is in
 * LOCKED_STATUSES. That set was {"locked", "disbursed"}, and no run has ever
 * held either value. The live statuses are FINALIZED (51 runs), approved (12),
 * processing (2) and draft (1) — so the guard matched nothing at all, and every
 * finalised run could be recalculated. Those 51 runs cover 61,091 employee
 * payments and roughly 72.6 crore of net pay.
 *
 * Two things made it hard to see. MySQL's collation is case-insensitive, so
 * `status IN ('locked','disbursed')` in SQL would have matched 'LOCKED' and the
 * mismatch looks like a non-issue; but Set.has() in JavaScript is case
 * sensitive, so 'FINALIZED' misses 'finalized' as well. And the guard fails
 * open: when it does not match, the recalculation simply proceeds.
 *
 * Values below were read from production, not from a migration.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const CALC = read("src/modules/payroll-compliance/payrollCalculate.service.ts");
const PAYROLL = read("src/modules/payroll/payroll.service.ts");

/** Every status salary_prep_run actually holds, with run counts. */
const LIVE_RUN_STATUSES = ["FINALIZED", "approved", "processing", "draft"];

/** Must never be recalculated. */
const MUST_BE_LOCKED = ["FINALIZED", "finalized", "LOCKED", "disbursed"];

/** Must stay recalculable — blocking these would stop legitimate work. */
const MUST_STAY_OPEN = ["draft", "processing"];

function lockedSetFrom(source: string): Set<string> {
  const m = source.match(/LOCKED_STATUSES\s*=\s*new Set\(\[([^\]]*)\]\)/);
  expect(m, "LOCKED_STATUSES has moved or changed shape").toBeTruthy();
  return new Set(
    m![1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean),
  );
}

describe("the recalculation lock recognises the real closed status", () => {
  const locked = lockedSetFrom(CALC);

  it("includes finalized, which is what 51 of the 66 runs actually are", () => {
    expect(locked.has("finalized"), "FINALIZED runs were recalculable").toBe(true);
  });

  it("keeps the original values, which cost nothing to retain", () => {
    expect(locked.has("locked")).toBe(true);
    expect(locked.has("disbursed")).toBe(true);
  });

  it("matches at least one status that exists in production", () => {
    const reachable = LIVE_RUN_STATUSES.filter((s) => locked.has(s.toLowerCase()));
    expect(reachable.length, `guard matches none of ${LIVE_RUN_STATUSES.join(", ")}`)
      .toBeGreaterThan(0);
  });
});

describe("the comparison survives the case difference", () => {
  it("compares case-insensitively", () => {
    // 'FINALIZED' would miss a lowercase set member. SQL hides this; Set.has()
    // does not.
    expect(CALC).toMatch(/toLowerCase\(\)/);
    expect(CALC, "the guard should go through the normalising helper")
      .toMatch(/isLockedRunStatus\(run\.status\)/);
  });

  for (const status of MUST_BE_LOCKED) {
    it(`${status} is treated as locked`, () => {
      const locked = lockedSetFrom(CALC);
      expect(locked.has(status.trim().toLowerCase())).toBe(true);
    });
  }

  for (const status of MUST_STAY_OPEN) {
    it(`${status} stays recalculable`, () => {
      const locked = lockedSetFrom(CALC);
      expect(locked.has(status.toLowerCase())).toBe(false);
    });
  }
});

describe("the unused duplicate set is kept correct", () => {
  it("payroll.service.ts does not keep the stale values", () => {
    // Unused today, but a set named LOCKED_STATUSES holding values that match
    // nothing is exactly what gets wired up later and trusted.
    expect(lockedSetFrom(PAYROLL).has("finalized")).toBe(true);
  });
});
