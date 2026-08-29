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

  it("pnl-actuals.service.ts's P&L Statement mirror leg excludes GRNs the app already counted", () => {
    const service = read("src/modules/process-pnl/pnl-actuals.service.ts");
    expect(service).toContain("a.pnl_cost_amount AS amount");
    expect(service).toContain("g.pnl_cost_amount AS amount");
    // This is the one call site using `gr`/`a` (not `gr2`/`a2`) — it has no outer `gr`/`a` alias
    // already in scope at that nesting level, unlike the other three.
    expect(service).toContain("WHERE gr.grn_number = g.grn_no");
    expect(service).toContain("NOT EXISTS (");
    expect(service).toContain("JOIN grn_cost_allocation a ON a.grn_request_id = gr.id");
  });

  it("ceo-overview.service.ts's spendByBranch is app-side-first, mirror fills gaps only", () => {
    const service = read("src/modules/process-pnl/ceo-overview.service.ts");
    const fn = service.slice(service.indexOf("async function spendByBranch("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("FROM grn_cost_allocation a");
    expect(body).toContain("a.lifecycle_status = 'consumed'");
    expect(body).toContain("FROM grn_entry_line_snapshot l");
    expectDedupGuard(body, "g");
  });

  it("ceo-overview.service.ts's branch-overhead heuristic uses the SAME de-duplicated total it is compared against", () => {
    const service = read("src/modules/process-pnl/ceo-overview.service.ts");
    const fn = service.slice(service.indexOf("async function buildFocus("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    // Comparing totals.indirectCost (already fixed, via spendByBranch) against a still-doubled
    // branchTotal would have thrown the 95% "is this really the whole branch's overhead" check off
    // by roughly 2x on any branch with real Smart GRN activity.
    expect(body).toContain("FROM grn_cost_allocation a");
    expectDedupGuard(body, "g");
    expect(body).toContain("const branchTotal = n(appGrn[0]?.a) + n(branchGrn[0]?.a);");
  });

  it("pnl-reconciliation.service.ts's Live P&L readGrn is app-side-first, mirror fills gaps only", () => {
    const service = read("src/modules/process-pnl/pnl-reconciliation.service.ts");
    const fn = service.slice(service.indexOf("async function readGrn("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("FROM grn_cost_allocation a");
    expect(body).toContain("a.lifecycle_status = 'consumed'");
    expect(body).toContain("FROM grn_entry_line_snapshot l");
    expectDedupGuard(body, "g");
  });
});
