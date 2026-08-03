import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(backendRoot, "..");
const read = (fromRepoRoot: string) => fs.readFileSync(path.join(repoRoot, fromRepoRoot), "utf8");

const SYNC = "backend/scripts/sync-db-bill-snapshot.mjs";
const MIGRATION = "backend/sql/1069_db_bill_budget_grn_snapshot.sql";

/**
 * Guards for the db_bill mirror.
 *
 * Every assertion here corresponds to a defect found by validating the source data before
 * the sync was written. They are cheap to keep and each one prevents a silent money error.
 */
describe("db_bill budget / GRN / invoice-line snapshot", () => {
  it("never treats `Reject` as a rejection flag", () => {
    const sync = read(SYNC);
    // Reject = 1 on 85,255 of 85,463 rows, but 80,074 of those carry an ApprovalDate.
    // The truth is RejectDate; reading the flag marks 99.8% of GRNs rejected.
    expect(sync).toContain("is_rejected: safeDateTime(r.RejectDate) ? 1 : 0");
    expect(sync).not.toMatch(/is_rejected:\s*(r\.Reject\b|safeInt\(r\.Reject\))/);
  });

  it("uses decimal money, never safeInt, on the tables that carry paise", () => {
    const sync = read(SYNC);
    for (const field of ["amount: safeDec(r.Amount)", "qty: safeDec(r.qty)", "rate: safeDec(r.rate)"]) {
      expect(sync, `${field} must use safeDec`).toContain(field);
    }
    // safeInt is still correct for tbl_invoice, so it must survive — just not on these.
    expect(sync).not.toContain("amount: safeInt(r.Amount)");
    expect(sync).not.toContain("qty: safeInt(");
  });

  it("keeps expense head ids as strings", () => {
    // '000001' (Communication & Connectivity) and '1' (Security Service Charges) are
    // different heads that collapse to the same integer. 52 ids become 31 as numbers.
    const sql = read(MIGRATION);
    const sqlOnly = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(sqlOnly).toMatch(/head_id\s+VARCHAR/);
    expect(sqlOnly).toMatch(/sub_head_id\s+VARCHAR/);
    expect(sqlOnly, "head ids must never be declared numeric").not.toMatch(/head_id\s+(INT|BIGINT)/);

    const sync = read(SYNC);
    expect(sync, "never cast a head id to a number").not.toMatch(/CAST\([^)]*Head[^)]*AS UNSIGNED\)/i);
  });

  it("derives period_code with the Indian finance year handled correctly", () => {
    const sync = read(SYNC);
    expect(sync).toContain("function toPeriodCode");
    // Jan-Mar fall in the SECOND calendar year of '2026-27'. Getting this wrong files a
    // quarter of the year against the wrong period.
    expect(sync).toContain("monthNum >= 4 ? startYear : startYear + 1");
  });

  it("declares every amount column as DECIMAL, not an integer type", () => {
    const sql = read(MIGRATION);
    const sqlOnly = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    const moneyCols = sqlOnly.match(/^\s+(amount|rate|qty|cgst|sgst|igst)\s+\S+/gm) ?? [];
    expect(moneyCols.length).toBeGreaterThan(0);
    for (const col of moneyCols) {
      expect(col, `${col.trim()} must be DECIMAL`).toMatch(/DECIMAL/);
    }
  });

  it("classifies the billing pattern by shape, not just the word 'seat'", () => {
    const sync = read(SYNC);
    // Matching only /seat/ caught Rs 88 lakh of lines literally labelled "seat" and missed
    // Rs 837 lakh billed as "FTE", "Telecalling" or "Service Charges" — the same per-unit
    // model in different words, and the bulk of the revenue.
    expect(sync).toContain("function billingPattern");
    for (const word of ["fte", "manpower", "telecalling", "service charges"]) {
      expect(sync, `the classifier must recognise "${word}"`).toContain(word);
    }
    expect(sync).toContain("billing_pattern: billingPattern(");
  });

  it("collates every new table explicitly", () => {
    const sql = read(MIGRATION);
    const creates = sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? [];
    const collations = sql.match(/COLLATE=utf8mb4_unicode_ci/g) ?? [];
    expect(creates.length).toBe(4);
    expect(collations.length).toBe(creates.length);
  });

  it("registers the migration and wires each sync into main()", () => {
    expect(read("backend/src/db/runPendingMigrations.ts"))
      .toContain('"1069_db_bill_budget_grn_snapshot.sql"');
    const sync = read(SYNC);
    for (const step of ["expense_heads", "budget", "grn", "particulars"]) {
      expect(sync, `--only=${step} must be runnable`).toContain(`only === '${step}'`);
    }
    // Heads must load before the tables that reference them.
    expect(sync.indexOf("syncExpenseHeads(hrms, bill)")).toBeLessThan(sync.indexOf("syncBudget(hrms, bill)"));
  });
});
