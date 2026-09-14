import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../../middleware/errorHandler.js";

const { createProforma } = vi.hoisted(() => ({ createProforma: vi.fn() }));
vi.mock("../client-billing.service.js", () => ({
  clientBillingService: { createProforma },
}));

const { approveInvoice, rejectInvoice } = vi.hoisted(() => ({ approveInvoice: vi.fn(), rejectInvoice: vi.fn() }));
vi.mock("../client-billing-approval.service.js", () => ({
  clientBillingApprovalService: { approveInvoice, rejectInvoice },
}));

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { createCreditNote, approveCreditNote } = vi.hoisted(() => ({ createCreditNote: vi.fn(), approveCreditNote: vi.fn() }));
vi.mock("../client-billing-credit-note.service.js", () => ({
  clientBillingCreditNoteService: { createCreditNote, approveCreditNote },
}));

const { generateInvoicePdf } = vi.hoisted(() => ({ generateInvoicePdf: vi.fn() }));
vi.mock("../client-billing-pdf.service.js", () => ({
  clientBillingPdfService: { generateInvoicePdf },
}));

// requireAuth/requireRole default to an authenticated "finance" caller (in ALLOWED_ROLES) so every
// pre-existing test below keeps passing unchanged. Two opt-in test headers let the new PDF-route
// tests exercise the 401/403 boundaries without touching any other test in this file:
//   x-test-no-auth: any value -> requireAuth responds 401 (unauthenticated)
//   x-test-role: <role>       -> requireAuth sets that role instead of "finance"
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers["x-test-no-auth"]) {
      return res.status(401).json({ success: false, message: "Unauthenticated" });
    }
    req.authUser = {
      id: "u-1", email: "finance@teammas.in",
      role: String(req.headers["x-test-role"] ?? "finance"), isDemo: false,
    };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    const role = req.authUser?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    next();
  },
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
  generateInvoicePdf.mockReset();
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

describe("GET /api/client-billing/proformas/:id/pdf", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    const res = await request(app)
      .get("/api/client-billing/proformas/inv-1/pdf")
      .set("x-test-no-auth", "1");
    expect(res.status).toBe(401);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside ALLOWED_ROLES", async () => {
    const res = await request(app)
      .get("/api/client-billing/proformas/inv-1/pdf")
      .set("x-test-role", "employee");
    expect(res.status).toBe(403);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("returns 400 with the service's error message for an unknown id", async () => {
    generateInvoicePdf.mockRejectedValueOnce(
      Object.assign(new Error("Invoice missing not found"), { statusCode: 400 })
    );
    const res = await request(app).get("/api/client-billing/proformas/missing/pdf");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invoice missing not found/);
  });

  it("returns a PDF buffer for a valid id", async () => {
    const fakePdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(600, 0x20)]);
    generateInvoicePdf.mockResolvedValueOnce(fakePdf);
    const res = await request(app).get("/api/client-billing/proformas/inv-1/pdf");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text, "binary")).toBeTruthy();
    const bodyBuffer: Buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text, "binary");
    expect(bodyBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(generateInvoicePdf).toHaveBeenCalledWith("inv-1");
  });
});

describe("POST /api/client-billing/invoices/:id/approve", () => {
  beforeEach(() => {
    approveInvoice.mockReset();
  });

  it("approves and returns the bill number", async () => {
    approveInvoice.mockResolvedValueOnce({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });

    const res = await request(app).post("/api/client-billing/invoices/inv-1/approve").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" } });
    expect(approveInvoice).toHaveBeenCalledWith({ invoiceId: "inv-1", poNumbers: undefined, userId: "u-1" });
  });

  it("passes poNumbers through when supplied", async () => {
    approveInvoice.mockResolvedValueOnce({ id: "inv-1", billNo: "09-01/26-27", invoiceStatus: "approved" });

    await request(app).post("/api/client-billing/invoices/inv-1/approve").send({ poNumbers: ["PO1", "PO2"] });

    expect(approveInvoice).toHaveBeenCalledWith({ invoiceId: "inv-1", poNumbers: ["PO1", "PO2"], userId: "u-1" });
  });

  it("surfaces a service statusCode error via the shared error handler", async () => {
    approveInvoice.mockRejectedValueOnce(Object.assign(new Error("Invoice inv-1 is not in proforma status"), { statusCode: 400 }));

    const res = await request(app).post("/api/client-billing/invoices/inv-1/approve").send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not in proforma status/);
  });
});

describe("POST /api/client-billing/invoices/:id/reject", () => {
  beforeEach(() => {
    rejectInvoice.mockReset();
  });

  it("returns 400 when reason is missing from the request body", async () => {
    const res = await request(app).post("/api/client-billing/invoices/inv-1/reject").send({});
    expect(res.status).toBe(400);
    expect(rejectInvoice).not.toHaveBeenCalled();
  });

  it("rejects and returns the updated status", async () => {
    rejectInvoice.mockResolvedValueOnce({ id: "inv-1", invoiceStatus: "rejected" });

    const res = await request(app)
      .post("/api/client-billing/invoices/inv-1/reject")
      .send({ reason: "client disputed the charge" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: "inv-1", invoiceStatus: "rejected" } });
    expect(rejectInvoice).toHaveBeenCalledWith({ invoiceId: "inv-1", reason: "client disputed the charge", userId: "u-1" });
  });
});

