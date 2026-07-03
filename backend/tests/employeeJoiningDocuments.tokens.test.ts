import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue([[], []]),
}));

const luckpayMocks = vi.hoisted(() => ({
  esignWithUrl: vi.fn(),
  generateClientTransactionId: vi.fn().mockReturnValue("joining-doc-test"),
  sanitizeProviderPayload: vi.fn((payload: unknown) => payload),
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    FRONTEND_URL: "http://localhost:8080",
    LUCKPAY_PROVIDER_ENABLED: true,
  },
}));

vi.mock("../src/db/mysql.js", () => ({
  db: dbMock,
}));

vi.mock("../src/modules/integrations/luckpay/luckpay.client.js", () => luckpayMocks);

vi.mock("../src/shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: "emp-1" }),
  hasRole: vi.fn().mockResolvedValue(true),
}));

vi.mock("../src/shared/scopeAccess.js", () => ({
  hasAnyRole: vi.fn().mockResolvedValue(true),
  hasScopedAccess: vi.fn().mockResolvedValue(true),
  getUserRoleKeys: vi.fn().mockResolvedValue(["admin"]),
}));

import { db } from "../src/db/mysql.js";
import { createJoiningDocumentEsignRequest, getJoiningDocumentEsignStatus, getPublicJoiningDocumentEsignSession } from "../src/modules/employees/employeeJoiningDocuments.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue([[], []]);
});

