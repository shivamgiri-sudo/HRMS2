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
});
