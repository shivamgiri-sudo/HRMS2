import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../src/db/mysql.js";
import { hashIdentifier } from "../src/modules/employees/employeeCompliancePrivacy.js";

const employeeJoiningDocumentsServiceMocks = vi.hoisted(() => ({
  createJoiningDocumentEsignRequest: vi.fn(),
  createPublicTokenForEpfReview: vi.fn(),
  deleteJoiningDocumentFile: vi.fn(),
  generateJoiningDocumentChecklist: vi.fn(),
  getChecklistDocumentFileForAccess: vi.fn(),
  getJoiningDocumentFileForAccess: vi.fn(),
  getJoiningDocumentEsignStatus: vi.fn(),
  getPublicJoiningDocumentDraftFile: vi.fn(),
  getJoiningDocumentPack: vi.fn(),
  getPublicJoiningDocumentEsignSession: vi.fn(),
  handleJoiningDocumentEsignWebhook: vi.fn(),
  listJoiningDocumentTemplates: vi.fn(),
  resolveEmployeeDocumentAccessContext: vi.fn(),
  reviewJoiningDocument: vi.fn(),
  updateJoiningDocumentChecklistStatus: vi.fn(),
  upsertJoiningDocumentTemplate: vi.fn(),
  uploadJoiningDocument: vi.fn(),
}));

const universalFormFillMocks = vi.hoisted(() => ({
  employeeReviewChecklistByToken: vi.fn(),
  generateChecklistDraft: vi.fn(),
  getChecklistFieldReview: vi.fn(),
  listTemplateFieldMaps: vi.fn(),
  manualFillChecklistValues: vi.fn(),
  replaceTemplateFieldMaps: vi.fn(),
  synchronizeChecklistFieldValues: vi.fn(),
}));

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
  },
}));

