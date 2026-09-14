import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

/**
 * Regression test for the final-whole-branch-review CRITICAL finding:
 *
 * `attritionDeepDive` reads `filters.dimension` and silently defaults to "source" whenever
 * it is missing -- and report-suite.routes.ts's default-branch ExecFilters object (built
 * from req.query) did NOT include `dimension` in its whitelist. So over a real HTTP request
 * the "Slice by" dropdown never worked: every request landed on the Source-of-Hire grouping
 * regardless of what the caller asked for, and dimension_id was always NULL.
 *
 * This is deliberately exercised over the REAL Express route (reportSuiteRouter mounted in
 * a real app, hit with supertest) rather than by calling attritionDeepDive() directly --
 * calling the executor directly is exactly how this bug hid from every earlier per-task
 * review. Only db access and auth/scope resolution are mocked; the query-string parsing,
 * the ExecFilters whitelist, executeReport() dispatch, and attritionDeepDive's own dimension
 * resolution all run for real.
 */

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
import { db } from "../../../db/mysql.js";
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "u1", role: "super_admin", roles: ["super_admin"] };
    next();
  },
}));

// Bypass real scope resolution (which would otherwise require sequencing many db.execute
// calls in the exact order resolveBranchScope/resolveFullScope issue them) and grant
// unrestricted super_admin scope on every dimension -- the point of this test is proving
// `dimension` reaches the executor, not re-testing scope resolution itself.
vi.mock("../reporting.scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../reporting.scope.js")>();
  const allDim = { mode: "all" as const, ids: [] as string[] };
  return {
    ...actual,
    resolveBranchScope: vi.fn(async () => ({ isSuperAdmin: true, branchIds: [] })),
    resolveFullScope: vi.fn(async () => ({
      companyId: "company-1",
      isSuperAdmin: true,
      branchScope: allDim,
      processScope: allDim,
      departmentScope: allDim,
      costCentreScope: allDim,
      canViewAllEmployees: true,
      canViewSensitiveFields: true,
      canExportSensitiveReports: true,
      roles: ["super_admin"],
    })),
  };
});

import { reportSuiteRouter } from "../report-suite.routes.js";

const app = express();
app.use(express.json());
app.use("/api/reports/suite", reportSuiteRouter);

describe("GET /api/reports/suite/attrition-deep-dive -- dimension query param over real HTTP route", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("threads ?dimension=reporting_manager through to the executor's SQL and response", async () => {
    // attritionDeepDive's single query() call (fetchPageWithTotal's probe run) -- one row
    // whose `dimension`/`dimension_id` reflect what a real reporting_manager-dimension query
    // would return, proving the executor actually grouped by manager and not "source".
    mockExecute.mockResolvedValueOnce([[
      {
        dimension: "reporting_manager",
        dimension_label: "Reporting Manager",
        dimension_value: "KAMAL SINGH",
        dimension_id: "11111111-1111-1111-1111-111111111111",
        aon_bucket: "0-30",
        exits: 46,
        avg_tenure_days: 21.4,
        share_pct: 100,
        early_quit_rate: 100,
        reason_captured_pct: 50,
      },
    ], []]);

    const res = await request(app)
      .get("/api/reports/suite/attrition-deep-dive")
      .query({ dimension: "reporting_manager", from: "2026-01-01", to: "2026-08-25" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].dimension).toBe("reporting_manager");
    expect(res.body.data[0].dimension_id).toBe("11111111-1111-1111-1111-111111111111");

    // The SQL actually sent to the DB must carry the reporting_manager grouping expression,
    // not the "source" default -- confirms the query string value drove the executor's own
    // dimension resolution, not just the response shape.
    const [sentSql] = mockExecute.mock.calls[0];
    expect(sentSql).toMatch(/'reporting_manager' AS dimension/);
    expect(sentSql).toMatch(/mgr\.id AS dimension_id/);
  });

  it("falls back to 'source' when dimension is omitted (baseline, unchanged behaviour)", async () => {
    mockExecute.mockResolvedValueOnce([[
      {
        dimension: "source",
        dimension_label: "Source of Hire",
        dimension_value: "Referral",
        dimension_id: null,
        aon_bucket: "0-30",
        exits: 5,
        avg_tenure_days: 10,
        share_pct: 100,
        early_quit_rate: 100,
        reason_captured_pct: 0,
      },
    ], []]);

    const res = await request(app)
      .get("/api/reports/suite/attrition-deep-dive")
      .query({ from: "2026-01-01", to: "2026-08-25" });

    expect(res.status).toBe(200);
    expect(res.body.data[0].dimension).toBe("source");
  });
});
