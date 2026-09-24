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
 * 2026-08-29: every P&L surface reading GRN spend from the db_bill mirror
 * (grn_entry_line_snapshot/grn_entry_snapshot) was found to have no de-duplication against the
 * app's own grn_cost_allocation. Both sources were built at different times to answer "what did
 * this GRN actually cost", and by the time this was caught, matching by GRN NUMBER (the same
 * physical voucher's own identifier, not a fuzzy vendor/amount/date guess) found 97% of the app's
 * own consumed allocations already present in the mirror under the same number — meaning three
 * separate P&L tabs were counting the same real spend twice:
 *
 *   pnl-actuals.service.ts::getIndirectCostActuals    — P&L Statement tab
 *   ceo-overview.service.ts::spendByBranch            — CEO Overview headline + trend
 *   ceo-overview.service.ts::buildFocus's branchGrn    — CEO Overview's own "is this really the
 *                                                        whole branch's overhead" heuristic,
 *                                                        compared against spendByBranch's already
 *                                                        de-duplicated total and so needing the
 *                                                        same treatment to stay consistent with it
 *   pnl-reconciliation.service.ts::readGrn            — Live P&L / Alerts tab
 *
 * Measured live: 1,452 of 1,495 consumed GRNs (97%) had an exact grn_number = grn_no match;
 * fixing pnl-actuals.service.ts alone dropped its mirror contribution for Apr-Aug 2026 from
 * Rs 32-72 lakh/month (near-total duplication) to Rs 27-59K/month (the genuine remaining gap).
 *
 * Every fix follows the SAME resolution, for the same reason: the app's own consumed allocation
 * is the PRIMARY source (it carries pnl_cost_amount — proper non-recoverable-GST treatment —
 * which the mirror's flat l.amount does not), and the mirror is UNIONed in only for a GRN number
 * the app has not captured, via a NOT EXISTS guard keyed on grn_number = grn_no.
 *
 * 2026-09-23: the four copies had drifted apart again (company filter, ordinary-GRN leg), so they
 * were collapsed into ONE reader, pnl-actuals.service.ts's readGrnSpend(). The guard is now
 * asserted once on that reader, and each surface is asserted to call it rather than run its own.
 */
describe("GRN actual spend is not double-counted across the app and the db_bill mirror", () => {
  /** Checked as independent, whitespace-insensitive lines rather than one indented block — the
   *  same guard is nested at a different depth (and a different join-alias for the outer GRN,
   *  `gr` vs `gr2`) at each of the four call sites, and asserting on indentation would make this
   *  test more fragile than the code it protects. */
  function expectDedupGuard(body: string, outerGrnAlias: string) {
    expect(body).toContain("NOT EXISTS (");
    expect(body).toContain("FROM grn_request gr2");
    expect(body).toContain("JOIN grn_cost_allocation a2 ON a2.grn_request_id = gr2.id");
    expect(body).toContain(`WHERE gr2.grn_number = ${outerGrnAlias}.grn_no`);
    expect(body).toContain("AND a2.lifecycle_status = 'consumed'");
  }

  /** The one shared reader (2026-09-23): every surface below must route through it. */
  function readerBody() {
    const service = read("src/modules/process-pnl/pnl-actuals.service.ts");
    const fn = service.slice(service.indexOf("export async function readGrnSpend("));
    return fn.slice(0, fn.indexOf("\n}\n"));
  }

  it("pnl-actuals.service.ts readGrnSpend is app-side-first, mirror fills gaps only, company-filtered on every leg", () => {
    const body = readerBody();
    expect(body).toContain("FROM grn_cost_allocation a");
    // Owner rule 2026-09-24: P&L GRN is EX-GST. Both app legs read amount_without_tax through
    // pnl-ex-gst.ts, never pnl_cost_amount (which carried the non-recoverable GST slice).
    expect(body).toContain('${grnAllocationExGstSql("a")} AS amount');
    expect(body).toContain('${grnRequestExGstSql("gr")} AS amount');
    expect(body).not.toContain("pnl_cost_amount");
    expect(body).toContain("FROM grn_entry_line_snapshot l");
    expect(body).toContain("l.amount AS amount");
    expect(body).not.toContain("l.total");
    expectDedupGuard(body, "ge");
    // OWN_COMPANY_SQL (via grnScope) on all three legs, not just the mirror.
    expect(body.split("${scope.sql}").length - 1).toBe(3);
    expect(body).toContain("gr.accounting_period = ?");
  });

  it("the P&L Statement (getIndirectCostActuals) reads the shared reader", () => {
    const service = read("src/modules/process-pnl/pnl-actuals.service.ts");
    const fn = service.slice(service.indexOf("export async function getIndirectCostActuals("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("readGrnSpend(periodCode, \"consumed\"");
    expect(body).not.toContain("FROM grn_cost_allocation");
  });

  it("ceo-overview.service.ts spendByBranch reads the shared reader (consumed + reserved in window)", () => {
    const service = read("src/modules/process-pnl/ceo-overview.service.ts");
    const fn = service.slice(service.indexOf("async function spendByBranch("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("readGrnSpend(period, \"consumed\", scope)");
    expect(body).toContain("readGrnSpend(period, \"reserved\", scope)");
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
    const service = read("src/modules/process-pnl/pnl-reconciliation.service.ts");
    expect(service).toContain("readGrnSpend(period, \"consumed\")");
    expect(service).toContain("readGrnSpend(period, \"reserved\")");
    expect(service).not.toContain("FROM grn_cost_allocation");
  });
});
