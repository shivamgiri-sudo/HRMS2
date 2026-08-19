import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceFile = path.resolve(__dirname, "../process-pnl.service.ts");

/**
 * process-pnl.service.ts used to read revenue from `billing_invoice` at four call sites
 * (getInvoiceMap, buildTrend x2, getRevenue, getLedger) gated behind `tableExists("billing_invoice")`,
 * which is always true — the table exists, it is just genuinely empty (0 rows) in production.
 *
 * `billing_invoice` is not an abandoned/superseded table: it is a real, separate ERP invoicing
 * feature (erp.service.ts, migration 036_erp_billing.sql) that nobody has switched on yet. Reading
 * it here silently computed zero revenue for every process on this whole P&L surface — the summary
 * KPIs, the trend chart, the per-process revenue tab and the ledger all agreed on a wrong number,
 * which is worse than an obvious blank.
 *
 * Real revenue now comes from getInvoicedRevenueActuals() / getSnapshotInvoiceLines(), reading the
 * db_bill mirror (billing_invoice_particular_snapshot + billing_provision_snapshot fallback, net of
 * billing_credit_note_snapshot) — the same source ceo-overview.service.ts, pnl-actuals.service.ts,
 * pnl-reconciliation.service.ts and bpo-pnl.service.ts already read.
 *
 * This locks the fix in: no code path in this file may reference the bare `billing_invoice` table
 * again. Comments are stripped first so this file's own explanatory prose (which names the table
 * to explain why it is NOT used) does not trip the assertion.
 */
describe("process-pnl.service.ts does not read the empty billing_invoice table", () => {
  const source = fs.readFileSync(serviceFile, "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("has no SQL or tableExists() reference to the bare billing_invoice table", () => {
    // \b on both sides so billing_invoice_particular_snapshot / billing_invoice_snapshot (the
    // real, correct sources) are not caught by this — underscore is a \w character, so there is
    // no word boundary between "billing_invoice" and "_particular_snapshot" or "_snapshot".
    expect(code).not.toMatch(/\bbilling_invoice\b/);
  });

  it("getInvoiceMap sources revenue from the shared snapshot helper", () => {
    const start = code.indexOf("async function getInvoiceMap");
    expect(start, "getInvoiceMap not found").toBeGreaterThan(-1);
    const fn = code.slice(start, code.indexOf("\nasync function", start + 1));
    expect(fn).toContain("getInvoicedRevenueActuals(period)");
  });

  it("getRevenue and getLedger source invoice-line detail from the shared snapshot helper", () => {
    for (const name of ["async getRevenue(", "async getLedger("]) {
      const start = code.indexOf(name);
      expect(start, `${name} not found`).toBeGreaterThan(-1);
      const fn = code.slice(start, code.indexOf("\n  async ", start + 1));
      expect(fn).toContain("getSnapshotInvoiceLines(");
    }
  });
});
