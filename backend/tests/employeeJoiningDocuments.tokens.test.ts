import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue([[], []]),
}));

vi.mock("../src/db/mysql.js", () => ({
  db: dbMock,
}));

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
import {
  getJoiningDocumentEsignStatus,
  getPublicJoiningDocumentEsignSession,
} from "../src/modules/employees/employeeJoiningDocuments.service.js";

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
        provider_url: "https://luckpay.example/esign",
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
    expect((status as Record<string, unknown>).public_token).toBeUndefined();
  });
});
