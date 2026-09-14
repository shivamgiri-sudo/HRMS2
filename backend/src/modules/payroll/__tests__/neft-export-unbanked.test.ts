import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The NEFT file must not contain an employee who cannot be paid by NEFT.
 *
 * Every payroll line was emitted, with the literal "NOT_LINKED" standing in for the
 * IFSC and account number when an employee had no bank record — and their net pay
 * was still added to the TOTAL. So the file declared a disbursement total the bank
 * could not pay out, and the unpayable rows were positionally identical to real
 * ones for anything consuming the CSV by column.
 *
 * They are now excluded from the payment rows and reported below the TOTAL.
 * Excluding them silently would be its own defect — someone missing bank details
 * would simply vanish from payroll with nothing to say so. The sibling exporter in
 * disbursal.routes.ts drops them with an INNER JOIN and reports nothing, which is
 * why the two exporters disagreed about who was payable for the same run.
 */

const RUN_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AUTH_USER_ID = "33333333-3333-3333-3333-333333333333";

const { execute, hasOrgWideScope, hasAnyRole, getUserAssignmentScopes, buildScopeWhereClause } = vi.hoisted(() => ({
  execute: vi.fn(),
  hasOrgWideScope: vi.fn(),
  // Fixed 2026-08-17 (Section M RBAC audit): /neft-export now gates on a local
  // hasExportScope() built from these two primitives instead of the raw hasOrgWideScope —
  // see bank-export-gating.contract.test.ts and payroll-bulk-export-scope.test.ts.
  hasAnyRole: vi.fn(),
  getUserAssignmentScopes: vi.fn(),
  buildScopeWhereClause: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({ hasOrgWideScope, hasAnyRole, getUserAssignmentScopes, buildScopeWhereClause }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: vi.fn(), getEmployeeForUser: vi.fn() }));
vi.mock("../../../config/env.js", () => ({ env: { PAYROLL_BANK_KEY: "test-bank-key" } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string } }).authUser = { id: AUTH_USER_ID };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { payrollExtendedRouter } from "../payroll-extended.routes.js";

function buildApp() {
  const app = express();
  app.use("/api/payroll", payrollExtendedRouter);
  return app;
}

const RUN_ROW: [Array<Record<string, unknown>>] = [[{ id: RUN_ID, run_month: "2026-07", status: "FINALIZED" }]];

/** Two payable employees and two who cannot be paid. */
const LINES: [Array<Record<string, unknown>>] = [[
  { employee_id: "e1", net_salary: 25000, employee_code: "MAS001", full_name: "Paid One",
    bank_name: "HDFC", ifsc_code: "HDFC0001", account_number: "1234567890" },
  { employee_id: "e2", net_salary: 18000, employee_code: "MAS002", full_name: "No Account",
    bank_name: "HDFC", ifsc_code: "HDFC0002", account_number: null },
  { employee_id: "e3", net_salary: 12000, employee_code: "MAS003", full_name: "No Ifsc",
    bank_name: null, ifsc_code: null, account_number: null },
  { employee_id: "e4", net_salary: 30000, employee_code: "MAS004", full_name: "Paid Two",
    bank_name: "ICICI", ifsc_code: "ICIC0004", account_number: "9876543210" },
]];

/** hasExportScope: holds a payroll-export role with an explicit scope_type='all' row. */
function mockOrgWideCaller() {
  hasAnyRole.mockImplementation(async (_userId, ...roles) => !roles.includes("super_admin"));
  getUserAssignmentScopes.mockResolvedValue([{ scope_type: "all" }]);
}

async function fetchCsv() {
  execute.mockReset();
  mockOrgWideCaller();
  execute.mockResolvedValueOnce(RUN_ROW).mockResolvedValueOnce(LINES);
  return request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/neft-export`);
}

describe("NEFT export excludes employees who cannot be paid", () => {
  beforeEach(() => {
    execute.mockReset();
    hasOrgWideScope.mockReset();
    hasAnyRole.mockReset();
    getUserAssignmentScopes.mockReset();
    buildScopeWhereClause.mockReset();
  });

  it("never emits NOT_LINKED as an account number or IFSC", async () => {
    const res = await fetchCsv();
    expect(res.status).toBe(200);
    // A bank cannot route to "NOT_LINKED"; it should not reach the file at all.
    expect(res.text).not.toContain("NOT_LINKED");
  });

  it("keeps only payable employees in the numbered payment rows", async () => {
    const res = await fetchCsv();
    const paymentRows = res.text.split("\n").filter((l) => /^\d+,/.test(l));
    expect(paymentRows).toHaveLength(2);
    expect(paymentRows.join("\n")).toContain("MAS001");
    expect(paymentRows.join("\n")).toContain("MAS004");
    expect(paymentRows.join("\n")).not.toContain("MAS002");
    expect(paymentRows.join("\n")).not.toContain("MAS003");
  });

  it("totals only what the bank can actually disburse", async () => {
    const res = await fetchCsv();
    const total = res.text.split("\n").find((l) => l.startsWith("TOTAL"));
    // 25000 + 30000 — not 85000, which is what including the unpayable rows gave.
    expect(total).toContain("55000.00");
    expect(total).not.toContain("85000");
  });

  it("still reports the excluded employees rather than dropping them silently", async () => {
    const res = await fetchCsv();
    // Someone missing bank details must not simply disappear from payroll.
    expect(res.text).toContain("EXCLUDED");
    expect(res.text).toMatch(/2 employee\(s\) have no bank account/);
    expect(res.text).toContain("MAS002");
    expect(res.text).toContain("MAS003");
    expect(res.text).toContain("30000.00"); // the withheld total, 18000 + 12000
    expect(res.headers["x-neft-excluded-count"]).toBe("2");
  });

  it("reports the exclusions below the TOTAL, not among the payments", async () => {
    const res = await fetchCsv();
    const lines = res.text.split("\n");
    const totalAt = lines.findIndex((l) => l.startsWith("TOTAL"));
    const excludedAt = lines.findIndex((l) => l.startsWith("EXCLUDED"));
    expect(totalAt).toBeGreaterThan(-1);
    expect(excludedAt).toBeGreaterThan(totalAt);
  });

  it("emits no exclusion block when everyone is payable", async () => {
    execute.mockReset();
    mockOrgWideCaller();
    execute.mockResolvedValueOnce(RUN_ROW).mockResolvedValueOnce([[LINES[0][0], LINES[0][3]]]);

    const res = await request(buildApp()).get(`/api/payroll/runs/${RUN_ID}/neft-export`);

    expect(res.text).not.toContain("EXCLUDED");
    expect(res.headers["x-neft-excluded-count"]).toBe("0");
  });
});
