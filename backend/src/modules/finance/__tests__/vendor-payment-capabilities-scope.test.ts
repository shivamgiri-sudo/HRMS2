import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scope a page is TOLD it has must be the scope the data endpoints give it.
 *
 * GET /vendor-payments/capabilities returns readScope: "organisation" | "branch", and computed it
 * from a hand-rolled role list that included `admin` and ignored `branch_admin`.
 * hasGlobalFinanceScope — which resolveFinanceBranchScopeSet actually consults on the data
 * endpoints — does the opposite of both:
 *
 *   - branch_admin PINS a user to their own branch even alongside a global role, because the
 *     branch grant is the more specific statement of intent;
 *   - `admin` is deliberately absent from the overriding set, being a generic grant rather than
 *     a statement that the holder reviews other branches.
 *
 * The live provisioning pattern is a branch admin who also carries `admin`. Those accounts were
 * told "organisation" while GET /vendor-payments returned one branch — so the page labelled a
 * single branch's vendor payments as the whole company's, and a reader would conclude the
 * company owes far less than it does.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));
vi.mock("../vendor-payment.service.js", () => ({
  vendorPaymentService: {
    listBanks: vi.fn(async () => []),
    listPayments: vi.fn(async () => ({ rows: [], total: 0 })),
    getPayment: vi.fn(),
  },
}));
vi.mock("../vendor-payment-ledger.service.js", () => ({
  vendorPaymentLedgerService: { listTransactions: vi.fn(async () => []) },
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { vendorPaymentRouter } from "../vendor-payment.routes.js";

function appFor(roles: string[]) {
  actor = { id: `u-${roles.join("-")}`, role: roles[0], roles };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  app.use("/api/finance", vendorPaymentRouter);
  return app;
}

const readScope = async (roles: string[]) => {
  const res = await request(appFor(roles)).get("/api/finance/vendor-payments/capabilities");
  expect(res.status).toBe(200);
  return res.body.data.readScope;
};

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[{ branch_id: "branch-A" }], []]);
});

describe("readScope agrees with the data endpoints", () => {
  it("a branch_admin who also holds admin is branch-scoped, not organisation", async () => {
    // The case the whole fix exists for: this is how these accounts are provisioned.
    expect(await readScope(["branch_admin", "admin"])).toBe("branch");
  });

  it("a plain branch_admin is branch-scoped", async () => {
    expect(await readScope(["branch_admin"])).toBe("branch");
  });

  it("a branch_head is branch-scoped", async () => {
    expect(await readScope(["branch_head"])).toBe("branch");
  });

  it("a branch_admin who also holds finance_head IS organisation", async () => {
    // finance_head is in the overriding set on purpose — at least one live account carries it
    // alongside branch_admin so the budget review chain does not stall.
    expect(await readScope(["branch_admin", "finance_head"])).toBe("organisation");
  });

  for (const role of ["accounts_head", "finance_head", "finance", "super_admin"]) {
    it(`${role} is organisation`, async () => {
      expect(await readScope([role])).toBe("organisation");
    });
  }

  it("canWrite is unchanged — only accounts_head and super_admin", async () => {
    const app = await request(appFor(["accounts_head"])).get("/api/finance/vendor-payments/capabilities");
    expect(app.body.data.canWrite).toBe(true);
    const nope = await request(appFor(["branch_head"])).get("/api/finance/vendor-payments/capabilities");
    expect(nope.body.data.canWrite).toBe(false);
  });
});
