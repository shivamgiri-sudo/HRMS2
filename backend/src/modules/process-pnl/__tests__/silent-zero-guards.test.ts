import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

/**
 * A failed query must never be reported as a number.
 *
 * This is the module's own recurring incident. bpo-pnl.service.ts carries a fifty-line comment
 * about every payroll person costing nothing because an information_schema lookup quietly
 * answered "no" — and right below it sat `catch { return [] }`, the other way in, with no log of
 * any kind. It backs the budget, vendor-actuals and GRN cost queries and getPayrollPeople, so a
 * lock-wait timeout returned HTTP 200 with cost 0 and a spectacular EBITDA, indistinguishable
 * from a genuinely cost-free month.
 *
 * Nobody investigates a number that looks plausible, which is what makes a fabricated zero worse
 * than an error.
 */

const moduleDir = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(moduleDir, file), "utf8");

describe("safeRows tolerates a missing table and nothing else", () => {
  /**
   * Driven through safeRows itself rather than through getSummary.
   *
   * Two earlier drafts of this test went through getSummary and passed with the silent catch
   * still in place — getSummary rejects under a fully-mocked dbHelpers for its own reasons, so
   * neither `.rejects.toThrow()` nor a message match could tell the fixed code from the broken
   * code. safeRows is exported for this: a test that cannot distinguish the two is not a test.
   */
  async function withMockedQueryRows(error: unknown) {
    vi.resetModules();
    const queryRows = vi.fn().mockRejectedValue(error);
    vi.doMock("../../../shared/dbHelpers.js", () => ({
      queryRows,
      tableExists: vi.fn(async () => true),
    }));
    vi.doMock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn() } }));
    const mod = await import("../bpo-pnl.service.js");
    return mod.safeRows;
  }

  it("re-throws an error that is not a missing table", async () => {
    // A lock-wait timeout is the case that used to render as cost 0 on a finance screen.
    const safeRows = await withMockedQueryRows(
      Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT" })
    );
    await expect(
      safeRows("SELECT SUM(amount) FROM vendor_payment_tracking"),
      "a timed-out cost query must surface, not resolve to no rows"
    ).rejects.toThrow(/Lock wait timeout exceeded/);
  });

  it("returns no rows when the table genuinely does not exist", async () => {
    const safeRows = await withMockedQueryRows(
      Object.assign(new Error("Table 'x' doesn't exist"), { code: "ER_NO_SUCH_TABLE" })
    );
    await expect(safeRows("SELECT 1 FROM optional_table")).resolves.toEqual([]);
  });

  it("still treats a missing table as no rows", () => {
    // Several tables here are optional on an older database — that tolerance is the reason the
    // helper exists, and it must survive.
    const source = read("bpo-pnl.service.ts");
    expect(source).toContain('TOLERATED_QUERY_ERRORS = new Set(["ER_NO_SUCH_TABLE"])');
    expect(source).toContain("return [];");
  });

  it("logs before it degrades or throws — the old catch was completely silent", () => {
    const source = read("bpo-pnl.service.ts");
    const helper = source.slice(source.indexOf("async function safeRows"), source.indexOf("function normalizeBillingModel"));
    expect(helper).toContain("console.warn");
    expect(helper).toContain("console.error");
    // The bare swallow must not come back.
    expect(helper).not.toMatch(/catch\s*\{\s*return \[\];\s*\}/);
  });
});

describe("the allocation overlay backing /pnl/bpo/summary and /pnl/bpo/export uses safeRows too", () => {
  /**
   * This file backs two of the six P&L endpoints and was never migrated onto safeRows when
   * a1661272 fixed the sibling bpo-pnl.service.ts — allocationPolicies, newAllocationRows and
   * both legacyAllocatedGrnRows queries each carried their own `.catch(() => [])`, so a schema
   * drift on pnl_allocation_policy / vw_process_pnl_grn_allocation / vendor_payment_tracking /
   * grn_request still degraded to a silently empty allocation set with HTTP 200.
   */
  it("no query in this file swallows every error with a bare catch", () => {
    const source = read("bpo-pnl-allocation-overlay.service.ts");
    expect(source).not.toMatch(/\.catch\(\(\) => \[\]\)/);
    expect(source).toContain("safeRows<AllocationPolicyRow>");
    expect(source).toContain("safeRows<AllocationViewRow>");
    expect(source).toContain("safeRows<LegacyAttributionRow>");
  });
});

describe("a rollup reports what it could not measure", () => {
  it("the consolidation readiness row does not assert 0% for a failed read", () => {
    const routes = read("process-pnl.routes.ts");
    // completionPct: 0 inside success:true made a broken read look like an unplanned branch.
    expect(routes).toContain("completionPct: coverage ? coverage.summary.completionPct : null");
    expect(routes).toContain("coverageAvailable: Boolean(coverage)");
  });
});

describe("bulk upload reports failure as failure", () => {
  it("success follows what was imported, not whether the handler finished", () => {
    const routes = read("pnl-bulk-upload.routes.ts");
    // 500 malformed rows returned {"success": true, "imported": 0} beside a 422.
    expect(routes).toContain("success: status === 200");
    expect(routes).not.toContain("json({ success: true, imported, errors })");
  });
});
