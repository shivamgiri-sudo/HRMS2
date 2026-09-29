import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /records (the payroll grid) ran its page query and its COUNT query one after the other; both
 * are heavy (window function over the filtered lines) and independent, so they are issued together.
 * Response shape and the parameter lists are unchanged.
 */
const { execute, buildScopeWhereClause } = vi.hoisted(() => ({ execute: vi.fn(), buildScopeWhereClause: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ buildScopeWhereClause }));
vi.mock("../payroll.controller.js", () => ({ payrollController: new Proxy({}, { get: () => vi.fn() }) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _r: express.Response, n: express.NextFunction) => {
    (req as any).authUser = { id: "u1" }; n();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, n: any) => n() }));

import { payrollSecureRouter } from "../payroll.secure.routes.js";

const app = express();
app.use("/api/payroll", payrollSecureRouter);

let inFlight = 0;
let maxInFlight = 0;
beforeEach(() => {
  inFlight = 0; maxInFlight = 0;
  execute.mockReset();
  buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
  execute.mockImplementation(async (sql: string) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return /COUNT\(\*\) AS total/.test(sql) ? [[{ total: 7 }], []] : [[{ id: "l1" }], []];
  });
});

describe("GET /api/payroll/records", () => {
  it("issues page and count together and returns the same envelope", async () => {
    const res = await request(app).get("/api/payroll/records?runMonth=2026-08&page=2&limit=10");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [{ id: "l1" }], total: 7, page: 2, limit: 10 });
    expect(maxInFlight).toBe(2);
    expect(execute.mock.calls[0][1]).toEqual(execute.mock.calls[1][1]);
    expect(String(execute.mock.calls[0][0])).toMatch(/LIMIT 10 OFFSET 10/);
  });
});
