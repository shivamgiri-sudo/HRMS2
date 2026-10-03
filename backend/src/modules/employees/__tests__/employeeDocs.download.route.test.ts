import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const m = vi.hoisted(() => ({ roles: [] as string[], inScope: true, rows: [] as unknown[] }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [m.rows]), getConnection: vi.fn() } }));
vi.mock("../../document-vault/documentVault.service.js", () => ({ registerUpload: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _r: any, next: any) => { req.authUser = { id: "u1", roles: m.roles }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...allowed: string[]) => (_q: any, res: any, next: any) =>
    m.roles.some((r) => allowed.includes(r)) ? next() : res.status(403).json({ message: "Access denied" }),
}));
vi.mock("../employeeScopeGuard.js", () => ({
  guardEmployeeScope: () => (_q: any, res: any, next: any) => (m.inScope ? next() : res.status(403).json({ message: "out of scope" })),
}));
vi.mock("../../../shared/accessGuard.js", () => ({
  selfOrAdminHr: () => (_q: any, _r: any, next: any) => next(),
  hasRole: vi.fn(async (_u: string, ...r: string[]) => m.roles.some((x) => r.includes(x))),
}));

const { employeeDocsRouter } = await import("../employee.documents.routes.js");
const app = express();
app.use("/api/employee-docs", employeeDocsRouter);

beforeEach(() => { m.roles = []; m.inScope = true; m.rows = []; });

describe("GET /api/employee-docs/:employeeId/:docId/download", () => {
  const url = "/api/employee-docs/e1/d1/download";
  it("is a real route: a plain employee is refused with 403, not 404", async () => {
    m.roles = ["employee"];
    expect((await request(app).get(url)).status).toBe(403);
  });
  it("a manager (not an HR / payroll role) is refused too", async () => {
    m.roles = ["manager"];
    expect((await request(app).get(url)).status).toBe(403);
  });
  it("HR outside its branch is refused", async () => {
    m.roles = ["hr"]; m.inScope = false;
    expect((await request(app).get(url)).status).toBe(403);
  });
  it("a document registered without a stored file answers 404 'No file is stored', not a routing error", async () => {
    m.roles = ["hr"]; m.rows = [{ doc_name: "Contract Form", file_url: null }];
    const r = await request(app).get(url);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe("No file is stored for this document");
  });
  it("HR inside scope reaches the handler (document lookup 404 for an unknown id)", async () => {
    m.roles = ["hr"];
    const r = await request(app).get(url);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe("Document not found");
  });
});
