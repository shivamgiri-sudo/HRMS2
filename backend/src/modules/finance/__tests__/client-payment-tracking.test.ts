import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Client Payments: writes retired in favour of Client Billing receipts; reads MAS only. */
const { execute, billQuery } = vi.hoisted(() => ({ execute: vi.fn(), billQuery: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../db/billDb.js", () => ({ billQuery }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
  requireWriteAccess: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

let app: express.Express;
beforeAll(async () => {
  const { clientPaymentTrackingRouter } = await import("../client-payment-tracking.routes.js");
  app = express();
  app.use(express.json());
  app.use("/api/finance/client-payments", clientPaymentTrackingRouter);
});
beforeEach(() => {
  execute.mockReset().mockResolvedValue([[], []]);
  billQuery.mockReset().mockResolvedValue([]);
});

describe("POST /update is retired", () => {
  it("answers 409 with the Client Billing pointer and writes nothing", async () => {
    const res = await request(app)
      .post("/api/finance/client-payments/update")
      .send({ invoice_ref_id: 5, payment_status: "paid", amount_received: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Record client money in Client Billing → Receipts");
    expect(res.body.redirectTo).toBe("/finance/client-billing?tab=receipts");
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("reads are MAS Callnet only", () => {
  const sqls = () => billQuery.mock.calls.map((c) => String(c[0]));

  it("invoices, trends and client summary filter tbl_invoice to MAS cost centres", async () => {
    await request(app).get("/api/finance/client-payments/invoices");
    await request(app).get("/api/finance/client-payments/trends");
    await request(app).get("/api/finance/client-payments/clients");
    const tblInvoice = sqls().filter((s) => s.includes("FROM tbl_invoice i"));
    expect(tblInvoice.length).toBe(4); // list, count, trends, clients
    for (const s of tblInvoice) {
      expect(s).toContain("FROM cost_master mc WHERE mc.cost_center = i.cost_center");
      expect(s).toContain("mascallnet");
    }
  });

  it("seat rates and predictive revenue use MAS cost_master rows only", async () => {
    await request(app).get("/api/finance/client-payments/seat-rates?financeYear=2026-27&month=Oct");
    await request(app).get("/api/finance/client-payments/predictive-revenue?financeYear=2026-27&month=Oct");
    const rates = sqls().filter((s) => s.includes("FROM cost_master cm"));
    expect(rates).toHaveLength(2);
    for (const s of rates) expect(s).toContain("LOWER(COALESCE(cm.company_name, ''))");
  });
});
