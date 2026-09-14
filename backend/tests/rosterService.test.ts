import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * roster.service.ts wraps its critical section in withEmployeeRosterLock, which takes a
 * MySQL named advisory lock on a dedicated connection (rest-policy.service.ts) so two
 * concurrent roster writes for the same employee cannot both pass validation and commit.
 * That means db.getConnection() has to exist here, and the lock statements go through
 * .query() rather than .execute().
 *
 * The connection's execute is the SAME stub as the pool's, so every SQL expectation in this
 * file keeps working unchanged — what these tests assert is which statements run, not which
 * handle issued them. GET_LOCK must report acquired=1 or the service throws
 * ROSTER_LOCK_TIMEOUT before reaching any of the behaviour under test.
 */
vi.mock("../src/db/mysql.js", () => {
  const execute = vi.fn().mockResolvedValue([[], []]);
  const query = vi.fn().mockResolvedValue([[{ acquired: 1 }], []]);
  return {
    db: {
      execute,
      query,
      getConnection: vi.fn().mockResolvedValue({
        execute,
        query,
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      }),
    },
  };
});

import { db } from "../src/db/mysql.js";
import { rosterService } from "../src/modules/wfm/roster.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const fakePlan = {
  id: "plan-1",
  plan_name: "May Week 1",
  process_id: "proc-1",
  branch_id: null,
  shift_id: "shift-1",
  from_date: "2026-05-20",
  to_date: "2026-05-26",
  required_headcount: 10,
  assigned_headcount: 0,
  plan_status: "draft",
  created_by: "user-1",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

const fakeAssignment = {
  id: "asgn-1",
  employee_id: "emp-1",
  shift_id: "shift-1",
  plan_id: "plan-1",
  roster_date: "2026-05-20",
  roster_status: "Rostered",
  shift_start_time: "09:00",
  shift_end_time: "18:00",
  branch_name: "Mumbai",
  process_name: "Inbound",
  publish_status: "draft",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

describe("rosterService.createPlan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts plan and returns it", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockExecute.mockResolvedValueOnce([[fakePlan]]);
    const result = await rosterService.createPlan(
      { planName: "May Week 1", fromDate: "2026-05-20", toDate: "2026-05-26", requiredHeadcount: 10, shiftId: "shift-1", processId: "proc-1" },
      "user-1"
    );
    expect(result.plan_name).toBe("May Week 1");
    expect(result.plan_status).toBe("draft");
  });

  it("throws when toDate < fromDate", async () => {
    await expect(
      rosterService.createPlan(
        { planName: "Bad", fromDate: "2026-05-26", toDate: "2026-05-20", requiredHeadcount: 5 },
        "user-1"
      )
    ).rejects.toThrow("toDate must be >= fromDate");
  });
});

describe("rosterService.listPlans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns plans", async () => {
    mockExecute.mockResolvedValueOnce([[fakePlan]]);
    const result = await rosterService.listPlans({});
    expect(result).toHaveLength(1);
  });

  it("filters by processId", async () => {
    mockExecute.mockResolvedValueOnce([[fakePlan]]);
    await rosterService.listPlans({ processId: "proc-1" });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/process_id/i);
  });
});

/**
 * assignEmployee and bulkAssign now run inside withEmployeeRosterLock and issue three
 * infrastructure reads before the write they are actually about: the attendance-lock check,
 * a hasTable probe for the minimum-rest feature, and a column-list lookup.
 *
 * A positional mockResolvedValueOnce queue silently mis-feeds those — the second queued value
 * landed on the INFORMATION_SCHEMA.TABLES probe, which made hasTable report the rest feature
 * as ACTIVE, which then failed the assignment with REST_POLICY_MISSING. Stubbing by SQL shape
 * instead means a future guard added ahead of the write cannot quietly re-break these.
 *
 * The rest feature is deliberately left inactive here: this file covers roster assignment, and
 * the rest rule has its own suites in rest-policy.test.ts, rest-policy-night-shift.test.ts and
 * rest-policy-warn-mode.test.ts.
 */
function stubRosterSql(opts: { failInsertOnce?: boolean } = {}) {
  let insertFailuresLeft = opts.failInsertOnce ? 1 : 0;
  mockExecute.mockReset();
  mockExecute.mockImplementation(async (sql?: unknown) => {
    const s = String(sql ?? "");
    if (/INSERT INTO wfm_roster_assignment/i.test(s)) {
      if (insertFailuresLeft > 0) { insertFailuresLeft--; throw new Error("DB error"); }
      return [{ affectedRows: 1 }, []];
    }
    if (/SELECT \* FROM wfm_roster_assignment/i.test(s)) return [[fakeAssignment], []];
    if (/INSERT INTO sensitive_action_log/i.test(s)) return [{ affectedRows: 1 }, []];
    return [[], []]; // is_locked, INFORMATION_SCHEMA probes, everything else
  });
}

describe("rosterService.assignEmployee", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts assignment and returns it", async () => {
    stubRosterSql();
    const result = await rosterService.assignEmployee(
      { employeeId: "emp-1", rosterDate: "2026-05-20", shiftId: "shift-1", planId: "plan-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
      "user-1"
    );
    expect(result.employee_id).toBe("emp-1");
  });
});

describe("rosterService.bulkAssign", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts multiple rows and returns count", async () => {
    stubRosterSql();
    const rows = [
      { employeeId: "emp-1", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
      { employeeId: "emp-2", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
    ];
    const result = await rosterService.bulkAssign(rows, "plan-1", "user-1");
    expect(result.assigned).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("counts failed rows when DB throws", async () => {
    // The first employee's INSERT fails; the second succeeds. Targeting the INSERT by shape
    // rather than by position means the failure lands on the write, not on a probe.
    stubRosterSql({ failInsertOnce: true });
    const rows = [
      { employeeId: "emp-1", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
      { employeeId: "emp-2", rosterDate: "2026-05-20", shiftId: "shift-1", shiftStartTime: "09:00", shiftEndTime: "18:00" },
    ];
    const result = await rosterService.bulkAssign(rows, "plan-1", "user-1");
    expect(result.failed).toBe(1);
    expect(result.assigned).toBe(1);
  });
});

describe("rosterService.publishPlan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates plan_status to published and all assignments to published", async () => {
    mockExecute.mockResolvedValueOnce([[fakePlan]]);          // getPlan check
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // update plan
    mockExecute.mockResolvedValueOnce([{ affectedRows: 5 }]); // update assignments
    mockExecute.mockResolvedValueOnce([[{ ...fakePlan, plan_status: "published" }]]); // re-fetch
    const result = await rosterService.publishPlan("plan-1", "user-1");
    expect(result.plan_status).toBe("published");
  });

  it("throws when plan not found", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // empty
    await expect(rosterService.publishPlan("missing", "user-1")).rejects.toThrow("Plan not found");
  });
});

describe("rosterService.listAssignments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns assignments for a plan", async () => {
    mockExecute.mockResolvedValueOnce([[fakeAssignment]]);
    const result = await rosterService.listAssignments({ planId: "plan-1" });
    expect(result).toHaveLength(1);
    expect(result[0].plan_id).toBe("plan-1");
  });

  it("filters by employeeId", async () => {
    mockExecute.mockResolvedValueOnce([[fakeAssignment]]);
    await rosterService.listAssignments({ employeeId: "emp-1" });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/employee_id/i);
  });

  it("filters by rosterDate range", async () => {
    mockExecute.mockResolvedValueOnce([[fakeAssignment]]);
    await rosterService.listAssignments({ fromDate: "2026-05-20", toDate: "2026-05-26" });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/roster_date/i);
  });
});
