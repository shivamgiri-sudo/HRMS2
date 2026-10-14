// Route-level governance (audit 2026-10-14): C1 whitelist, C3 bulk scope, H1 / M3 branch scope,
// credit-note reject route, L2 settings role, PO approve / reject routes.
import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../../middleware/errorHandler.js";

const m = vi.hoisted(() => ({
  createProforma: vi.fn(), updateProforma: vi.fn(), approveInvoice: vi.fn(), approveProforma: vi.fn(), rejectInvoice: vi.fn(),
  bulkApprove: vi.fn(), createChangeRequest: vi.fn(), decideChangeRequest: vi.fn(),
  createCreditNote: vi.fn(), approveCreditNote: vi.fn(), rejectCreditNote: vi.fn(),
  submitToClient: vi.fn(), listSubmissions: vi.fn(), generateInvoicePdf: vi.fn(),
  createProvision: vi.fn(), uploadProvisions: vi.fn(), listProvisions: vi.fn(),
  decidePo: vi.fn(), branchOf: vi.fn(),
  execute: vi.fn(), query: vi.fn(),
}));
const policy = vi.hoisted(() => ({ orgWide: true, ownBranchId: null as string | null }));

vi.mock("../client-billing.service.js", () => ({ clientBillingService: { createProforma: m.createProforma } }));
vi.mock("../client-billing-edit.service.js", () => ({ clientBillingEditService: { updateProforma: m.updateProforma } }));
vi.mock("../client-billing-approval.service.js", () => ({
  clientBillingApprovalService: { approveInvoice: m.approveInvoice, approveProforma: m.approveProforma, rejectInvoice: m.rejectInvoice },
}));
vi.mock("../client-billing-change-request.service.js", () => ({
  clientBillingChangeRequestService: { bulkApprove: m.bulkApprove, createChangeRequest: m.createChangeRequest, decideChangeRequest: m.decideChangeRequest },
}));
vi.mock("../client-billing-credit-note.service.js", () => ({
  clientBillingCreditNoteService: { createCreditNote: m.createCreditNote, approveCreditNote: m.approveCreditNote, rejectCreditNote: m.rejectCreditNote },
}));
vi.mock("../client-billing-submit.service.js", () => ({ clientBillingSubmitService: { submitToClient: m.submitToClient, listSubmissions: m.listSubmissions } }));
vi.mock("../client-billing-pdf.service.js", () => ({ clientBillingPdfService: { generateInvoicePdf: m.generateInvoicePdf } }));
vi.mock("../client-billing-provision.service.js", () => ({
  clientBillingProvisionService: { createProvision: m.createProvision, uploadProvisions: m.uploadProvisions, listProvisions: m.listProvisions },
  provisionRequired: () => true,
}));
vi.mock("../client-billing-po-master.service.js", () => ({ clientPoMasterService: { decidePo: m.decidePo, branchOf: m.branchOf } }));
vi.mock("../client-billing-receipt.service.js", () => ({ clientBillingReceiptService: {}, legacyBillsAllowed: () => false }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute, query: m.query } }));
vi.mock("../../../shared/branchDecisionScope.js", () => ({
  loadBranchPolicy: async () => ({ ...policy, allows: (b: unknown) => policy.orgWide || (!!b && b === policy.ownBranchId) }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u-1", email: "a@teammas.in", role: String(req.headers["x-test-role"] ?? "admin"), isDemo: false };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) =>
    roles.includes(req.authUser?.role) ? next() : res.status(403).json({ success: false, message: "Forbidden" }),
}));

let app: express.Express;
beforeAll(async () => {
  const { clientBillingRouter } = await import("../client-billing.routes.js");
  const { clientPoRouter } = await import("../client-billing-po.routes.js");
  app = express();
  app.use(express.json());
  app.use("/api/client-billing/po-master", clientPoRouter);
  app.use("/api/client-billing", clientBillingRouter);
  app.use(errorHandler);
});

/** Branch lookups: ids starting with "mine" sit in branch b-1, everything else in b-2. */
function branchDb() {
  m.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT cc.branch_id FROM/.test(sql)) return [[{ branch_id: String(params[0]).startsWith("mine") ? "b-1" : "b-2" }], []];
    return [[], []];
  });
  m.query.mockResolvedValue([[{ total: 0 }], []]);
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  policy.orgWide = false; policy.ownBranchId = "b-1";
  branchDb();
});

