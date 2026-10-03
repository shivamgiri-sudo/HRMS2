import { describe, it, expect, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), getConnection: vi.fn() } }));
vi.mock("../../document-vault/documentVault.service.js", () => ({ registerUpload: vi.fn() }));

const { withoutFileUrl } = await import("../employee.documents.routes.js");
const { mayDownloadJoiningDocuments } = await import("../employeeJoiningDocuments.service.js");

describe("employee document lockdown", () => {
  it("withoutFileUrl keeps status fields and nulls only the file url", () => {
    const row = { id: "d1", document_type: "pan", document_name: "PAN", file_url: "/api/files/employee-documents/x.pdf", verified: 0 };
    expect(withoutFileUrl(row)).toEqual({ id: "d1", document_type: "pan", document_name: "PAN", file_url: null, verified: 0 });
  });

  it("joining documents: HR / payroll / admin may download, a plain employee (the owner) may not", () => {
    expect(mayDownloadJoiningDocuments({ isAdmin: false, roles: ["employee"] })).toBe(false);
    expect(mayDownloadJoiningDocuments({ isAdmin: false, roles: [] })).toBe(false);
    for (const role of ["hr", "payroll_hr", "payroll", "manager", "admin", "super_admin"]) {
      expect(mayDownloadJoiningDocuments({ isAdmin: false, roles: ["employee", role] })).toBe(true);
    }
    expect(mayDownloadJoiningDocuments({ isAdmin: true, roles: [] })).toBe(true);
  });

  it("a manager opens their team's files but not their own (no owner bypass via the manager role)", () => {
    expect(mayDownloadJoiningDocuments({ isAdmin: false, isSelf: false, roles: ["employee", "manager"] })).toBe(true);
    expect(mayDownloadJoiningDocuments({ isAdmin: false, isSelf: true, roles: ["employee", "manager"] })).toBe(false);
    // HR / payroll keep access to their own record's files
    expect(mayDownloadJoiningDocuments({ isAdmin: false, isSelf: true, roles: ["employee", "hr"] })).toBe(true);
  });
});

describe("tax paperwork stays with the owner", async () => {
  const { isOwnerReadableDocType, isSelfServiceDocType } = await import("../employee-document-category.js");
  it("Form 16 / tax certificate / investment proof / declaration are owner-readable; KYC and contracts are not", () => {
    for (const t of ["form_16", "Form_16", "tax_certificate", "investment_proof", "declaration_form"]) expect(isOwnerReadableDocType(t)).toBe(true);
    for (const t of ["contract", "pan_card", "aadhaar", "offer_letter", "other", ""]) expect(isOwnerReadableDocType(t)).toBe(false);
  });
  it("an employee may self-upload investment proofs and declarations, not Form 16", () => {
    expect(isSelfServiceDocType("investment_proof")).toBe(true);
    expect(isSelfServiceDocType("declaration_form")).toBe(true);
    expect(isSelfServiceDocType("form_16")).toBe(false);
    expect(isSelfServiceDocType("pan_card")).toBe(true);
    expect(isSelfServiceDocType("contract")).toBe(false);
  });
});
