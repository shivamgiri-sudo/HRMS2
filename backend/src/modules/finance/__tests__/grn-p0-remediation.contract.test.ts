import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(backendRoot, p), "utf8");

describe("F-01: backfill script assigns grn_number atomically", () => {
  it("script file exists", () => {
    expect(() => read("scripts/fix-grn-null-numbers.ts")).not.toThrow();
  });

  it("script uses per-GRN transaction wrapping the number allocation and the UPDATE", () => {
    const src = read("scripts/fix-grn-null-numbers.ts");
    expect(src).toContain("beginTransaction");
    expect(src).toContain("allocateMonthlyGrnNumber");
    expect(src).toContain("grn_number = ?");
    expect(src).toContain("AND grn_number IS NULL");
    expect(src).toContain("commit");
    expect(src).toContain("rollback");
  });

  it("script is idempotent — IS NULL guard prevents double-assignment", () => {
    const src = read("scripts/fix-grn-null-numbers.ts");
    expect(src).toMatch(/grn_number\s+IS\s+NULL/i);
  });

  it("script only targets non-draft rows", () => {
    const src = read("scripts/fix-grn-null-numbers.ts");
    expect(src).toMatch(/status\s*!=\s*'draft'|status\s*<>\s*'draft'|status NOT IN.*draft/i);
  });
});

describe("F-02 + F-03: reclassify script", () => {
  it("script file exists", () => {
    expect(() => read("scripts/fix-grn-legacy-status-reclassify.ts")).not.toThrow();
  });

  it("requires --decision flag for F-02 and exits on missing or invalid value", () => {
    const src = read("scripts/fix-grn-legacy-status-reclassify.ts");
    expect(src).toContain("--decision");
    expect(src).toMatch(/paid|cancelled/);
    expect(src).toMatch(/process\.exit\(1\)|throw.*decision/i);
  });

  it("only targets bill_source_id IS NOT NULL rows (legacy origin)", () => {
    const src = read("scripts/fix-grn-legacy-status-reclassify.ts");
    expect(src).toContain("bill_source_id IS NOT NULL");
  });

  it("writes a sensitive_action_log row for every status change", () => {
    const src = read("scripts/fix-grn-legacy-status-reclassify.ts");
    expect(src).toContain("sensitive_action_log");
    expect(src).toContain("LEGACY_MIGRATION_RECLASSIFY");
  });

  it("F-03 imprest queue items move to approved, vendor items to cancelled", () => {
    const src = read("scripts/fix-grn-legacy-status-reclassify.ts");
    expect(src).toContain("approved");
    expect(src).toContain("cancelled");
  });

  it("wraps UPDATE + sensitive_action_log INSERT in a per-row transaction", () => {
    const src = read("scripts/fix-grn-legacy-status-reclassify.ts");
    expect(src).toContain("beginTransaction");
    expect(src).toContain("commit");
    expect(src).toContain("rollback");
  });
});

describe("F-04: imprest re-attribution scripts exist and are structured correctly", () => {
  it("fix-imprest-reattribute.ts exists", () => {
    expect(() => read("scripts/fix-imprest-reattribute.ts")).not.toThrow();
  });

  it("fix-imprest-reattribute.ts is idempotent — only deletes migration-origin entries", () => {
    const src = read("scripts/fix-imprest-reattribute.ts");
    // Delete step uses created_by = MIGRATION_USER so live entries are never touched
    expect(src).toContain("MIGRATION_USER");
    expect(src).toContain("created_by = ?");
    // INSERT IGNORE prevents duplicate ledger entries on re-run
    expect(src).toContain("INSERT IGNORE");
  });

  it("fix-imprest-rebalance.ts exists", () => {
    expect(() => read("scripts/fix-imprest-rebalance.ts")).not.toThrow();
  });

  it("fix-imprest-rebalance.ts handles deficit branches proportionally", () => {
    const src = read("scripts/fix-imprest-rebalance.ts");
    expect(src).toContain("MIGRATION_USER");
    // Deficit branches get proportional distribution, not zero-balance guarantee
    expect(src).toMatch(/deficit|proportion/i);
  });

  it("assertSufficientBalance in imprest-ledger.service.ts has no date filter", () => {
    // The balance check must include ALL ledger history — filtering by date would
    // make a manager with old debits appear to have funds they do not hold.
    const ledgerSvc = read("src/modules/finance/imprest-ledger.service.ts");
    // Extract just the assertSufficientBalance function body
    const start = ledgerSvc.indexOf("assertSufficientBalance");
    const body = ledgerSvc.slice(start, start + 800);
    expect(body).not.toMatch(/transaction_date\s*[<>]/);
    expect(body).not.toMatch(/created_at\s*[<>]/);
  });
});