describe("C1: PUT /proformas/:id", () => {
  it("whitelists fields and sets invoiceId / userId from the server, after the body", async () => {
    m.updateProforma.mockResolvedValue({ id: "mine-1" });
    const res = await request(app).put("/api/client-billing/proformas/mine-1")
      .send({ invoiceId: "other", userId: "someone-else", createdBy: "x", costCentreId: "cc-9", description: "Oct", lines: [] });
    expect(res.status).toBe(200);
    expect(m.updateProforma).toHaveBeenCalledWith({ description: "Oct", lines: [], invoiceId: "mine-1", userId: "u-1" });
  });
  it("is branch-guarded", async () => {
    const res = await request(app).put("/api/client-billing/proformas/theirs-1").send({ description: "x" });
    expect(res.status).toBe(403);
    expect(m.updateProforma).not.toHaveBeenCalled();
  });
});

describe("C3: bulk approve checks every id's branch", () => {
  it("approves only in-scope ids and reports the rest", async () => {
    m.bulkApprove.mockResolvedValue([{ invoiceId: "mine-1", ok: true, billNo: "09-01/26-27" }]);
    const res = await request(app).post("/api/client-billing/invoices/bulk-approve").send({ invoiceIds: ["mine-1", "theirs-1"] });
    expect(m.bulkApprove).toHaveBeenCalledWith(["mine-1"], "u-1");
    expect(res.body.data).toMatchObject({ approved: 1, failed: 1 });
    expect(res.body.data.results[1]).toEqual({ invoiceId: "theirs-1", ok: false, error: "Outside your branch / assigned scope" });
  });
});

describe("H1 / branch scope on mutating routes", () => {
  it.each([
    ["post", "/api/client-billing/invoices/theirs-1/change-requests", { requestType: "void", reason: "billed twice" }, "createChangeRequest"],
    ["post", "/api/client-billing/change-requests/theirs-r/approve", {}, "decideChangeRequest"],
    ["post", "/api/client-billing/change-requests/theirs-r/decline", { note: "no" }, "decideChangeRequest"],
    ["post", "/api/client-billing/invoices/theirs-1/submit-to-client", { to: ["a@b.com"] }, "submitToClient"],
    ["post", "/api/client-billing/proformas", { costCentreId: "theirs-cc", financeYear: "2026-27", monthLabel: "Sep-26", invoiceDate: "2026-09-30" }, "createProforma"],
    ["post", "/api/client-billing/credit-notes", { invoiceId: "theirs-1", category: "x", financeYear: "2026-27", monthLabel: "Sep-26", creditDate: "2026-09-30" }, "createCreditNote"],
    ["post", "/api/client-billing/provisions", { costCentreId: "theirs-cc", financeYear: "2026-27", monthLabel: "Sep-26", amount: 5 }, "createProvision"],
    ["post", "/api/client-billing/credit-notes/theirs-cn/reject", { reason: "wrong amount" }, "rejectCreditNote"],
  ] as const)("%s %s -> 403 outside the caller's branch", async (method, url, body, fn) => {
    const res = await request(app)[method](url).send(body);
    expect(res.status).toBe(403);
    expect(m[fn]).not.toHaveBeenCalled();
  });

  it("in-branch callers pass through", async () => {
    m.createChangeRequest.mockResolvedValue({ id: "r" });
    const res = await request(app).post("/api/client-billing/invoices/mine-1/change-requests").send({ requestType: "void", reason: "billed twice" });
    expect(res.status).toBe(201);
  });

  it("provision upload passes the caller's branch scope to the service", async () => {
    m.uploadProvisions.mockResolvedValue([]);
    await request(app).post("/api/client-billing/provisions/upload").send({ rows: [] });
    expect(m.uploadProvisions).toHaveBeenCalledWith([], "u-1", ["b-1"]);
  });
});

