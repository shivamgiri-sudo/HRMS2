/**
 * The employee directory's Inactive and Offboarded filters returned nothing at all.
 *
 * Reported from production: /employees with the status filter set to Inactive shows an empty
 * list. Measured live 2026-08-11 — 57,517 employees have active_status = 0, and the query the
 * UI actually caused was:
 *
 *   WHERE e.active_status = 1 AND e.employment_status = 'Inactive'   -> 0 rows
 *   WHERE e.active_status = 1 AND e.employment_status = 'Terminated' -> 0 rows
 *
 * Two independent faults, and the first makes both filters structurally incapable of ever
 * returning a row:
 *
 *   1. listEmployees hardcoded `e.active_status = 1`. `recordStatus` was declared in
 *      employeeFiltersSchema, sent by the client, threaded through the controller — and then
 *      never destructured in the service. An accepted-and-ignored parameter, which reads as
 *      supported from every layer above it.
 *
 *   2. The client also pinned employment_status to the literal 'Inactive'. Inactive employees
 *      actually carry four values: 'Resigned' (30,317), 'inactive' (26,689), 'terminated'
 *      (501) and 'Active' (10, a data anomaly). So even with fault 1 fixed, that pin would
 *      still hide 30,818 of the 57,517.
 *
 * The default is deliberately "active", NOT the schema's original "all". Today every caller
 * gets active-only regardless of what it sends, so "active" is what preserves existing
 * behaviour for the callers that omit the parameter; defaulting to "all" would silently start
 * returning 57,517 inactive people to every dropdown and picker that lists employees.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute }, pingDb: vi.fn() }));

import { employeeService } from "../employee.service.js";
import { employeeFiltersSchema } from "../employee.validation.js";

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

/** The WHERE clause of the row-fetching SELECT. */
function whereClause(): string {
  const call = execute.mock.calls.find(([s]) => /FROM employees e/i.test(String(s)));
  expect(call, "no employee SELECT was issued").toBeDefined();
  return String(call![0]);
}

describe("employee directory — recordStatus is honoured", () => {
  it("returns INACTIVE records when recordStatus=inactive", async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, recordStatus: "inactive", includeAnalytics: false } as never);
    const sql = whereClause();
    expect(sql).toMatch(/e\.active_status\s*=\s*0/);
    expect(sql).not.toMatch(/e\.active_status\s*=\s*1/);
  });

  it("returns ACTIVE records when recordStatus=active", async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, recordStatus: "active", includeAnalytics: false } as never);
    expect(whereClause()).toMatch(/e\.active_status\s*=\s*1/);
  });

  it("constrains neither when recordStatus=all", async () => {
    await employeeService.listEmployees({ page: 1, limit: 50, recordStatus: "all", includeAnalytics: false } as never);
    expect(whereClause()).not.toMatch(/e\.active_status\s*=\s*[01]/);
  });

  it("defaults to active, so callers that omit it keep today's behaviour", () => {
    // The regression this guards: flipping the default to "all" would start returning 57,517
    // inactive people to every employee picker in the product.
    expect(employeeFiltersSchema.parse({}).recordStatus).toBe("active");
  });

  it("still applies employment_status when one is supplied", async () => {
    await employeeService.listEmployees(
      { page: 1, limit: 50, recordStatus: "inactive", status: "Terminated", includeAnalytics: false } as never,
    );
    const sql = whereClause();
    expect(sql).toMatch(/e\.employment_status\s*=\s*\?/);
    expect(sql).toMatch(/e\.active_status\s*=\s*0/);
  });
});
