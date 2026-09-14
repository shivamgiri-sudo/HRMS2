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

const { findByStoredFilename, logDocumentAccess, isHoldActive } = vi.hoisted(() => ({
  findByStoredFilename: vi.fn(),
  logDocumentAccess: vi.fn(),
  isHoldActive: vi.fn(),
}));

vi.mock("../../document-vault/documentVault.service.js", () => ({ findByStoredFilename, logDocumentAccess }));
vi.mock("../../privacy-engine/privacyHold.service.js", () => ({ isHoldActive }));

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

  it("allows the owning employee to view their own pii document once actorEmployeeId is supplied", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);

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

  it("hr can still access a pii document they don't own, independent of the owner bypass", async () => {
    findByStoredFilename.mockResolvedValue(PII_ITEM);

    const result = await authorizeDocumentAccess({
      actorUserId: "some-hr-user",
      actorRole: "hr",
      storedFilename: "abc.pdf",
      action: "download",
    });

    expect(result.allowed).toBe(true);
  });
});
