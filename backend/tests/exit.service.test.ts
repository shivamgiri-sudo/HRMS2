import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * updateExitStatus runs its three core writes - exit_request, the approval log and the
 * employees deactivation - inside one transaction on a pooled connection (2026-08-16), so the
 * mock has to supply getConnection. The connection's execute is the SAME stub as the pool's,
 * which keeps every SQL expectation in this file working unchanged: what is asserted is which
 * statements ran, not which handle issued them.
 */
vi.mock("../src/db/mysql.js", () => {
  const execute = vi.fn().mockResolvedValue([[], []]);
  return {
    db: {
      execute,
      getConnection: vi.fn().mockResolvedValue({
        execute,
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commit: vi.fn().mockResolvedValue(undefined),
        rollback: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
      }),
    },
  };
});
vi.mock("../src/modules/exit/exit-intelligence.service.js", () => ({
  createExitHealthSnapshot: vi.fn().mockResolvedValue(undefined),
  createDefaultClearanceTasks: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "../src/db/mysql.js";
import { exitService } from "../src/modules/exit/exit.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const fakeRequest = {
  id: "exit-1",
  employee_id: "emp-1",
  initiated_by: "employee",
  initiated_by_user_id: "user-1",
  exit_type: "voluntary",
  exit_sub_type: "resignation",
  exit_reason_category: null,
  resignation_reason: "Better opportunity",
  last_working_day_proposed: "2026-06-30",
  last_working_day_confirmed: null,
  notice_period_days: 30,
  notice_start_date: null,
  notice_end_date: null,
  status: "draft",
  revoked_at: null,
  revoke_reason: null,
  revoked_by: null,
  submitted_at: null,
  manager_actioned_at: null,
  hr_actioned_at: null,
  admin_actioned_at: null,
  exit_confirmed_at: null,
  created_at: "2026-05-20T10:00:00Z",
  updated_at: "2026-05-20T10:00:00Z",
};

// ─── listExitRequests ─────────────────────────────────────────────────────────

describe("exitService.listExitRequests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated exit requests", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRequest]]);
    mockExecute.mockResolvedValueOnce([[{ total: 1 }]]);
    const result = await exitService.listExitRequests({ page: 1, limit: 20 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it("filters by status", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRequest]]);
    mockExecute.mockResolvedValueOnce([[{ total: 1 }]]);
    await exitService.listExitRequests({ page: 1, limit: 20, status: "draft" });
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/status = \?/i);
    expect(params).toContain("draft");
  });

  it("filters by employeeId", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRequest]]);
    mockExecute.mockResolvedValueOnce([[{ total: 1 }]]);
    await exitService.listExitRequests({ page: 1, limit: 20, employeeId: "emp-1" });
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/employee_id = \?/i);
    expect(params).toContain("emp-1");
  });
});

// ─── getExitRequest ───────────────────────────────────────────────────────────

describe("exitService.getExitRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns exit request by id", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRequest]]);
    const result = await exitService.getExitRequest("exit-1");
    expect(result.id).toBe("exit-1");
    expect(result.exit_type).toBe("voluntary");
  });

  it("throws when not found", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    await expect(exitService.getExitRequest("missing")).rejects.toThrow("Exit request not found");
  });
});

// ─── createExitRequest ────────────────────────────────────────────────────────

describe("exitService.createExitRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts exit request and returns it", async () => {
    // Keyed on the statement, not call order: createExitRequest also looks up the
    // employee to notify between the INSERT and the re-fetch, so a positional
    // chain fed the re-fetch's row to that lookup and getExitRequest then threw
    // "Exit request not found".
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/SELECT id\s+FROM exit_request/i.test(text)) return [[], []];   // no active request
      if (/INSERT INTO exit_request/i.test(text)) return [{ affectedRows: 1 }, []];
      if (/SELECT er\.\*/i.test(text)) return [[fakeRequest], []];       // getExitRequest
      return [[], []];
    });
    const result = await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-06-30", exitType: "voluntary", reason: "Better opportunity" },
      "user-1"
    );
    expect(result.employee_id).toBe("emp-1");
    expect(result.status).toBe("draft");
  });

  it("passes null reason when not provided", async () => {
    // Same statement-keyed stub as above. It also has to be re-declared per test:
    // vi.clearAllMocks() clears recorded calls but leaves the implementation in
    // place, so without this the previous test's row would be returned here.
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/SELECT id\s+FROM exit_request/i.test(text)) return [[], []];
      if (/INSERT INTO exit_request/i.test(text)) return [{ affectedRows: 1 }, []];
      if (/SELECT er\.\*/i.test(text)) return [[{ ...fakeRequest, resignation_reason: null }], []];
      return [[], []];
    });
    const result = await exitService.createExitRequest(
      { employeeId: "emp-2", exitDate: "2026-07-31", exitType: "voluntary" },
      "user-2"
    );
    expect(result.resignation_reason).toBeNull();
    // Located by statement rather than index — the service issues other queries
    // around the INSERT, so a fixed index silently points at the wrong call.
    const insertCall = mockExecute.mock.calls.find(([sql]) =>
      /INSERT INTO exit_request/i.test(String(sql)),
    );
    expect(insertCall, "expected the exit request to be inserted").toBeDefined();
    expect(insertCall![1]).toContain(null); // reason is null
  });
});

// ─── updateExitStatus ─────────────────────────────────────────────────────────

describe("exitService.updateExitStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates status and inserts approval log", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRequest]]); // getExitRequest
    // The transaction opens with SELECT status ... FOR UPDATE, so the caller's observed
    // status can be re-checked under the lock before anything is written.
    mockExecute.mockResolvedValueOnce([[{ status: "draft" }]]); // lock + re-read
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE (expected-state guarded)
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT log
    mockExecute.mockResolvedValueOnce([[{ ...fakeRequest, status: "submitted" }]]); // re-fetch
    const result = await exitService.updateExitStatus("exit-1", "submitted", "Looks good", "user-1");
    expect(result.status).toBe("submitted");
    // Verify log insert was called
    expect(mockExecute).toHaveBeenCalledTimes(5);
  });

  it("throws when exit request not found", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // getExitRequest returns empty
    await expect(
      exitService.updateExitStatus("missing", "submitted", "Remarks", "user-1")
    ).rejects.toThrow("Exit request not found");
  });
});

// ─── getExitStats ─────────────────────────────────────────────────────────────

describe("exitService.getExitStats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns counts by status including total", async () => {
    mockExecute.mockResolvedValueOnce([[
      { status: "draft",     cnt: 5 },
      { status: "submitted", cnt: 3 },
      { status: "accepted",  cnt: 2 },
      { status: "exited",    cnt: 10 },
    ]]);
    const stats = await exitService.getExitStats();
    expect(stats.draft).toBe(5);
    expect(stats.submitted).toBe(3);
    expect(stats.accepted).toBe(2);
    expect(stats.exited).toBe(10);
    expect(stats.total).toBe(20);
    // Statuses not in DB should default to 0
    expect(stats.revoked).toBe(0);
    expect(stats.notice_serving).toBe(0);
  });

  it("returns all zeros when table is empty", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // no rows
    const stats = await exitService.getExitStats();
    expect(stats.total).toBe(0);
    expect(stats.draft).toBe(0);
    expect(stats.exited).toBe(0);
  });
});
