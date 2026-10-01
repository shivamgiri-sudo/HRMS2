import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping for the finance READ pages that admit branch_head (owner ruling 2026-10-01):
 * bank accounts / bank ledger / reconciliation / ledger reports / payment vouchers.
 * branch_head is pinned to its own employee branch (b1); finance / finance_head stay org-wide.
 * A ?branchId from the browser may only narrow: a foreign one is a 403.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

let actor: { id: string; role: string; roles: string[] } = { id: "u1", role: "branch_head", roles: ["branch_head"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; req.userRoles = actor.roles; next(); },
  };
});

import { companyBankAccountRouter } from "../company-bank-account.routes.js";
import { bankReconciliationRouter } from "../bank-reconciliation.routes.js";
import { ledgerReportsRouter } from "../ledger-reports.routes.js";
import { paymentVoucherRouter } from "../payment-voucher.routes.js";

const app = (role: string) => {
  actor = { id: `u-${role}`, role, roles: [role] };
  const a = express();
  a.use(express.json());
  a.use("/bank-accounts", companyBankAccountRouter);
  a.use("/bank-reconciliation", bankReconciliationRouter);
  a.use("/ledger-reports", ledgerReportsRouter);
  a.use("/payment-vouchers", paymentVoucherRouter);
  return a;
};

const sqls = () => execute.mock.calls.map((c) => String(c[0]));
const callWith = (re: RegExp) => execute.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/FROM user_assignment_scope/.test(sql)) return [[], []];
    if (/SELECT branch_id\s+FROM employees/.test(sql)) return [[{ branch_id: "b1" }], []];
    if (/SELECT branch_id FROM company_bank_account WHERE id/.test(sql)) {
      return [[{ branch_id: params?.[0] === "acc-own" ? "b1" : "b2" }], []];
    }
    if (/FROM company_bank_account cba/.test(sql) && /WHERE cba\.id = \?/.test(sql)) {
      return [[{ id: params?.[0], branch_id: params?.[0] === "acc-own" ? "b1" : "b2", account_number_last4: "1234" }], []];
    }
    if (/FROM payment_voucher pv/.test(sql) && /WHERE pv\.id = \?/.test(sql)) {
      return [[{ id: "pv1", bank_account_id: params?.[0] === "pv-own" ? "acc-own" : "acc-other" }], []];
    }
    if (/FROM bank_reconciliation_period WHERE id/.test(sql)) return [[{ bank_account_id: "acc-other" }], []];
    return [[], []];
  });
});

describe("bank accounts", () => {
  it("branch_head list is filtered to its branch", async () => {
    const res = await request(app("branch_head")).get("/bank-accounts");
    expect(res.status).toBe(200);
    const c = callWith(/FROM company_bank_account cba/)!;
    expect(String(c[0])).toMatch(/cba\.branch_id IN \(\?\)/);
    expect(c[1]).toEqual(["b1"]);
  });
  it("finance list is unfiltered", async () => {
    await request(app("finance")).get("/bank-accounts");
    const c = callWith(/FROM company_bank_account cba/)!;
    expect(String(c[0])).not.toMatch(/branch_id IN/);
  });
  it("branch_head cannot open another branch's account, ledger, audit or tally export", async () => {
    for (const path of ["/bank-accounts/acc-other", "/bank-accounts/acc-other/audit", "/bank-accounts/acc-other/ledger",
      "/bank-accounts/acc-other/ledger/export", "/bank-accounts/acc-other/tally-export"]) {
      const res = await request(app("branch_head")).get(path);
      expect(res.status, path).toBe(403);
    }
  });
  it("branch_head can open its own account", async () => {
    const res = await request(app("branch_head")).get("/bank-accounts/acc-own");
    expect(res.status).toBe(200);
  });
  it("finance can open any account (no branch lookup)", async () => {
    const res = await request(app("finance")).get("/bank-accounts/acc-other");
    expect(res.status).toBe(200);
  });
  it("a branch_head with no mapped branch sees nothing (fail closed)", async () => {
    execute.mockImplementation(async () => [[], []]);
    const res = await request(app("branch_head")).get("/bank-accounts");
    expect(res.status).toBe(403);
  });
});

describe("bank reconciliation reads", () => {
  it("refuses periods of another branch's account but serves finance", async () => {
    expect((await request(app("branch_head")).get("/bank-reconciliation/periods?bankAccountId=acc-other")).status).toBe(403);
    expect((await request(app("branch_head")).get("/bank-reconciliation/periods?bankAccountId=acc-own")).status).toBe(200);
    expect((await request(app("finance")).get("/bank-reconciliation/periods?bankAccountId=acc-other")).status).toBe(200);
  });
  it("refuses statement lines of a period on another branch's account", async () => {
    expect((await request(app("branch_head")).get("/bank-reconciliation/periods/p1/statement-lines")).status).toBe(403);
  });
});

describe("ledger reports", () => {
  it("trial balance is limited to the caller's branch", async () => {
    const res = await request(app("branch_head")).get("/ledger-reports/trial-balance");
    expect(res.status).toBe(200);
    const c = callWith(/FROM journal_entry_line jel/)!;
    expect(String(c[0])).toMatch(/je\.branch_id IN \(\?\)/);
    expect(c[1]).toContain("b1");
  });
  it("a client-supplied foreign branchId is a 403, an own one narrows", async () => {
    expect((await request(app("branch_head")).get("/ledger-reports/trial-balance?branchId=b2")).status).toBe(403);
    expect((await request(app("branch_head")).get("/ledger-reports/head-subhead-ledger?branchId=b2")).status).toBe(403);
    expect((await request(app("branch_head")).get("/ledger-reports/trial-balance?branchId=b1")).status).toBe(200);
  });
  it("vendor / account ledger drill-downs are branch-limited too", async () => {
    await request(app("branch_head")).get("/ledger-reports/vendor-ledger/v1");
    expect(sqls().some((s) => /je\.branch_id IN/.test(s))).toBe(true);
  });
  it("filter options only list the caller's branch", async () => {
    await request(app("branch_head")).get("/ledger-reports/filter-options");
    expect(sqls().some((s) => /FROM branch_master WHERE active_status = 1 AND id IN/.test(s))).toBe(true);
  });
  it("finance_head is not restricted", async () => {
    await request(app("finance_head")).get("/ledger-reports/trial-balance");
    const c = callWith(/FROM journal_entry_line jel/)!;
    expect(String(c[0])).not.toMatch(/je\.branch_id IN/);
  });
});

describe("payment vouchers", () => {
  it("list joins on the bank account branch for branch_head, not for finance", async () => {
    await request(app("branch_head")).get("/payment-vouchers");
    expect(String(callWith(/FROM payment_voucher pv/)![0])).toMatch(/cba\.branch_id IN \(\?\)/);
    execute.mockClear();
    await request(app("finance")).get("/payment-vouchers");
    expect(String(callWith(/FROM payment_voucher pv/)![0])).not.toMatch(/branch_id IN/);
  });
  it("export is scoped as well", async () => {
    await request(app("branch_head")).get("/payment-vouchers/export");
    expect(String(callWith(/FROM payment_voucher pv/)![0])).toMatch(/cba\.branch_id IN \(\?\)/);
  });
  it("a voucher on another branch's bank account is a 403 for branch_head", async () => {
    expect((await request(app("branch_head")).get("/payment-vouchers/pv-other")).status).toBe(403);
    expect((await request(app("branch_head")).get("/payment-vouchers/pv-own")).status).toBe(200);
    expect((await request(app("finance")).get("/payment-vouchers/pv-other")).status).toBe(200);
  });
});
