import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../../middleware/errorHandler.js";

const m = vi.hoisted(() => ({
  createProforma: vi.fn(),
  updateProforma: vi.fn(),
  approveInvoice: vi.fn(),
  rejectInvoice: vi.fn(),
  createChangeRequest: vi.fn(),
  decideChangeRequest: vi.fn(),
  bulkApprove: vi.fn(),
  submitToClient: vi.fn(),
  listSubmissions: vi.fn(),
  generateInvoicePdf: vi.fn(),
  checkPoCoverage: vi.fn(),
  listAvailablePos: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("../client-billing.service.js", () => ({
  clientBillingService: { createProforma: m.createProforma },
}));
vi.mock("../client-billing-edit.service.js", () => ({
  clientBillingEditService: { updateProforma: m.updateProforma },
}));
vi.mock("../client-billing-approval.service.js", () => ({
  clientBillingApprovalService: {
    approveInvoice: m.approveInvoice,
    rejectInvoice: m.rejectInvoice,
  },
}));
vi.mock("../client-billing-change-request.service.js", () => ({
  clientBillingChangeRequestService: {
    createChangeRequest: m.createChangeRequest,
    decideChangeRequest: m.decideChangeRequest,
    bulkApprove: m.bulkApprove,
  },
}));
vi.mock("../client-billing-submit.service.js", () => ({
  clientBillingSubmitService: {
    submitToClient: m.submitToClient,
    listSubmissions: m.listSubmissions,
  },
}));
vi.mock("../client-billing-credit-note.service.js", () => ({
  clientBillingCreditNoteService: {
    createCreditNote: vi.fn(),
    approveCreditNote: vi.fn(),
  },
}));
vi.mock("../client-billing-pdf.service.js", () => ({
  clientBillingPdfService: {
    generateInvoicePdf: m.generateInvoicePdf,
    generateCreditNotePdf: vi.fn(),
  },
}));
vi.mock("../client-billing-po.js", () => ({
  checkPoCoverage: m.checkPoCoverage,
  listAvailablePos: m.listAvailablePos,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: m.execute, query: m.execute },
}));
vi.mock("../../../shared/branchDecisionScope.js", () => ({
  loadBranchPolicy: async () => ({ orgWide: true, ownBranchId: null, allows: () => true }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = {
      id: "u-1",
      email: "f@teammas.in",
      role: String(req.headers["x-test-role"] ?? "finance"),
      isDemo: false,
    };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole:
    (...roles: string[]) =>
    (req: any, res: any, next: any) =>
      roles.includes(req.authUser?.role)
        ? next()
        : res.status(403).json({ success: false, message: "Forbidden" }),
}));

let app: express.Express;
beforeAll(async () => {
  const { clientBillingRouter } = await import("../client-billing.routes.js");
  app = express();
  app.use(express.json());
  app.use("/api/client-billing", clientBillingRouter);
  app.use(errorHandler);
});
beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));

describe("P5 routes", () => {
  it("POST /proformas passes PO/GRN/JCC references through only when supplied", async () => {
    m.createProforma.mockResolvedValue({ id: "i", proformaNo: "PI/09/1" });
    const base = {
      costCentreId: "cc",
      category: "Others",
      financeYear: "2026-27",
      monthLabel: "Sep-26",
      invoiceDate: "2026-09-30",
      lines: [],
    };
    await request(app).post("/api/client-billing/proformas").send(base);
    expect(m.createProforma.mock.calls[0][0]).not.toHaveProperty("references");
    await request(app)
      .post("/api/client-billing/proformas")
      .send({
        ...base,
        poNumbers: ["PO1", "PO2"],
        grnNo: "G1",
        rcmApplicable: true,
      });
    expect(m.createProforma.mock.calls[1][0].references).toMatchObject({
      poNumbers: ["PO1", "PO2"],
      grnNo: "G1",
      rcmApplicable: true,
    });
  });

  it("PUT /proformas/:id edits via the edit service with the caller as actor", async () => {
    m.updateProforma.mockResolvedValue({ id: "i", changed: [] });
    const res = await request(app)
      .put("/api/client-billing/proformas/i")
      .send({
        category: "Topup",
        lines: [{ particulars: "x", qty: 1, rate: 5 }],
      });
    expect(res.status).toBe(200);
    expect(m.updateProforma).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: "i",
        userId: "u-1",
        category: "Topup",
      }),
    );
  });

  it("an unauthorised role is refused on every new write route", async () => {
    for (const [method, url] of [
      ["put", "/api/client-billing/proformas/i"],
      ["post", "/api/client-billing/invoices/bulk-approve"],
      ["post", "/api/client-billing/invoices/i/change-requests"],
      ["post", "/api/client-billing/change-requests/r/approve"],
      ["post", "/api/client-billing/invoices/i/submit-to-client"],
    ] as const) {
      const res = await (request(app) as any)
        [method](url)
        .set("x-test-role", "employee")
        .send({});
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });

  it("bulk approve validates the body and reports counts", async () => {
    expect(
      (
        await request(app)
          .post("/api/client-billing/invoices/bulk-approve")
          .send({})
      ).status,
    ).toBe(400);
    m.bulkApprove.mockResolvedValue([
      { invoiceId: "a", ok: true, billNo: "09-01/26-27" },
      { invoiceId: "b", ok: false, error: "x" },
    ]);
    const res = await request(app)
      .post("/api/client-billing/invoices/bulk-approve")
      .send({ invoiceIds: ["a", "b"] });
    expect(res.body.data).toMatchObject({ approved: 1, failed: 1 });
    expect(m.bulkApprove).toHaveBeenCalledWith(["a", "b"], "u-1");
  });

  it("change-request create/decide use the caller identity (maker-checker input)", async () => {
    m.createChangeRequest.mockResolvedValue({ id: "r" });
    const created = await request(app)
      .post("/api/client-billing/invoices/i/change-requests")
      .send({ requestType: "void", reason: "billed twice" });
    expect(created.status).toBe(201);
    expect(m.createChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: "i",
        requestType: "void",
        userId: "u-1",
      }),
    );
    m.decideChangeRequest.mockResolvedValue({
      id: "r",
      requestStatus: "declined",
    });
    await request(app)
      .post("/api/client-billing/change-requests/r/decline")
      .send({ note: "valid bill" });
    expect(m.decideChangeRequest).toHaveBeenCalledWith({
      requestId: "r",
      decision: "decline",
      note: "valid bill",
      userId: "u-1",
    });
  });

  it("submit-to-client forwards recipients and the letterhead choice", async () => {
    m.submitToClient.mockResolvedValue({
      submissionId: "s",
      billNo: "09-01/26-27",
      to: ["a@b.com"],
      cc: [],
      sentAt: "now",
    });
    const res = await request(app)
      .post("/api/client-billing/invoices/i/submit-to-client")
      .send({ to: ["a@b.com"], letterhead: false });
    expect(res.status).toBe(200);
    expect(m.submitToClient).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: "i",
        to: ["a@b.com"],
        letterhead: false,
        userId: "u-1",
      }),
    );
  });

  it("PDF letterhead query: 1/true (and absent) on, 0/false off", async () => {
    m.generateInvoicePdf.mockResolvedValue(Buffer.from("%PDF-1.3"));
    for (const [q, expected] of [
      ["?letterhead=1", true],
      ["?letterhead=true", true],
      ["", true],
      ["?letterhead=0", false],
      ["?letterhead=false", false],
    ] as const) {
      m.generateInvoicePdf.mockClear();
      await request(app).get(`/api/client-billing/invoices/inv-1/pdf${q}`);
      expect(m.generateInvoicePdf).toHaveBeenCalledWith("inv-1", expected);
    }
  });

  it("GET /po/check validates its inputs and returns the coverage result", async () => {
    expect(
      (await request(app).get("/api/client-billing/po/check")).status,
    ).toBe(400);
    m.checkPoCoverage.mockResolvedValue({
      ok: false,
      errors: ["PO balance low"],
      totalBalance: 5,
      poNumbers: ["PO1"],
      usableRows: [],
    });
    const res = await request(app).get(
      "/api/client-billing/po/check?costCentreId=cc&invoiceDate=2026-09-30&grandTotal=100&poNumbers=PO1",
    );
    expect(res.body.data).toEqual({
      ok: false,
      errors: ["PO balance low"],
      totalBalance: 5,
      poNumbers: ["PO1"],
    });
  });
});