vi.mock("../src/middleware/authMiddleware.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../src/shared/scopeAccess.js", () => ({
  buildScopeWhereClause: vi.fn().mockResolvedValue({ sql: "1=1", params: [] }),
  hasAnyRole: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/modules/employees/employeeJoiningDocuments.service.js", () => employeeJoiningDocumentsServiceMocks);

vi.mock("../src/modules/employees/universalDigitalFormFill.service.js", () => universalFormFillMocks);

vi.mock("../src/modules/employees/epfComplianceValidation.service.js", () => ({
  validateEpfCompliance: vi.fn(),
}));

// config/env.ts loads backend/.env with dotenv override:true, so a value set
// here — even hoisted — is overwritten by whatever the machine has configured.
// Assert against the resolved secret instead of a literal, so the test verifies
// the auth mechanism rather than one environment's value.
process.env.LUCKPAY_WEBHOOK_SECRET = process.env.LUCKPAY_WEBHOOK_SECRET || "shared-secret";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

/** The secret the app actually resolved, whatever the environment supplied. */
let resolvedWebhookSecret = "shared-secret";

let publicEmployeeDocumentRouter: Awaited<typeof import("../src/modules/employees/employee.compliance.routes.js")>["publicEmployeeDocumentRouter"];

beforeAll(async () => {
  const mod = await import("../src/modules/employees/employee.compliance.routes.js");
  publicEmployeeDocumentRouter = mod.publicEmployeeDocumentRouter;
  const { env } = await import("../src/config/env.js");
  resolvedWebhookSecret = env.LUCKPAY_WEBHOOK_SECRET ?? "shared-secret";
});

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([[], []]);
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/public/employee-documents", publicEmployeeDocumentRouter);
  return app;
}

describe("public employee document eSign routes", () => {
  it("rejects Luckpay webhook requests without the shared secret", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/public/employee-documents/esign/webhook/luckpay")
      .send({ provider_reference_id: "ref-1" });

    expect(res.status).toBe(401);
    expect(employeeJoiningDocumentsServiceMocks.handleJoiningDocumentEsignWebhook).not.toHaveBeenCalled();
  });

  it("accepts Luckpay webhook requests with the shared secret", async () => {
    employeeJoiningDocumentsServiceMocks.handleJoiningDocumentEsignWebhook.mockResolvedValueOnce({ matched: true, processed: true });
    const app = buildApp();

    const res = await request(app)
      .post("/api/public/employee-documents/esign/webhook/luckpay")
      .set("X-HRMS-Webhook-Secret", resolvedWebhookSecret)
      .send({ provider_reference_id: "ref-1" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ matched: true, processed: true });
    // The handler's contract is { payload, ipAddress, userAgent }. This route
    // used to pass req.body straight through, leaving payload undefined so the
    // handler matched nothing and returned 200 with matched:false — the
    // assertion below previously encoded that bug.
    expect(employeeJoiningDocumentsServiceMocks.handleJoiningDocumentEsignWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { provider_reference_id: "ref-1" } }),
    );
  });

  it("rejects the employee-scoped Luckpay webhook without the shared secret", async () => {
    // This route is declared before requireAuth so the provider can reach it,
    // and it had no secret check at all. Anyone able to guess a
    // provider_reference_id could drive it to esign_completed with
    // signature_mode 'aadhaar_esign_verified' and lock the file.
    const mod = await import("../src/modules/employees/employee.compliance.routes.js");
    const app = express();
    app.use(express.json());
    app.use("/api/employees", mod.employeeJoiningDocumentsRouter);

    const res = await request(app)
      .post("/api/employees/emp-1/joining-documents/esign/webhook/luckpay")
      .send({ provider_reference_id: "ref-1" });

    expect(res.status).toBe(401);
    expect(employeeJoiningDocumentsServiceMocks.handleJoiningDocumentEsignWebhook).not.toHaveBeenCalled();
  });

  it("accepts the employee-scoped Luckpay webhook with the shared secret", async () => {
    employeeJoiningDocumentsServiceMocks.handleJoiningDocumentEsignWebhook.mockResolvedValueOnce({ matched: true, processed: true });
    const mod = await import("../src/modules/employees/employee.compliance.routes.js");
    const app = express();
    app.use(express.json());
    app.use("/api/employees", mod.employeeJoiningDocumentsRouter);

    const res = await request(app)
      .post("/api/employees/emp-1/joining-documents/esign/webhook/luckpay")
      .set("X-HRMS-Webhook-Secret", resolvedWebhookSecret)
      .send({ provider_reference_id: "ref-1" });

    expect(res.status).toBe(200);
    expect(employeeJoiningDocumentsServiceMocks.handleJoiningDocumentEsignWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { provider_reference_id: "ref-1" } }),
    );
  });

  it("returns provider details for the public eSign start route", async () => {
    employeeJoiningDocumentsServiceMocks.getPublicJoiningDocumentEsignSession.mockResolvedValueOnce({
      token: "token-1",
      checklist_id: "check-1",
      employee_id: "emp-1",
      document_code: "EPF_DECLARATION",
      document_name: "EPF Declaration",
      employee_name: "Employee One",
      employee_code: "EMP001",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      token_status: "active",
      provider_url: "https://luckpay.example/esign",
      tx_status: "initiated",
    });

    const app = buildApp();
    const res = await request(app).post("/api/public/employee-documents/esign/token-1/start").send({ action: "esign" });

    expect(res.status).toBe(200);
    expect(res.body.data.provider_url).toBe("https://luckpay.example/esign");
    expect(res.body.data.tx_status).toBe("initiated");
  });

  it("stores hashed EPF consent tokens instead of raw tokens", async () => {
    employeeJoiningDocumentsServiceMocks.getPublicJoiningDocumentEsignSession.mockResolvedValueOnce({
      checklist_id: "check-1",
      employee_id: "emp-1",
      document_code: "EPF_DECLARATION",
      document_name: "EPF Declaration",
      employee_name: "Employee One",
      employee_code: "EMP001",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      token_status: "active",
      provider_url: null,
      tx_status: null,
    });
    universalFormFillMocks.employeeReviewChecklistByToken.mockResolvedValueOnce({ success: true });

    const app = buildApp();
    const token = "review-token-123";

    const res = await request(app)
      .post(`/api/public/employee-documents/esign/${token}`)
      .send({ action: "confirm", record_epf_consent: true, actor_name: "Test Employee" });

    expect(res.status).toBe(200);
    const consentInsert = mockExecute.mock.calls.find((call) => String(call[0]).includes("INSERT INTO employee_epf_consent_receipt"));
    expect(consentInsert).toBeDefined();
    expect(consentInsert?.[1]?.[0]).toBe(hashIdentifier(token));
    expect(consentInsert?.[1]?.[0]).not.toBe(token);
  });
});
