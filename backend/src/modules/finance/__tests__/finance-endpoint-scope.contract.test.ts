import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

/**
 * Every finance read resolves a branch scope, not just a role.
 *
 * A role says WHAT someone may do; a scope says WHOSE data. Finance needs both, and the gap
 * between them is silent: an endpoint guarded by `requireRole` alone returns a perfectly valid
 * 200 full of another branch's money.
 *
 * Three endpoints shipped that way and were caught by this sweep, two of them mine:
 *
 *   GET /grns/:id/approval-history          rejection reasons and reviewer commentary — the most
 *                                           candid text in the module
 *   GET /imprest/allocations/:id/…-history  the same, for allocations
 *   GET /imprest/managers/:id               who holds another branch's float
 *
 * All three were reachable by ID with only a role check. A UUID is not an access control: ids
 * leak through exports, logs, screenshots and URLs, and "hard to guess" is not a boundary.
 *
 * The pattern this asserts: a route taking `:id` and returning finance data must either resolve
 * the caller's scope in its handler, or sit behind a branch-authorising middleware.
 */

const at = (rel: string) =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const IMPREST = readFileSync(at("../imprest.routes.ts"), "utf8");
const GRN = readFileSync(at("../grn.routes.ts"), "utf8");
const VOUCHER = readFileSync(at("../salary-voucher.routes.ts"), "utf8");
const PAYMENT = readFileSync(at("../vendor-payment.routes.ts"), "utf8");

/** The block of source belonging to one route registration. */
function routeBlock(source: string, path: string, span = 900): string {
  const at2 = source.indexOf(`"${path}"`);
  expect(at2, `route ${path} must exist`).toBeGreaterThan(-1);
  return source.slice(at2, at2 + span);
}

/** Scope is resolved in the handler, or delegated to a branch-authorising middleware. */
function isScoped(block: string): boolean {
  return /scopeOf\(req\)|resolveFinanceBranchScopeSet|assertFinanceRecordBranch|authorizeGrnBranch|authorizePaymentBranch|scopeVouchers/.test(block);
}

describe("by-id finance reads are branch-guarded", () => {
  it.each([
    ["imprest manager by id", () => routeBlock(IMPREST, "/managers/:id")],
    ["imprest allocation history", () => routeBlock(IMPREST, "/allocations/:id/approval-history")],
    ["GRN approval history", () => routeBlock(GRN, "/grns/:id/approval-history")],
    ["vendor payment by id", () => routeBlock(PAYMENT, "/vendor-payments/:id")],
  ])("%s", (_name, get) => {
    expect(isScoped(get()), "role alone is not a boundary — resolve the branch too").toBe(true);
  });
});

describe("finance list and export reads resolve scope", () => {
  it.each([
    ["imprest managers", () => routeBlock(IMPREST, "/managers")],
    ["imprest manager candidates", () => routeBlock(IMPREST, "/manager-candidates")],
    ["imprest allocations", () => routeBlock(IMPREST, "/allocations")],
    ["imprest ledger", () => routeBlock(IMPREST, "/ledger")],
    ["imprest balance report", () => routeBlock(IMPREST, "/reports/balance")],
    ["imprest details report", () => routeBlock(IMPREST, "/reports/details")],
    ["imprest details export", () => routeBlock(IMPREST, "/reports/details/export")],
    ["salary vouchers", () => routeBlock(VOUCHER, "/runs/:runId/vouchers")],
    ["salary voucher export", () => routeBlock(VOUCHER, "/runs/:runId/vouchers/export")],
    ["IDC db_bill voucher", () => routeBlock(VOUCHER, "/runs/bill/:period/vouchers")],
  ])("%s", (_name, get) => {
    expect(isScoped(get())).toBe(true);
  });
});

describe("an export never returns what its list would not", () => {
  it("resolves scope through the same helper as the list it mirrors", () => {
    // Two resolutions drift. One helper, called by both, is the only version that stays true.
    const details = routeBlock(IMPREST, "/reports/details", 400);
    const detailsExport = routeBlock(IMPREST, "/reports/details/export", 900);
    expect(details).toContain("branchScope: await scopeOf(req)");
    expect(detailsExport).toContain("branchScope: await scopeOf(req)");

    const vouchers = routeBlock(VOUCHER, "/runs/:runId/vouchers", 700);
    const vouchersExport = routeBlock(VOUCHER, "/runs/:runId/vouchers/export", 900);
    expect(vouchers).toContain("scopeVouchers(req,");
    expect(vouchersExport).toContain("scopeVouchers(req,");
  });
});

describe("writes check the branch before moving money", () => {
  it("refuses an allocation into a branch the caller does not hold", () => {
    const block = routeBlock(IMPREST, "/allocations", 1400);
    expect(block).toContain("403");
    expect(block).toContain('scope.mode === "branches"');
  });

  it("refuses to appoint a manager into an unreachable branch", () => {
    // manager-candidates is how the picker is populated, so it is where the boundary belongs.
    const block = routeBlock(IMPREST, "/manager-candidates", 900);
    expect(block).toContain("403");
  });
});