describe("GET /api/client-billing/invoices/:id/audit-log", () => {
  it("lists audit rows for one invoice", async () => {
    execute.mockResolvedValueOnce([[
      { id: "log-1", invoice_id: "inv-1", action: "created", actor_id: "u-1" },
      { id: "log-2", invoice_id: "inv-1", action: "approved", actor_id: "u-2" },
    ], []]);

    const res = await request(app).get("/api/client-billing/invoices/inv-1/audit-log");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe("GET /api/client-billing/invoices/:id/pdf", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    const res = await request(app)
      .get("/api/client-billing/invoices/inv-1/pdf")
      .set("x-test-no-auth", "1");
    expect(res.status).toBe(401);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("returns 403 for a role outside ALLOWED_ROLES", async () => {
    const res = await request(app)
      .get("/api/client-billing/invoices/inv-1/pdf")
      .set("x-test-role", "employee");
    expect(res.status).toBe(403);
    expect(generateInvoicePdf).not.toHaveBeenCalled();
  });

  it("returns 400 with the service's error message for an unknown id", async () => {
    generateInvoicePdf.mockRejectedValueOnce(
      Object.assign(new Error("Invoice missing not found"), { statusCode: 400 })
    );
    const res = await request(app).get("/api/client-billing/invoices/missing/pdf");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invoice missing not found/);
  });

  it("returns a PDF buffer for a valid id", async () => {
    const fakePdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(600, 0x20)]);
    generateInvoicePdf.mockResolvedValueOnce(fakePdf);
    const res = await request(app).get("/api/client-billing/invoices/inv-1/pdf");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    const bodyBuffer: Buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text, "binary");
    expect(bodyBuffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(generateInvoicePdf).toHaveBeenCalledWith("inv-1");
  });
});

describe("POST /api/client-billing/credit-notes", () => {
  beforeEach(() => { createCreditNote.mockReset(); });

  it("creates a draft credit note", async () => {
    createCreditNote.mockResolvedValueOnce({ id: "cn-1", creditNo: "CN-09-01/26-27", totalAmount: 4500, igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "draft" });

    const res = await request(app).post("/api/client-billing/credit-notes").send({
      invoiceId: "inv-1", category: "Subscription", financeYear: "2026-27",
      monthLabel: "Aug-26", creditDate: "2026-08-19",
      lines: [{ particulars: "Service credit", qty: 1, rate: 4500 }],
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ creditNo: "CN-09-01/26-27" }) });
    expect(createCreditNote).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-1" }));
  });

  it("returns 400 when invoiceId is missing", async () => {
    const res = await request(app).post("/api/client-billing/credit-notes").send({
      category: "Subscription", financeYear: "2026-27", monthLabel: "Aug-26", creditDate: "2026-08-19", lines: [],
    });
    expect(res.status).toBe(400);
    expect(createCreditNote).not.toHaveBeenCalled();
  });
});

describe("POST /api/client-billing/credit-notes/:id/approve", () => {
  beforeEach(() => { approveCreditNote.mockReset(); });

  it("approves and returns the credit note", async () => {
    approveCreditNote.mockResolvedValueOnce({ id: "cn-1", creditNo: "CN-09-01/26-27", totalAmount: 4500, igstAmount: 810, cgstAmount: 0, sgstAmount: 0, grandTotal: 5310, creditStatus: "approved" });

    const res = await request(app).post("/api/client-billing/credit-notes/cn-1/approve").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: expect.objectContaining({ creditStatus: "approved" }) });
    expect(approveCreditNote).toHaveBeenCalledWith({ creditNoteId: "cn-1", userId: "u-1" });
  });
});

describe("GET /api/client-billing/credit-notes", () => {
  it("lists credit notes", async () => {
    execute.mockResolvedValueOnce([[{ id: "cn-1", credit_no: "CN-09-01/26-27" }], []]);
    const res = await request(app).get("/api/client-billing/credit-notes");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: "cn-1", credit_no: "CN-09-01/26-27" }] });
  });
});

describe("GET /api/client-billing/credit-notes/:id", () => {
  it("returns 404 when not found", async () => {
    execute.mockResolvedValueOnce([[], []]);
    const res = await request(app).get("/api/client-billing/credit-notes/missing");
    expect(res.status).toBe(404);
  });

  it("returns the credit note with its lines when found", async () => {
    execute.mockResolvedValueOnce([[{ id: "cn-1", credit_no: "CN-09-01/26-27" }], []]);
    execute.mockResolvedValueOnce([[{ id: "line-1", particulars: "Service credit" }], []]);
    const res = await request(app).get("/api/client-billing/credit-notes/cn-1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: "cn-1", credit_no: "CN-09-01/26-27", lines: [{ id: "line-1", particulars: "Service credit" }] });
  });
});
