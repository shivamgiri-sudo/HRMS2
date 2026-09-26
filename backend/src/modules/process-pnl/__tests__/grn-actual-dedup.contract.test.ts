import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * History: on 2026-08-29 the P&L surfaces were found to count the same GRN twice, once from the
 * app's grn_cost_allocation and once from the db_bill mirror (grn_entry_line_snapshot). That was
 * first fixed with a grn_number NOT EXISTS guard, and on 2026-09-23 the four copies were collapsed
 * into ONE reader, pnl-actuals.service.ts's readGrnSpend().
 *
 * Owner ruling 2026-09-26: "no legacy bill is added to HRMS figures, anywhere". The mirror leg
 * (and its dedup / twin guards) were REMOVED. readGrnSpend now reads HRMS-raised GRNs only
 * (bill_source_id IS NULL and not a 00000000-* system-user backfill row), so there is nothing left
 * to de-duplicate against. These assertions pin that contract at the source-text level.
 */
describe("GRN actual spend is HRMS-raised only: no db_bill mirror leg in the shared reader", () => {
  /** The one shared reader (2026-09-23): every surface below must route through it. */
  function readerBody() {
    const service = read("src/modules/process-pnl/pnl-actuals.service.ts");
    const fn = service.slice(
      service.indexOf("export async function readGrnSpend("),
    );
    return fn.slice(0, fn.indexOf("\n}\n"));
  }

  it("readGrnSpend has no mirror leg: it never touches the db_bill snapshot tables or their guards", () => {
    const body = readerBody();
    expect(body).not.toContain("grn_entry_line_snapshot");
    expect(body).not.toContain("grn_entry_snapshot");
    expect(body).not.toContain("LEGACY_TWIN_MIN_AMOUNT");
    expect(body).not.toContain("l.amount");
  });

  it("both app legs are restricted to HRMS-raised GRNs (no bill_source_id, no system-user rows)", () => {
    const service = read("src/modules/process-pnl/pnl-actuals.service.ts");
    expect(service).toContain(
      "const HRMS_RAISED_GRN_SQL = `gr.bill_source_id IS NULL AND COALESCE(gr.created_by, '') NOT LIKE '00000000-%'`;",
    );
    const body = readerBody();
    // Once per app leg: allocation rows, and ordinary GRNs without allocation rows.
    expect(body.split("${HRMS_RAISED_GRN_SQL}").length - 1).toBe(2);
  });

  it("pnl-actuals.service.ts readGrnSpend reads ex-GST amounts and is company-filtered on both app legs", () => {
    const body = readerBody();
    expect(body).toContain("FROM grn_cost_allocation a");
    // Owner rule 2026-09-24: P&L GRN is EX-GST. Both app legs read amount_without_tax through
    // pnl-ex-gst.ts, never pnl_cost_amount (which carried the non-recoverable GST slice).
    expect(body).toContain('${grnAllocationExGstSql("a")} AS amount');
    expect(body).toContain('${grnRequestExGstSql("gr")} AS amount');
    expect(body).not.toContain("pnl_cost_amount");
    // OWN_COMPANY_SQL (via grnScope) on both legs.
    expect(body.split("${scope.sql}").length - 1).toBe(2);
    expect(body).toContain("gr.accounting_period = ?");
  });

  it("the P&L Statement (getIndirectCostActuals) reads the shared reader", () => {
    const service = read("src/modules/process-pnl/pnl-actuals.service.ts");
    const fn = service.slice(
      service.indexOf("export async function getIndirectCostActuals("),
    );
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain('readGrnSpend(periodCode, "consumed"');
    expect(body).not.toContain("FROM grn_cost_allocation");
  });

  it("ceo-overview.service.ts spendByBranch reads the shared reader (consumed + reserved, every period)", () => {
    const service = read("src/modules/process-pnl/ceo-overview.service.ts");
    const fn = service.slice(service.indexOf("async function spendByBranch("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain('readGrnSpend(period, "consumed", scope)');
    expect(body).toContain('readGrnSpend(period, "reserved", scope)');
    // Owner rule 2026-09-24: reserved is counted for EVERY period — no estimate-window gate.
    expect(body).not.toContain("isEstimateWindow(");
    expect(body).not.toContain("FROM grn_cost_allocation");
  });

  it("ceo-overview.service.ts branch-overhead heuristic uses the SAME total it is compared against", () => {
    const service = read("src/modules/process-pnl/ceo-overview.service.ts");
    const fn = service.slice(service.indexOf("async function buildFocus("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("await spendByBranch(period,");
    expect(body).not.toContain("FROM grn_entry_line_snapshot");
  });

  it("pnl-reconciliation.service.ts Live P&L readGrn/readGrnCommitted read the shared reader", () => {
    const service = read(
      "src/modules/process-pnl/pnl-reconciliation.service.ts",
    );
    expect(service).toContain('readGrnSpend(period, "consumed")');
    expect(service).toContain('readGrnSpend(period, "reserved")');
    // Owner rule 2026-09-24: grnEstimated (reserved) is not gated by the revenue estimate window.
    expect(service).not.toMatch(/grnEstimated = estimateApplies/);
    expect(service).not.toContain("estimateApplies && (grnCommitted");
    expect(service).not.toContain("FROM grn_cost_allocation");
  });
});
