import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/payroll/recalculation-queue previously returned only the current page's `data` and a
 * `total` count. The frontend (RecalculationQueue.tsx) derived its "Pending/Processing/Failed/
 * Completed" KPI tiles via items.filter(...) over just that page (default 50 of 21,963+ rows), so
 * "Failed" could read 0/green while thousands of failed rows sat on other pages.
 *
 * Fix adds a second, GROUP BY query — `statusCounts` — scoped only by the payrollMonth filter,
 * never by the status filter (so it reflects the full breakdown regardless of which status the
 * user is currently looking at), independent of pagination.
 *
 * Mounts the router directly (form16-data-more-routes.access.test.ts's pattern).
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(), getEmployeeForUser: vi.fn() }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasScopedAccess: vi.fn() }));
vi.mock("../payroll-targeted-recalculation.service.js", () => ({ recalculateOpenPayrollForEmployee: vi.fn() }));
vi.mock("../payslip.service.js", () => ({ payslipService: {} }));
vi.mock("../../../shared/piiCiphertext.js", () => ({ resolvePii: vi.fn() }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: "user-1" };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { payrollMoreRouter } from "../payroll-more.routes.js";

function buildApp() {
  const app = express();
  app.use("/api/payroll", payrollMoreRouter);
  return app;
}

describe("GET /api/payroll/recalculation-queue statusCounts", () => {
  beforeEach(() => execute.mockReset());

  it("returns a status breakdown alongside the paginated page", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "q1", status: "failed" }]]) // paginated rows
      .mockResolvedValueOnce([[{ total: 21963 }]]) // total count
      .mockResolvedValueOnce([[ // GROUP BY status
        { status: "pending", c: 500 },
        { status: "failed", c: 1021 },
        { status: "completed", c: 20000 },
        { status: "processing", c: 442 },
      ]]);

    const res = await request(buildApp()).get("/api/payroll/recalculation-queue");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(21963);
    expect(res.body.statusCounts).toEqual({ pending: 500, failed: 1021, completed: 20000, processing: 442 });
  });

  it("scopes statusCounts by payrollMonth but never by the status filter itself", async () => {
    execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[{ status: "failed", c: 3 }]]);

    await request(buildApp()).get("/api/payroll/recalculation-queue?status=pending&payrollMonth=2026-07");

    const statusCountsCall = execute.mock.calls[2];
    expect(statusCountsCall[0]).toMatch(/GROUP BY rq\.status/);
    expect(statusCountsCall[0]).toMatch(/payroll_month/);
    expect(statusCountsCall[0]).not.toMatch(/rq\.status = \?/);
    expect(statusCountsCall[1]).toEqual(["2026-07"]);
  });
});
