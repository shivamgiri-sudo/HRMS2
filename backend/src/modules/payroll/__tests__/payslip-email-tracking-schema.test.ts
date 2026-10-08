/**
 * The payslip email-tracking columns must exist, because two live payroll endpoints do nothing
 * but read and write them.
 *
 * Migration 402 declared them with `ADD COLUMN IF NOT EXISTS`, which this MySQL build rejects
 * outright, and 402 is still recorded as applied — so the schema and the bookkeeping disagree
 * and nothing noticed for months. This test pins the three things that make that recurrence
 * detectable without a database: the replacement migration exists, it does not reuse the
 * syntax that failed, and it is registered so the runner will actually execute it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Assert on statements, not on the prose that necessarily quotes the broken form. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIGRATION = stripComments(read("sql/1212_payslip_email_tracking_and_missing_indexes.sql"));
const MANIFEST = read("src/db/runPendingMigrations.ts");
const ROUTES = read("src/modules/payroll/payroll-more.routes.ts");

describe("the endpoints that depend on these columns still do", () => {
  it("POST /runs/:id/email-payslips writes payslip_emailed", () => {
    // If this ever stops being true the migration is no longer load-bearing and should be
    // reconsidered rather than left behind as an unexplained column.
    expect(ROUTES).toContain("SET payslip_emailed = 1, payslip_emailed_at = NOW()");
  });

  it("GET /runs/:id/bulk-payslip-summary reads payslip_emailed", () => {
    expect(ROUTES).toContain("COALESCE(payslip_emailed,0)");
  });
});

describe("migration 1212 creates what 402 failed to create", () => {
  it("adds both missing columns", () => {
    expect(MIGRATION).toMatch(/ADD COLUMN payslip_emailed TINYINT\(1\) NOT NULL DEFAULT 0/);
    expect(MIGRATION).toMatch(/ADD COLUMN payslip_emailed_at DATETIME NULL/);
  });

  it("does not re-add the two columns that already exist", () => {
    // Re-adding them would be harmless under the guards but would make the file's diff stop
    // being an honest statement of the gap.
    expect(MIGRATION).not.toMatch(/ADD COLUMN payslip_generated\b/);
    expect(MIGRATION).not.toMatch(/ADD COLUMN payslip_generated_at\b/);
  });

  it("adds the two missing indexes", () => {
    expect(MIGRATION).toMatch(/CREATE INDEX idx_spl_payslip_gen ON salary_prep_line \(run_id, payslip_generated\)/);
    expect(MIGRATION).toMatch(/CREATE INDEX idx_branch_status ON profile_update_approval \(branch_id, status\)/);
  });

  it("does not reuse the syntax that made 402 fail while being recorded as applied", () => {
    expect(MIGRATION).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(MIGRATION).not.toMatch(/ADD KEY IF NOT EXISTS/i);
    expect(MIGRATION).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it("guards every statement, so re-running is a no-op", () => {
    const guards = (MIGRATION.match(/PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;/g) ?? []).length;
    expect(guards).toBe(4);
    expect((MIGRATION.match(/information_schema\.COLUMNS/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((MIGRATION.match(/information_schema\.STATISTICS/g) ?? []).length).toBe(2);
  });

  it("guards the profile_update_approval index on its column existing too", () => {
    // Indexing a column that does not exist is a hard failure, and on a rebuilt database this
    // file can run before 262's columns land.
    expect(MIGRATION).toMatch(/@i_branch_status = 0 AND @c_pua_branch = 1/);
  });

  it("defaults payslip_emailed to 0, which is true of every existing row", () => {
    // No payslip has ever been marked emailed — the column that would record it never existed.
    expect(MIGRATION).toMatch(/payslip_emailed TINYINT\(1\) NOT NULL DEFAULT 0/);
  });

  it("is registered in the manifest, or the runner never executes it", () => {
    expect(MANIFEST).toContain('"1212_payslip_email_tracking_and_missing_indexes.sql"');
  });
});
