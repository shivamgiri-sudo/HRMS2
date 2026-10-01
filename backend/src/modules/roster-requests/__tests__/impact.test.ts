import { describe, expect, it, vi } from "vitest";
import { computeImpact } from "../roster-requests.impact.js";

const baseAssign = { id: "a1", employee_id: "e1", roster_date: "2026-10-05", process_name: "Voice", shift_template_id: "t1", start_time: "09:00:00", end_time: "18:00:00", shift_name: "Gen", branch_id: "b1", process_id: "p1" };

function deps(over: Partial<any> = {}) {
  return {
    db: {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE wra.id")) return [[baseAssign], []];
        if (sql.includes("COUNT(*)")) return [[{ planned: 12 }], []];
        if (sql.includes("BETWEEN")) return [[{ roster_date: "2026-10-05", shift_name: "Gen", is_week_off: 0 }], []];
        return [[], []];
      }),
    },
    validateMinimumRest: vi.fn(async () => ({ ok: true })),
    checkAssignmentDateNotLocked: vi.fn(async () => ({ blocked: false })),
    ...over,
  };
}

describe("computeImpact (weekoff_rejection)", () => {
  it("returns no blockers for a clean assignment", async () => {
    const r = await computeImpact("weekoff_rejection", "a1", deps() as any);
    expect(r.blockers).toEqual([]);
    expect(r.locked).toBe(false);
    expect(r.sameDayHeadcount?.planned).toBe(12);
    expect(r.week[0].employeeId).toBe("e1");
  });
  it("blocks when payroll has locked the date", async () => {
    const r = await computeImpact("weekoff_rejection", "a1", deps({
      checkAssignmentDateNotLocked: vi.fn(async () => ({ blocked: true, error: "Attendance locked" })),
    }) as any);
    expect(r.locked).toBe(true);
    expect(r.blockers).toContain("Attendance locked");
  });
  it("blocks on insufficient rest", async () => {
    const r = await computeImpact("weekoff_rejection", "a1", deps({
      validateMinimumRest: vi.fn(async () => ({ ok: false, reason: "INSUFFICIENT_REST", actualRestMinutes: 300, requiredRestMinutes: 660 })),
    }) as any);
    expect(r.blockers.join(" ")).toMatch(/rest/i);
    expect(r.rest[0].ok).toBe(false);
  });
  it("throws a 404-tagged error for an unknown id", async () => {
    const d = deps({ db: { execute: vi.fn(async () => [[], []]) } });
    await expect(computeImpact("weekoff_rejection", "nope", d as any)).rejects.toMatchObject({ statusCode: 404 });
  });
  it("skips rest check for a week-off row without a shift template", async () => {
    const d = deps({
      db: {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("WHERE wra.id")) return [[{ ...baseAssign, shift_template_id: null, start_time: null, end_time: null }], []];
          return [[], []];
        }),
      },
    });
    const r = await computeImpact("weekoff_rejection", "a1", d as any);
    expect(d.validateMinimumRest).not.toHaveBeenCalled();
    expect(r.rest).toEqual([]);
  });
});

describe("computeImpact (other kinds)", () => {
  it("swap loads from wfm_roster_swap_request and skips the lock guard", async () => {
    const d = deps({
      db: {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM wfm_roster_swap_request")) return [[{ ...baseAssign, id: "s1" }], []];
          if (sql.includes("COUNT(*)")) return [[{ planned: 3 }], []];
          return [[], []];
        }),
      },
    });
    const r = await computeImpact("swap", "s1", d as any);
    expect(r.kind).toBe("swap");
    expect(r.sameDayHeadcount?.planned).toBe(3);
    expect(d.checkAssignmentDateNotLocked).not.toHaveBeenCalled();
    expect(d.validateMinimumRest).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
  });
  it("swap includes the counterpart's week so scope can be checked for both employees", async () => {
    const d = deps({
      db: {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM wfm_roster_swap_request")) return [[{ ...baseAssign, id: "s1", counterpart_employee_id: "e2" }], []];
          return [[], []];
        }),
      },
    });
    const r = await computeImpact("swap", "s1", d as any);
    expect(r.week.map((w) => w.employeeId)).toEqual(["e1", "e2"]);
  });
  it("dispute loads from roster_daily_assignment and skips headcount without process_name", async () => {
    const d = deps({
      db: {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM roster_daily_assignment")) return [[{ ...baseAssign, id: "d1", process_name: null }], []];
          return [[], []];
        }),
      },
    });
    const r = await computeImpact("dispute", "d1", d as any);
    expect(r.id).toBe("d1");
    expect(r.sameDayHeadcount).toBeNull();
    expect(r.locked).toBe(false);
  });
  it("dispute with a candidate shift rest-checks the candidate's times, not the current shift's", async () => {
    const d = deps({
      db: {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM roster_daily_assignment")) return [[{ ...baseAssign, id: "d1", process_name: null }], []];
          if (sql.includes("FROM wfm_shift_template")) return [[{ id: "t-new", shift_name: "Late", start_time: "22:00:00", end_time: "07:00:00" }], []];
          return [[], []];
        }),
      },
      validateMinimumRest: vi.fn(async () => ({ ok: false, reason: "INSUFFICIENT_REST", actualRestMinutes: 120, requiredRestMinutes: 660 })),
    });
    const r = await computeImpact("dispute", "d1", d as any, { shiftTemplateId: "t-new" });
    expect(d.validateMinimumRest).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "e1" }), { startTime: "22:00:00", endTime: "07:00:00" }, null);
    expect(r.blockers.join(" ")).toMatch(/Insufficient rest/);
  });
  it("dispute with an unknown candidate shift is blocked and skips the rest check", async () => {
    const d = deps({
      db: {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM roster_daily_assignment")) return [[{ ...baseAssign, id: "d1", process_name: null }], []];
          return [[], []];
        }),
      },
    });
    const r = await computeImpact("dispute", "d1", d as any, { shiftTemplateId: "nope" });
    expect(r.blockers).toContain("Shift template not found");
    expect(d.validateMinimumRest).not.toHaveBeenCalled();
  });
  it("dispute without a candidate still rest-checks the existing shift", async () => {
    const d = deps({
      db: {
        execute: vi.fn(async (sql: string) => {
          if (sql.includes("FROM roster_daily_assignment")) return [[{ ...baseAssign, id: "d1", process_name: null }], []];
          return [[], []];
        }),
      },
    });
    await computeImpact("dispute", "d1", d as any);
    expect(d.validateMinimumRest).toHaveBeenCalledWith(expect.anything(), { startTime: "09:00:00", endTime: "18:00:00" }, null);
  });
});