describe("M3: reads are branch-scoped", () => {
  it.each([
    "/api/client-billing/proformas/theirs-1",
    "/api/client-billing/proformas/theirs-1/pdf",
    "/api/client-billing/invoices/theirs-1/pdf",
    "/api/client-billing/invoices/theirs-1/audit-log",
    "/api/client-billing/invoices/theirs-1/export",
    "/api/client-billing/credit-notes/theirs-cn",
    "/api/client-billing/change-requests/theirs-r",
  ])("GET %s -> 403", async (url) => {
    expect((await request(app).get(url)).status).toBe(403);
  });

  it("list, export, summary, filter options and change requests filter by the caller's branch", async () => {
    m.query.mockResolvedValue([[{ total: 0 }], []]);
    await request(app).get("/api/client-billing/proformas");
    expect(String(m.query.mock.calls[0][0])).toContain("cc.branch_id IN (?)");
    expect(m.query.mock.calls[0][1]).toContain("b-1");
    m.query.mockClear();
    await request(app).get("/api/client-billing/credit-notes/export");
    expect(m.query.mock.calls[0][1]).toEqual(["b-1"]);
    m.execute.mockClear();
    await request(app).get("/api/client-billing/summary");
    const summarySql = m.execute.mock.calls.map((c) => [String(c[0]), c[1]]);
    expect(summarySql.every(([sql, params]) => sql.includes("cc.branch_id IN (?)") && (params as unknown[]).includes("b-1"))).toBe(true);
    m.execute.mockClear();
    await request(app).get("/api/client-billing/filter-options");
    expect(m.execute.mock.calls[0][1]).toEqual(["b-1"]);
    m.query.mockClear();
    m.query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([[{ total: 0 }], []]);
    await request(app).get("/api/client-billing/change-requests");
    expect(String(m.query.mock.calls[1][0])).toContain("LEFT JOIN cost_centre_master cc");
    expect(m.query.mock.calls[1][1]).toEqual(["b-1"]);
  });

  it("a caller with no branch of their own sees nothing", async () => {
    policy.ownBranchId = null;
    await request(app).get("/api/client-billing/proformas");
    expect(String(m.query.mock.calls[0][0])).toContain("1 = 0");
  });

  it("audit-log rows carry actor e-mail and name", async () => {
    await request(app).get("/api/client-billing/invoices/mine-1/audit-log");
    const sql = String(m.execute.mock.calls.at(-1)![0]);
    expect(sql).toMatch(/AS actor_email/);
    expect(sql).toMatch(/AS actor_name/);
  });
});

describe("credit note reject route, receipts settings, PO approval routes", () => {
  it("POST /credit-notes/:id/reject needs a reason and calls the service", async () => {
    policy.orgWide = true;
    expect((await request(app).post("/api/client-billing/credit-notes/cn-1/reject").send({ reason: "no" })).status).toBe(400);
    m.rejectCreditNote.mockResolvedValue({ id: "cn-1", creditStatus: "rejected" });
    const res = await request(app).post("/api/client-billing/credit-notes/cn-1/reject").send({ reason: "duplicate of CN-7" });
    expect(res.status).toBe(200);
    expect(m.rejectCreditNote).toHaveBeenCalledWith({ creditNoteId: "cn-1", reason: "duplicate of CN-7", userId: "u-1" });
  });

  it("L2: GET /receipts/settings needs a billing role", async () => {
    expect((await request(app).get("/api/client-billing/receipts/settings").set("x-test-role", "employee")).status).toBe(403);
    expect((await request(app).get("/api/client-billing/receipts/settings")).status).toBe(200);
  });

  it("PO approve / reject are branch-checked and pass the caller", async () => {
    m.branchOf.mockResolvedValueOnce("b-2");
    expect((await request(app).post("/api/client-billing/po-master/po-1/approve").send({})).status).toBe(403);
    m.branchOf.mockResolvedValue("b-1");
    m.decidePo.mockResolvedValue({ id: "po-1", approvalStatus: "approved" });
    await request(app).post("/api/client-billing/po-master/po-1/approve").send({ note: "ok" });
    expect(m.decidePo).toHaveBeenCalledWith("po-1", "approve", "u-1", "ok");
    await request(app).post("/api/client-billing/po-master/po-1/reject").send({ reason: "wrong amount" });
    expect(m.decidePo).toHaveBeenLastCalledWith("po-1", "reject", "u-1", "wrong amount");
  });
});
