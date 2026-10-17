import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WFM report 2026-10-17: August leavers counted as NOC-pending in the Ops Control Tower could not be
 * found in the Exit Command Center. Two causes: exits with a pending NOC fell past the board's 200-row
 * cap (search is client-side over those rows), and NOCs raised with no exit request were never listed.
 * Both views now use payroll/noc-pending-rule.ts.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  ORG_WIDE_EXEMPT_ROLES: ["super_admin"],
  buildScopeWhereClause: vi.fn(async () => ({ sql: "e.branch_id IN (?)", params: ["branch-a"] })),
}));

const { getExitCommandCenter } = await import("../exit-intelligence.service.js");
const { nocPendingSql, NOC_OPEN_STATUSES } = await import("../../payroll/noc-pending-rule.js");

let flag: string | null = null;
const NOC_ONLY_ROW = { noc_case_id: "case-1", employee_code: "MAS62954", noc_case_status: "in_progress" };

beforeEach(() => {
  flag = null;
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM payroll_config_flags")) return [flag ? [{ config_value: flag }] : []];
    if (sql.includes("AS noc_case_id")) return [[NOC_ONLY_ROW]];
    return [[]];
  });
});

const call = (needle: string) => execute.mock.calls.find(([sql]) => String(sql).includes(needle))!;

describe("nocPendingSql", () => {
  it("open and not an absconder without exception; no final-approval part while the gate is off", () => {
    const r = nocPendingSql("nc", "er", "e", null);
    expect(r.params).toEqual([...NOC_OPEN_STATUSES]);
    expect(r.sql).toContain("nc.status IN (?,?,?)");
    expect(r.sql).toContain("er.ff_exception_at IS NULL");
    expect(r.sql).not.toContain("payroll_head_approved_at");
  });
  it("adds completed-awaiting-Payroll-Head once the gate has a date", () => {
    const r = nocPendingSql("nc", "er", "e", "2026-09-01");
    expect(r.params).toEqual([...NOC_OPEN_STATUSES, "2026-09-01"]);
    expect(r.sql).toContain("nc.payroll_head_approved_at IS NULL");
  });
});

describe("getExitCommandCenter and pending NOCs", () => {
  it("ranks exits with a pending NOC ahead of the 200-row cap, binding params after the scope", async () => {
    flag = "2026-09-01";
    await getExitCommandCenter({ actorUserId: "u1", actorRoles: ["wfm"] });
    const [sql, params] = call("ORDER BY\n        FIELD(er.status");
    const order = String(sql).slice(String(sql).indexOf("ORDER BY"));
    expect(order).toMatch(/COALESCE\(\(\(nc\.status IN \(\?,\?,\?\)/);
    expect(order.indexOf("COALESCE(")).toBeLessThan(order.indexOf("er.created_at DESC"));
    expect(String(sql)).toContain("LIMIT 200");
    expect(params).toEqual(["branch-a", ...NOC_OPEN_STATUSES, "2026-09-01"]);
  });

  it("returns scoped pending NOC cases that have no exit request", async () => {
    const result = await getExitCommandCenter({ actorUserId: "u1", actorRoles: ["wfm"] });
    const [sql, params] = call("AS noc_case_id");
    expect(String(sql)).toContain("er.id IS NULL");
    expect(String(sql)).toContain("nc.status IN (?,?,?)");
    expect(String(sql)).toContain("(e.branch_id IN (?))");
    expect(params).toEqual([...NOC_OPEN_STATUSES, "branch-a"]);
    expect(result.noc_without_exit).toEqual([NOC_ONLY_ROW]);
  });
});
