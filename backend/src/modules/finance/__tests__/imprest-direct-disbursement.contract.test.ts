import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Owner ruling 2026-08-17 (option A): the float is handed by Finance Head DIRECTLY to the Branch
 * Admin who spends it. Raising the allocation is the authorisation — there is no second approver,
 * and branch_head has no part in imprest at all.
 *
 * That makes raise-and-disburse a single act by one person, which is a deliberate exception to the
 * maker-checker separation this codebase enforces on F&F payment and payroll sign-off. It is
 * pinned here so the exception stays visible and intentional rather than looking like an oversight
 * someone later "fixes" in either direction without knowing a ruling exists.
 *
 * What still protects it: only finance_head and super_admin can reach the endpoint; the ledger
 * credit and the finance approval event are written in the SAME transaction as the insert, so a
 * failed allocation cannot leave a credited float or an unrecorded disbursement.
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = read("src/modules/finance/imprest.service.ts");
const ROUTES = read("src/modules/finance/imprest.routes.ts");
const PANEL = read("../src/components/finance/grn/imprest/ImprestAllocationPanel.tsx");

describe("imprest allocation is raised and disbursed by Finance Head in one act", () => {
  it("the UI disburses on raise rather than leaving it awaiting a second person", () => {
    expect(PANEL).toContain("disburseImmediately: true");
  });

  it("only Finance Head and Super Admin can raise it", () => {
    expect(ROUTES).toContain('const IMPREST_WRITE_ROLES = ["finance_head", "super_admin"] as const;');
    expect(ROUTES).not.toMatch(/IMPREST_WRITE_ROLES = \[[^\]]*accounts_head/);
    expect(ROUTES).not.toMatch(/IMPREST_WRITE_ROLES = \[[^\]]*branch_head/);
  });

  it("credits the ledger and records the approval event in the SAME transaction as the insert", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("async createAllocation"));
    const insertAt = fn.indexOf("INSERT INTO imprest_allocation");
    const ledgerAt = fn.indexOf("imprestLedgerService.post");
    const eventAt = fn.indexOf("recordFinanceApprovalEvent");
    const commitAt = fn.indexOf("connection.commit()");
    expect(insertAt).toBeGreaterThan(-1);
    // All three must precede the commit — a float credited outside the transaction would survive
    // a rolled-back allocation and claim money moved when it did not.
    expect(ledgerAt).toBeGreaterThan(insertAt);
    expect(eventAt).toBeGreaterThan(insertAt);
    expect(commitAt).toBeGreaterThan(ledgerAt);
    expect(commitAt).toBeGreaterThan(eventAt);
  });

  it("still records WHO disbursed it", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("async createAllocation"));
    expect(fn).toContain("submitted_by");
    expect(fn).toContain("disbursed_at");
    expect(fn).toMatch(/action: input\.disburseImmediately \? "disburse"/);
  });

  it("does not credit the float when the allocation is only submitted", () => {
    // The guard that makes deferred allocations safe: a pending allocation crediting the balance
    // would let a voucher spend money nobody has sent yet.
    const fn = SERVICE.slice(SERVICE.indexOf("async createAllocation"));
    expect(fn).toMatch(/if \(input\.disburseImmediately\) \{[\s\S]{0,120}imprestLedgerService\.post/);
  });
});
