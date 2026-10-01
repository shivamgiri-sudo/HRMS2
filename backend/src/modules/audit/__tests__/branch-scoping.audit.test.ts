import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Audit log: hr / wfm only see rows about employees inside their branch; admin and payroll_head are unchanged. */
const { execute, hasAnyRole, resolveScope, buildCond } = vi.hoisted(() => ({
  execute: vi.fn(), hasAnyRole: vi.fn(), resolveScope: vi.fn(async () => ({})), buildCond: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasAnyRole }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ resolveUserBusinessScope: resolveScope, buildEmployeeScopeCondition: buildCond }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));

import { auditLogRouter } from "../audit.log.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/audit", auditLogRouter); return a; };
const roles = (...r: string[]) => hasAnyRole.mockImplementation(async (_id: string, ...want: string[]) => want.some((w) => r.includes(w)));
const listCall = () => execute.mock.calls.find((c) => /FROM sensitive_action_log sal\s+LEFT JOIN/.test(String(c[0])))!;

beforeEach(() => {
  execute.mockReset(); hasAnyRole.mockReset(); buildCond.mockReset();
  execute.mockImplementation(async (sql: string) => /COUNT/.test(String(sql)) ? [[{ total: 0 }], []] : [[], []]);
  buildCond.mockReturnValue({ sql: "e.branch_id = ?", params: ["b1"] });
});

describe("GET /api/audit/log", () => {
  it("hr rows are restricted to employees of the caller's branch (param order preserved)", async () => {
    roles("hr");
    await request(app()).get("/api/audit/log?fromDate=2026-09-01");
    const c = listCall();
    expect(String(c[0])).toMatch(/sal\.employee_id IN \(SELECT e\.id FROM employees e WHERE e\.branch_id = \?\)/);
    expect(c[1]).toEqual(["b1", "2026-09-01"]);
  });
  it("hr who also holds an org-wide role (1=1) gets no extra predicate", async () => {
    roles("hr");
    buildCond.mockReturnValue({ sql: "1=1", params: [] });
    await request(app()).get("/api/audit/log");
    expect(String(listCall()[0])).not.toMatch(/employees e/);
  });
  it("admin is unrestricted and never builds a scope", async () => {
    roles("admin");
    await request(app()).get("/api/audit/log");
    expect(String(listCall()[0])).not.toMatch(/employees e/);
    expect(buildCond).not.toHaveBeenCalled();
  });
  it("payroll_head keeps the module filter only", async () => {
    roles("payroll_head");
    await request(app()).get("/api/audit/log");
    expect(String(listCall()[0])).not.toMatch(/employees e/);
  });
});
