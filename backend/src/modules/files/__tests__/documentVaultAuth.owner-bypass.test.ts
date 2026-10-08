/**
 * authorizeDocumentAccess owner-bypass — id-space guard.
 *
 * owner_employee_id on a vault item is always an employees.id. The bypass used
 * to compare it against actorUserId, which is a users.id — a distinct id space
 * in this schema (employees.user_id is the FK between them) — so the "owner can
 * always see their own document" bypass could never actually fire for a real
 * employee; only their role (pii-level: hr/hr_admin/dpo/admin/super_admin/ceo)
 * could grant access, meaning a plain employee could never view/download their
 * own pii-classified document (e.g. their own PAN/Aadhaar scan) through this
 * route even though they own it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { findByStoredFilename, logDocumentAccess, isHoldActive, canViewEmployee, dbExecute } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  findByStoredFilename: vi.fn(),
  logDocumentAccess: vi.fn(),
  isHoldActive: vi.fn(),
  canViewEmployee: vi.fn(),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

vi.mock("../../document-vault/documentVault.service.js", () => ({
  findByStoredFilename,
  logDocumentAccess,
}));
vi.mock("../../privacy-engine/privacyHold.service.js", () => ({
  isHoldActive,
}));

const { authorizeDocumentAccess } = await import("../documentVaultAuth.js");

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

const PII_ITEM = {
  id: "vault-1",
  uploaded_by_user: "someone-else",
  category: "employee-documents",
  stored_filename: "abc.pdf",
  original_filename: "pan.pdf",
  mime_type: "application/pdf",
  file_size_bytes: 100,
  sha256_hash: null,
  access_level: "pii" as const,
  owner_employee_id: EMPLOYEE_ID,
  owner_candidate_id: null,
  is_soft_deleted: 0,
  created_at: new Date(),
};

describe("authorizeDocumentAccess owner bypass", () => {
  beforeEach(() => {
    findByStoredFilename.mockReset();
    logDocumentAccess.mockReset().mockResolvedValue(undefined);
    isHoldActive.mockReset().mockResolvedValue(null);
    canViewEmployee.mockReset().mockResolvedValue(true);
    dbExecute.mockReset().mockResolvedValue([[]]);
  });

  it("denies the owning employee when only actorUserId (not actorEmployeeId) is passed — the pre-fix shape", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);

    const result = await authorizeDocumentAccess({
      actorUserId: USER_ID,
      actorRole: "employee",
      storedFilename: "abc.pdf",
      action: "view",
    });

    // Without actorEmployeeId, the bypass cannot match, and "employee" is not
    // in the pii-level role allowlist — this pins the pre-fix failure mode so
    // a regression back to comparing actorUserId can't silently reappear.
    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("INSUFFICIENT_ROLE_FOR_ACCESS_LEVEL");
  });

  it("denies the owner their own uploaded employee-document (HR / payroll open it, not the employee)", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM); // category: "employee-documents"

    for (const action of ["view", "download"] as const) {
      const result = await authorizeDocumentAccess({
        actorUserId: USER_ID, actorEmployeeId: EMPLOYEE_ID, actorRole: "employee", storedFilename: "abc.pdf", action,
      });
      expect(`${action}: ${result.allowed} ${result.reasonCode}`).toBe(`${action}: false INSUFFICIENT_ROLE_FOR_ACCESS_LEVEL`);
    }
  });

  it("allows the owner to open their own tax paperwork (Form 16) even in the employee-documents category", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);
    dbExecute.mockResolvedValue([[{ doc_type: "form_16" }]]);
    const result = await authorizeDocumentAccess({
      actorUserId: USER_ID, actorEmployeeId: EMPLOYEE_ID, actorRole: "employee", storedFilename: "abc.pdf", action: "download",
    });
    expect(result.allowed).toBe(true);
  });

  it("a failed tax-file lookup never widens access (fails closed)", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);
    dbExecute.mockRejectedValue(new Error("db down"));
    const result = await authorizeDocumentAccess({
      actorUserId: USER_ID, actorEmployeeId: EMPLOYEE_ID, actorRole: "employee", storedFilename: "abc.pdf", action: "download",
    });
    expect(result.allowed).toBe(false);
  });

  it("allows the owning employee to view their own pii document in an owner-readable category once actorEmployeeId is supplied", async () => {
    findByStoredFilename.mockResolvedValue({ ...PII_ITEM, category: "payroll" });

    const result = await authorizeDocumentAccess({
      actorUserId: USER_ID,
      actorEmployeeId: EMPLOYEE_ID,
      actorRole: "employee",
      storedFilename: "abc.pdf",
      action: "view",
    });

    expect(result.allowed).toBe(true);
    expect(result.reasonCode).toBe("ALLOWED");
  });

  it("still denies a different employee's actorEmployeeId even for a pii document they don't own", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);

    const result = await authorizeDocumentAccess({
      actorUserId: USER_ID,
      actorEmployeeId: "99999999-9999-9999-9999-999999999999",
      actorRole: "employee",
      storedFilename: "abc.pdf",
      action: "view",
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("INSUFFICIENT_ROLE_FOR_ACCESS_LEVEL");
  });

  it("hr can still access a pii document they don't own when the owner is inside their branch", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);
    canViewEmployee.mockResolvedValue(true);

    const result = await authorizeDocumentAccess({
      actorUserId: "some-hr-user",
      actorRole: "hr",
      storedFilename: "abc.pdf",
      action: "download",
    });

    expect(result.allowed).toBe(true);
    expect(canViewEmployee).toHaveBeenCalledWith({ id: "some-hr-user" }, EMPLOYEE_ID);
  });

  it("hr is refused a pii or payroll document whose owner is in another branch (branch scoping)", async () => {
    canViewEmployee.mockResolvedValue(false);
    for (const level of ["pii", "payroll"] as const) {
      findByStoredFilename.mockResolvedValue({ ...PII_ITEM, access_level: level });
      const result = await authorizeDocumentAccess({
        actorUserId: "some-hr-user", actorRole: "hr", storedFilename: "abc.pdf", action: "view",
      });
      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toBe("OUTSIDE_BRANCH_SCOPE");
    }
  });

  it("admin is branch-scoped like hr (owner ruling: admin sees its own branch / assignments)", async () => {
    canViewEmployee.mockResolvedValue(false);
    findByStoredFilename.mockResolvedValue(PII_ITEM);
    const result = await authorizeDocumentAccess({ actorUserId: "u", actorRole: "admin", storedFilename: "abc.pdf", action: "view" });
    expect(result.reasonCode).toBe("OUTSIDE_BRANCH_SCOPE");
  });

  it("org-wide roles and the DPO are never branch-checked", async () => {
    canViewEmployee.mockResolvedValue(false);
    findByStoredFilename.mockResolvedValue(PII_ITEM);
    for (const role of ["super_admin", "ceo", "dpo"]) {
      const result = await authorizeDocumentAccess({
        actorUserId: "u", actorRole: role, storedFilename: "abc.pdf", action: "view",
      });
      expect(`${role}: ${result.allowed} ${result.reasonCode}`).toBe(`${role}: true ALLOWED`);
    }
    expect(canViewEmployee).not.toHaveBeenCalled();
  });

  it("admin is branch-checked like hr (no longer org-wide, owner ruling 2026-10-01)", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);
    canViewEmployee.mockResolvedValue(false);
    const refused = await authorizeDocumentAccess({
      actorUserId: "some-admin-user", actorRole: "admin", storedFilename: "abc.pdf", action: "view",
    });
    expect(refused.allowed).toBe(false);
    expect(refused.reasonCode).toBe("OUTSIDE_BRANCH_SCOPE");
    expect(canViewEmployee).toHaveBeenCalledWith({ id: "some-admin-user" }, EMPLOYEE_ID);
    canViewEmployee.mockResolvedValue(true);
    const allowed = await authorizeDocumentAccess({
      actorUserId: "some-admin-user", actorRole: "admin", storedFilename: "abc.pdf", action: "view",
    });
    expect(allowed.allowed).toBe(true);
  });

  it("a canViewEmployee failure fails closed", async () => {
    canViewEmployee.mockRejectedValue(new Error("db down"));
    findByStoredFilename.mockResolvedValue(PII_ITEM);
    const result = await authorizeDocumentAccess({
      actorUserId: "some-hr-user", actorRole: "hr", storedFilename: "abc.pdf", action: "view",
    });
    expect(result.allowed).toBe(false);
  });
});
