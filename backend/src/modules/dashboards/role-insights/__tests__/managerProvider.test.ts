import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../db/mysql.js", () => ({ db: { execute } }));

import manager from "../providers/manager.js";
import type { InsightContext } from "../types.js";

const ctx = (over: Partial<InsightContext["scope"]> = {}): InsightContext => ({
  scope: { level: "TEAM_ONLY", branchIds: [], processIds: [], employeeIds: ["e1", "e2"], userId: "u1", role: "manager", ...over },
  userId: "u1", roleKeys: ["manager"], today: "2026-10-02",
});

beforeEach(() => execute.mockReset());

describe("manager provider - queues", () => {
  it("a team scope that resolved to nobody says so and returns no queues (not a row of zeros)", async () => {
    const out = await manager.sections.queues(ctx({ employeeIds: [] }));
    expect(out.actions).toBeUndefined();
    expect(out.signals?.[0]).toMatchObject({ tone: "watch", title: "No team mapped" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("a failed queue read becomes count=null with the reason - never a confident zero - and the other queues still load", async () => {
    execute.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? "");
      if (sql.includes("FROM leave_request lr")) return [[{ n: 4, oldest: 21, started: 1, needs_bh: 0, older: 0 }]];
      if (sql.includes("FROM attendance_regularization r") && sql.includes("<> 'work_from_home'")) throw new Error("ER_LOCK_WAIT_TIMEOUT");
      if (sql.includes("COUNT(*) n FROM appraisal_cycle")) return [[{ n: 0 }]];
      if (sql.includes("COUNT(*) n FROM employee_probation")) return [[{ n: 0 }]];
      if (sql.includes("COUNT(*) n FROM lms_certification_snapshot")) return [[{ n: 0 }]];
      return [[{ n: 0, oldest: null, overdue: 0 }]];
    });
    const out = await manager.sections.queues(ctx());
    const by = Object.fromEntries((out.actions ?? []).map((a) => [a.id, a]));

    expect(by.leave).toMatchObject({ count: 4, oldestDays: 21, overdue: 1, severity: "high", href: "/leaves" });
    expect(by.regularisation.count).toBeNull();
    expect(by.regularisation.unavailable).toContain("ER_LOCK_WAIT_TIMEOUT");
    expect(by.regularisation.severity).toBe("info");
    expect(by.wfh).toMatchObject({ count: 0, severity: "info" });
    // work-inbox items carry no due date: they are never marked overdue.
    expect(by.inbox.overdue).toBe(0);
    // empty source tables are reported as a data gap, not as clear queues.
    expect(out.signals?.some((s) => s.title.includes("not tracked yet"))).toBe(true);
  });

  it("every queue links to a page path", async () => {
    execute.mockResolvedValue([[{ n: 0 }]]);
    const out = await manager.sections.queues(ctx());
    for (const a of out.actions ?? []) expect(a.href).toMatch(/^\//);
  });

  it("scopes every employee-keyed read to the caller's team ids (never widens)", async () => {
    execute.mockResolvedValue([[{ n: 0 }]]);
    await manager.sections.queues(ctx());
    const employeeKeyed = execute.mock.calls.filter(([sql]) => /JOIN employees e ON/.test(String(sql)));
    expect(employeeKeyed.length).toBeGreaterThan(5);
    for (const [sql, params] of employeeKeyed) {
      expect(String(sql)).toMatch(/e\.id IN \(\?,\?\)/);
      expect(params).toEqual(expect.arrayContaining(["e1", "e2"]));
    }
  });
});