describe("joining document token handling", () => {
  it("looks up public signing links by token hash without selecting raw tokens", async () => {
    mockExecute.mockResolvedValueOnce([[{
      checklist_id: "check-1",
      employee_id: "emp-1",
      document_code: "EPF_DECLARATION",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      token_status: "active",
      document_name: "EPF Declaration",
      employee_code: "EMP001",
      employee_name: "Employee One",
      provider_url: "https://luckpay.example/esign",
      tx_status: "initiated",
    }], []]);

    const session = await getPublicJoiningDocumentEsignSession("token-123");

    const query = String(mockExecute.mock.calls[0]?.[0] ?? "");
    expect(query).toContain("public_token_hash = SHA2(?, 256)");
    expect(query).not.toContain("public_token = ?");
    expect((session as Record<string, unknown>).token).toBeUndefined();
    expect((session as Record<string, unknown>).public_token).toBeUndefined();
  });

  it("does not expose the raw public token in eSign status responses", async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: "emp-1",
        employee_code: "EMP001",
        full_name: "Employee One",
        official_email: null,
        mobile: null,
        branch_id: null,
        process_id: null,
        lob_id: null,
        department_id: null,
        reporting_manager_id: null,
        manager_id: null,
        date_of_joining: null,
        candidate_id: null,
        joining_document_status: null,
        joining_document_completion_pct: null,
      }], []])
      .mockResolvedValueOnce([[{
        id: "check-1",
        employee_id: "emp-1",
        candidate_id: null,
        document_code: "EPF_DECLARATION",
        document_name: "EPF Declaration",
        status: "pending",
        action_type: "esign",
        owner_type: "candidate",
        template_version: "v1",
      }], []])
      .mockResolvedValueOnce([[{
        id: "tx-1",
        provider: "luckpay",
        status: "initiated",
        provider_reference_id: "ref-1",
        provider_url: "http://localhost:8080/api/public/employee-documents/esign/token-123",
        error_message: null,
        initiated_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
        token_status: "active",
        expires_at: "2026-01-08T00:00:00.000Z",
      }], []]);

    const status = await getJoiningDocumentEsignStatus({
      employeeId: "emp-1",
      checklistId: "check-1",
      actorUserId: "user-1",
    });

    expect(status.public_token_status).toBe("active");
    expect(status.public_token_expires_at).toBe("2026-01-08T00:00:00.000Z");
    expect(status.publicTokenIssued).toBe(true);
    expect(status.transaction?.provider_url).toBeNull();
    expect((status as Record<string, unknown>).public_token).toBeUndefined();
  });

  it("stores only the external provider url and redacted payload when creating eSign requests", async () => {
    luckpayMocks.esignWithUrl.mockResolvedValueOnce({
      providerReferenceId: "ref-123",
      providerUrl: "https://luckpay.example/esign",
      status: "initiated",
      response: {
        signLink: "http://localhost:8080/api/public/employee-documents/esign/token-123",
        message: "ok",
      },
    });

    const checklistRow = {
      id: "check-1",
      employee_id: "emp-1",
      candidate_id: null,
      document_code: "EPF_DECLARATION",
      document_name: "EPF Declaration",
      status: "pending",
      action_type: "esign",
      owner_type: "candidate",
      template_version: "v1",
    };

    mockExecute.mockImplementation(async (sql: string) => {
      const query = String(sql);
      if (query.includes("FROM employees e")) {
        return [[{
          id: "emp-1",
          employee_code: "EMP001",
          full_name: "Employee One",
          official_email: "employee@example.com",
          mobile: "9999999999",
          branch_id: null,
          process_id: null,
          lob_id: null,
          department_id: null,
          reporting_manager_id: null,
          manager_id: null,
          date_of_joining: null,
          candidate_id: null,
          joining_document_status: null,
          joining_document_completion_pct: null,
        }], []];
      }
      if (query.includes("FROM employee_joining_document_checklist\n      WHERE id = ?")) {
        return [[checklistRow], []];
      }
      if (query.includes("FROM employee_joining_document_file\n      WHERE checklist_id = ?\n        AND file_role IN ('generated', 'signed')")) {
        return [[{
          id: "file-1",
          checklist_id: "check-1",
          original_filename: "epf.pdf",
          file_role: "generated",
          mime_type: "application/pdf",
          storage_path: path.resolve(process.cwd(), "package.json"),
        }], []];
      }
      if (query.includes("INSERT INTO employee_document_esign_transaction")) {
        return [[], []];
      }
      if (query.includes("UPDATE employee_joining_document_checklist")) {
        return [[], []];
      }
      if (query.includes("INSERT INTO employee_joining_document_audit_log")) {
        return [[], []];
      }
      if (query.includes("SELECT\n        COUNT(*) AS total_count")) {
        return [[{
          total_count: 1,
          mandatory_count: 1,
          mandatory_completed: 0,
          completed_count: 0,
        }], []];
      }
      if (query.includes("UPDATE employees")) {
        return [[], []];
      }
      if (query.includes("UPDATE ats_onboarding_bridge")) {
        return [[], []];
      }
      if (query.includes("SELECT id, document_code, document_name, template_version, requires_candidate_esign, requires_hr_upload, is_mandatory")) {
        return [[], []];
      }
      if (query.includes("SELECT document_code FROM employee_joining_document_checklist WHERE employee_id = ?")) {
        return [[], []];
      }
      if (query.includes("FROM employee_joining_document_checklist c")) {
        return [[
          {
            id: "check-1",
            document_code: "EPF_DECLARATION",
            document_name: "EPF Declaration",
            owner_type: "candidate",
            action_type: "esign",
            status: "esign_initiated",
            mandatory: 1,
            template_version: "v1",
            verification_status: null,
            verification_remarks: null,
            due_at: null,
            completed_at: null,
            latest_file_id: "file-1",
            latest_file_name: "epf.pdf",
            latest_file_role: "generated",
            latest_file_mime: "application/pdf",
            latest_esign_status: "initiated",
            latest_esign_url: "https://luckpay.example/esign",
            public_token_status: "active",
            public_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
            publicTokenIssued: 1,
            analysis_result_json: null,
          },
        ], []];
      }
      if (query.includes("FROM employee_joining_document_audit_log")) {
        return [[], []];
      }
      return [[], []];
    });

    const result = await createJoiningDocumentEsignRequest({
      employeeId: "emp-1",
      checklistId: "check-1",
      actorUserId: "user-1",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    const insert = mockExecute.mock.calls.find((call) => String(call[0]).includes("INSERT INTO employee_document_esign_transaction"));
    expect(insert).toBeDefined();
    expect(insert?.[1]?.[13]).toBe("https://luckpay.example/esign");
    expect(String(insert?.[1]?.[14] ?? "")).not.toContain("http://localhost:8080/api/public/employee-documents/esign/");
    expect(String(insert?.[1]?.[14] ?? "")).toContain("internalLinkIssued");
    expect(String(insert?.[1]?.[14] ?? "")).toContain("publicTokenHash");
    expect(result.provider_url).toBe("https://luckpay.example/esign");
    expect(result.sign_link).toContain("/employee/epf-compliance/review/");
  });
});
