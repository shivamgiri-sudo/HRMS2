import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../../middleware/errorHandler.js";

const { createProforma } = vi.hoisted(() => ({ createProforma: vi.fn() }));
vi.mock("../client-billing.service.js", () => ({
  clientBillingService: { createProforma },
}));

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u-1", email: "finance@teammas.in", role: "finance", isDemo: false };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

let clientBillingRouter: typeof import("../client-billing.routes.js")["clientBillingRouter"];
let app: express.Express;

beforeAll(async () => {
  ({ clientBillingRouter } = await import("../client-billing.routes.js"));
  app = express();
  app.use(express.json());
  app.use("/api/client-billing", clientBillingRouter);
  app.use(errorHandler);
});

beforeEach(() => {
  createProforma.mockReset();
  execute.mockReset();
});

describe("POST /api/client-billing/proformas", () => {
  it("creates a proforma and returns 201 with the result", async () => {
    createProforma.mockResolvedValueOnce({
      id: "inv-1", proformaNo: "PI/09/7971", totalAmount: 30000,
      igstAmount: 5400, cgstAmount: 0, sgstAmount: 0, grandTotal: 35400,
    });

    const res = await request(app)
      .post("/api/client-billing/proformas")
      .send({
        costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27",
        monthLabel: "Aug-26", invoiceDate: "2026-08-18",
        lines: [{ particulars: "OB Dedicated Seat 1", qty: 1, rate: 30000 }],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ proformaNo: "PI/09/7971" }) });
    expect(createProforma).toHaveBeenCalledWith(expect.objectContaining({ createdBy: "u-1" }));
  });

  it("returns 400 when costCentreId is missing", async () => {
    const res = await request(app)
      .post("/api/client-billing/proformas")
      .send({ category: "Non Subscription", financeYear: "2026-27", monthLabel: "Aug-26", invoiceDate: "2026-08-18", lines: [] });

    expect(res.status).toBe(400);
    expect(createProforma).not.toHaveBeenCalled();
  });

  it("returns 400 when the service rejects an empty line list", async () => {
    createProforma.mockRejectedValueOnce(
      Object.assign(new Error("At least one line item is required"), { statusCode: 400 })
    );

    const res = await request(app)
      .post("/api/client-billing/proformas")
      .send({ costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27", monthLabel: "Aug-26", invoiceDate: "2026-08-18", lines: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/At least one line item is required/);
  });

  it("does not mask an unexpected non-operational failure as a 400", async () => {
    createProforma.mockRejectedValueOnce(new Error("ECONNRESET: connection lost"));

    const res = await request(app)
      .post("/api/client-billing/proformas")
      .send({ costCentreId: "cc-1", category: "Non Subscription", financeYear: "2026-27", monthLabel: "Aug-26", invoiceDate: "2026-08-18", lines: [{ particulars: "x", qty: 1, rate: 1 }] });

    expect(res.status).toBe(500);
  });
});

describe("GET /api/client-billing/proformas", () => {
  it("lists invoices", async () => {
    execute.mockResolvedValueOnce([[{ id: "inv-1", proforma_no: "PI/09/7971" }], []]);
    const res = await request(app).get("/api/client-billing/proformas");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: "inv-1", proforma_no: "PI/09/7971" }] });
  });
});

describe("GET /api/client-billing/proformas/:id", () => {
  it("returns 404 when the invoice does not exist", async () => {
    execute.mockResolvedValueOnce([[], []]);
    const res = await request(app).get("/api/client-billing/proformas/missing");
    expect(res.status).toBe(404);
  });

  it("returns the invoice with its lines when found", async () => {
    execute.mockResolvedValueOnce([[{ id: "inv-1", proforma_no: "PI/09/7971" }], []]);
    execute.mockResolvedValueOnce([[{ id: "line-1", particulars: "OB Dedicated Seat 1" }], []]);
    const res = await request(app).get("/api/client-billing/proformas/inv-1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: "inv-1", proforma_no: "PI/09/7971",
      lines: [{ id: "line-1", particulars: "OB Dedicated Seat 1" }],
    });
  });
});
