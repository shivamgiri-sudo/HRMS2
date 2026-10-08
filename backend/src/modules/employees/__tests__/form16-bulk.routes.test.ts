import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const m = vi.hoisted(() => ({
  roleOk: true,
  inScope: true,
  employees: [] as Array<Record<string, unknown>>,
  existing: false,
  registerUpload: vi.fn(),
  audit: vi.fn(),
  inserted: [] as unknown[][],
}));

vi.mock("fs", async (importOriginal) => {
  const a = await importOriginal<typeof import("fs")>();
  return { ...a, default: { ...a.default, mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn() } };
});
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM employees")) return [m.employees];
      if (sql.includes("FROM employee_documents")) return [m.existing ? [{ id: "d" }] : []];
      if (sql.includes("INSERT INTO employee_documents")) { m.inserted.push(params); return [{}]; }
      return [[]];
    }),
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_q: any, res: any, next: any) => (m.roleOk ? next() : res.status(403).json({ message: "denied" })),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee: vi.fn(async () => m.inScope) }));
vi.mock("../../../shared/syncPiiEncryption.js", () => ({ blindIndexPan: (p: string) => `bi:${p}` }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: (...a: unknown[]) => m.audit(...a) }));
vi.mock("../../document-vault/documentVault.service.js", () => ({ registerUpload: (...a: unknown[]) => m.registerUpload(...a) }));

const { form16BulkRouter } = await import("../form16-bulk.routes.js");
const app = express();
app.use((req: any, _r, next) => { req.authUser = { id: "hr1" }; next(); });
app.use("/f16", form16BulkRouter);

const pdf = Buffer.from("%PDF-1.7\nbody");
const send = (name: string, body = pdf, fields: Record<string, string> = { financial_year: "2025-26", mode: "preview" }) => {
  let r = request(app).post("/f16/bulk");
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach("files", body, name);
};
const one = { id: "e1", employee_code: "MAS1", full_name: "Asha Rao" };

beforeEach(() => {
  m.roleOk = true; m.inScope = true; m.employees = [one]; m.existing = false; m.inserted = [];
  m.registerUpload.mockReset().mockResolvedValue(undefined); m.audit.mockReset();
});

describe("POST /form16/bulk", () => {
  it("refuses non-issuer roles", async () => {
    m.roleOk = false;
    expect((await send("ABCDE1234F.pdf")).status).toBe(403);
  });
  it("validates financial year and mode", async () => {
    expect((await send("ABCDE1234F.pdf", pdf, { financial_year: "2025-99", mode: "preview" })).status).toBe(400);
    expect((await send("ABCDE1234F.pdf", pdf, { financial_year: "2025-26", mode: "delete" })).status).toBe(400);
  });
  it("preview matches by PAN and writes nothing", async () => {
    const r = await send("ABCDE1234F_2025-26.pdf");
    expect(r.status).toBe(200);
    expect(r.body.data.results[0]).toMatchObject({ outcome: "ready", employee_code: "MAS1", employee_name: "Asha Rao" });
    expect(m.registerUpload).not.toHaveBeenCalled();
    expect(m.inserted).toEqual([]);
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("classifies every kind of problem file", async () => {
    expect((await send("form16.pdf")).body.data.results[0].outcome).toBe("no_pan");
    expect((await send("ABCDE1234F.pdf", Buffer.from("<html>"))).body.data.results[0].outcome).toBe("not_pdf");
    m.employees = [];
    expect((await send("ABCDE1234F.pdf")).body.data.results[0].outcome).toBe("no_employee");
    m.employees = [one, { ...one, id: "e2" }];
    expect((await send("ABCDE1234F.pdf")).body.data.results[0].outcome).toBe("ambiguous");
    m.employees = [one]; m.existing = true;
    expect((await send("ABCDE1234F.pdf")).body.data.results[0].outcome).toBe("duplicate");
  });
  it("an employee outside the caller's branch is not matched and their name is not revealed", async () => {
    m.inScope = false;
    const row = (await send("ABCDE1234F.pdf")).body.data.results[0];
    expect(row.outcome).toBe("out_of_scope");
    expect(row.employee_name).toBeUndefined();
    expect(row.employee_code).toBeUndefined();
  });
  it("commit saves, registers the vault item for the owner, inserts a verified form_16 row and audits counts only", async () => {
    const r = await send("ABCDE1234F.pdf", pdf, { financial_year: "2025-26", mode: "commit" });
    expect(r.body.data.results[0].outcome).toBe("uploaded");
    expect(m.registerUpload).toHaveBeenCalledWith(expect.objectContaining({ category: "employee-documents", accessLevel: "pii", ownerEmployeeId: "e1" }));
    expect(m.inserted).toHaveLength(1);
    expect(m.inserted[0]).toEqual(expect.arrayContaining(["e1", "Form 16 FY 2025-26"]));
    const audit = m.audit.mock.calls[0][0];
    expect(audit.action_type).toBe("FORM16_BULK_UPLOAD");
    expect(JSON.stringify(audit.change_summary)).not.toMatch(/ABCDE|Asha|MAS1/);
  });
  it("a vault failure leaves no document row and reports failed", async () => {
    m.registerUpload.mockRejectedValue(new Error("vault down"));
    const r = await send("ABCDE1234F.pdf", pdf, { financial_year: "2025-26", mode: "commit" });
    expect(r.body.data.results[0].outcome).toBe("failed");
    expect(m.inserted).toEqual([]);
  });
});
