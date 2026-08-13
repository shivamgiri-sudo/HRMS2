/**
 * Regression tests for the four payroll defects fixed on 2026-08-13.
 *
 * Each one is pinned against the shipped source rather than only against behaviour, because
 * three of the four are single tokens inside a large SQL string — a column name, a status list,
 * an arithmetic clause. A behavioural test alone would need the real schema to distinguish
 * `claim_amount` from `amount_approved`, and the whole reason the reimbursement bug survived
 * for months is that its failure looked exactly like "this employee had no claim". Asserting on
 * the statement itself is what makes the regression detectable without a database.
 *
 * The F&F guard is genuinely behavioural and is tested as such, in both directions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Assertions here must see CODE, not prose.
 *
 * Each fix carries a comment explaining the defect, and those comments necessarily quote the
 * broken form — "no longer selects claim_amount" contains `claim_amount`. Matching against the
 * raw file would therefore fail on the very documentation that makes the fix legible, and the
 * obvious way to make it pass would be to delete the explanation. Comments are stripped first
 * so the tests pin the statement and the docblock stays free to describe what went wrong.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^\s*\/\/.*$/gm, "")        // whole-line // comments
    .replace(/^\s*--.*$/gm, "");         // whole-line SQL comments
}

const CALC = stripComments(read("src/modules/payroll/payrollCalculate.service.ts"));
const INCENTIVES = stripComments(read("src/modules/incentives/incentives.service.ts"));

describe("reimbursement read targets a column that exists", () => {
  it("no longer selects the phantom claim_amount column", () => {
    // employee_reimbursement_claim has amount_claimed and amount_approved. `claim_amount` has
    // never existed, so this select raised ER_BAD_FIELD_ERROR on every employee of every run.
    expect(CALC).not.toContain("SUM(COALESCE(claim_amount, 0))");
    expect(CALC).not.toMatch(/claim_amount/);
  });

  it("reads amount_approved, the figure the approver actually authorised", () => {
    expect(CALC).toContain("COALESCE(SUM(amount_approved), 0) AS total_reimbursements");
  });

  it("does not fall back to amount_claimed when no approved amount was recorded", () => {
    // Paying the claimed figure where an approver reduced it, or recorded nothing, would pay
    // an amount nobody authorised. Unpaid-and-visible beats paid-and-guessed.
    expect(CALC).toContain("AND amount_approved IS NOT NULL");
    expect(CALC).not.toMatch(/COALESCE\(\s*amount_approved\s*,\s*amount_claimed\s*\)/);
  });

  it("no longer swallows the failure silently", () => {
    // The bare `catch {}` is what made a permanently-broken read indistinguishable from a
    // legitimate zero. A logged failure is the difference between a bug and an invisible bug.
    // Sliced from the stripped source between two code landmarks, because the comment markers
    // that used to delimit this block are exactly what stripComments removes.
    const start = CALC.indexOf("let approvedReimbursements = 0;");
    const end = CALC.indexOf("let miscDeductions = 0;");
    expect(start, "reimbursement block not found").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = CALC.slice(start, end);
    expect(block).toMatch(/catch \(err\)/);
    expect(block).toContain("[payroll-calc] reimbursement read failed");
    // An empty catch anywhere in this block would restore the original invisible failure.
    expect(block).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });
});

describe("the two incentive consumers agree on which batches are payable", () => {
  it("the engine accepts applied batches, not only approved ones", () => {
    // applyToRun() moves a consumed batch to 'applied'. While the engine matched only
    // 'approved', the next recalculation found nothing and wrote incentive_total = 0 —
    // silently removing an approved incentive from someone's pay.
    expect(CALC).toContain("AND ibu.status IN ('approved', 'applied')");
    expect(CALC).not.toMatch(/AND\s+ibu\.status\s*=\s*'approved'/);
  });

  it("applyToRun looks for the same set of batches", () => {
    expect(INCENTIVES).toContain("iub.status IN ('approved','applied')");
    expect(INCENTIVES).not.toMatch(/iub\.status\s*=\s*'approved'/);
  });
});

describe("applyToRun no longer adds incentive money to payroll", () => {
  it("does not mutate gross_salary or net_salary", () => {
    // Two separate double counts lived in this one statement: against the engine, which already
    // includes the same approved amount, and against itself, because the reset above cleared
    // incentive_total without ever subtracting the previously-added amount from gross/net.
    expect(INCENTIVES).not.toMatch(/gross_salary\s*=\s*gross_salary\s*\+/);
    expect(INCENTIVES).not.toMatch(/net_salary\s*=\s*net_salary\s*\+/);
  });

  it("does not write incentive_total, which the engine owns", () => {
    expect(INCENTIVES).not.toMatch(/SET\s+incentive_total\s*=\s*\?/);
  });

  it("still writes the component rows the payslip needs", () => {
    // Removing the money must not remove the traceability — an employee still has to be able to
    // see which incentive they were paid.
    expect(INCENTIVES).toContain("salary_prep_line_component");
    expect(INCENTIVES).toContain("'INCENTIVE', 'Total Incentive'");
  });
});

describe("salary_prep_run.incentives_applied_at is created by a migration that MySQL 8 accepts", () => {
  const MIGRATION_RAW = read("sql/1211_salary_prep_run_incentives_applied_at.sql");
  // The header explains the defect and therefore quotes the broken syntax; strip it, or the
  // test would demand that the explanation be deleted to pass.
  const MIGRATION = stripComments(MIGRATION_RAW);
  const MANIFEST = read("src/db/runPendingMigrations.ts");

  it("does not use the ADD COLUMN IF NOT EXISTS syntax that broke 398, 404 and 1006", () => {
    expect(MIGRATION).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(MIGRATION).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it("guards both statements on information_schema so it is a true no-op on re-run", () => {
    expect(MIGRATION).toContain("information_schema.COLUMNS");
    expect(MIGRATION).toContain("information_schema.STATISTICS");
    expect((MIGRATION.match(/PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;/g) ?? []).length).toBe(2);
  });

  it("adds the column nullable with no default, so no existing run changes meaning", () => {
    expect(MIGRATION).toMatch(/incentives_applied_at DATETIME NULL/);
    expect(MIGRATION).not.toMatch(/incentives_applied_at DATETIME NOT NULL/);
    expect(MIGRATION).not.toMatch(/DEFAULT (NOW|CURRENT_TIMESTAMP)/i);
  });

  it("is registered in the manifest, or the runner never executes it", () => {
    expect(MANIFEST).toContain('"1211_salary_prep_run_incentives_applied_at.sql"');
  });
});
