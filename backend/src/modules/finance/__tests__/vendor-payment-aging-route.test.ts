import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for a route-shadowing bug, found and fixed 2026-08-13.
 *
 * GET /vendor-payments/aging used to be registered ~200 lines after
 * GET /vendor-payments/:id. Express matches routes in registration order, and :id matches
 * any literal segment — so every request to .../aging was swallowed by the :id handler as
 * WHERE vendor_payment_tracking.id = 'aging', which never matches a row, and the caller got
 * a 404 "Record not found" instead of the aging report. This is exactly the AP Aging panel
 * VendorPaymentDispatchPage.tsx's showAging toggle calls — it 404ed on every use.
 *
 * getPayment is mocked to resolve null, mirroring what the real "no row with id='aging'"
 * query returns, so a regression back to the old ordering makes this test fail the same way
 * production failed: a 404 instead of the aging report shape.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { getAgingReport, getPayment } = vi.hoisted(() => ({
  getAgingReport: vi.fn(async () => ({ rows: [{ bucket: "0-30", amount: 1000 }] })),
  getPayment: vi.fn(async () => null),
}));
vi.mock("../vendor-payment.service.js", () => ({
  vendorPaymentService: {
    listBanks: vi.fn(async () => []),
    listPayments: vi.fn(async () => ({ rows: [], total: 0 })),
    getPayment,
    getAgingReport,
  },
}));
vi.mock("../vendor-payment-ledger.service.js", () => ({
  vendorPaymentLedgerService: { listTransactions: vi.fn(async () => []) },
}));

const actor = { id: "u-finance-head", role: "finance_head", roles: ["finance_head"] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); },
  };
});

import { vendorPaymentRouter } from "../vendor-payment.routes.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.authUser = actor; req.userRoles = actor.roles; next(); });
  a.use("/api/finance", vendorPaymentRouter);
  return a;
}

beforeEach(() => {
  execute.mockReset().mockResolvedValue([[{ branch_id: "branch-A" }], []]);
  getAgingReport.mockClear();
  getPayment.mockClear();
});

describe("GET /vendor-payments/aging", () => {
  it("reaches the aging handler, not the :id handler shadowing it", async () => {
    const res = await request(app()).get("/api/finance/vendor-payments/aging");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ bucket: "0-30", amount: 1000 }]);
    expect(getAgingReport).toHaveBeenCalledTimes(1);
    // The bug's signature: the :id handler resolves the payment for id="aging" — assert it
    // was never even called, not just that the response happened to look right.
    expect(getPayment).not.toHaveBeenCalled();
  });

  it("still resolves a real vendor-payment id through the :id handler", async () => {
    getPayment.mockResolvedValueOnce({ id: "real-id-123", vendor_name: "Acme" });

    const res = await request(app()).get("/api/finance/vendor-payments/real-id-123");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: "real-id-123", vendor_name: "Acme" });
    expect(getPayment).toHaveBeenCalledWith("real-id-123");
  });
});
