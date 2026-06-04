import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
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
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT
    mockExecute.mockResolvedValueOnce([[fakeRequest]]);         // re-fetch
    const result = await exitService.createExitRequest(
      { employeeId: "emp-1", exitDate: "2026-06-30", exitType: "voluntary", reason: "Better opportunity" },
      "user-1"
    );
    expect(result.employee_id).toBe("emp-1");
    expect(result.status).toBe("draft");
  });

  it("passes null reason when not provided", async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    mockExecute.mockResolvedValueOnce([[{ ...fakeRequest, resignation_reason: null }]]);
    const result = await exitService.createExitRequest(
      { employeeId: "emp-2", exitDate: "2026-07-31", exitType: "voluntary" },
      "user-2"
    );
    expect(result.resignation_reason).toBeNull();
    const [, insertParams] = mockExecute.mock.calls[0];
    expect(insertParams).toContain(null); // reason is null
  });
});

// ─── updateExitStatus ─────────────────────────────────────────────────────────

describe("exitService.updateExitStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates status and inserts approval log", async () => {
    mockExecute.mockResolvedValueOnce([[fakeRequest]]); // getExitRequest
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT log
    mockExecute.mockResolvedValueOnce([[{ ...fakeRequest, status: "submitted" }]]); // re-fetch
    const result = await exitService.updateExitStatus("exit-1", "submitted", "Looks good", "user-1");
    expect(result.status).toBe("submitted");
    // Verify log insert was called
    expect(mockExecute).toHaveBeenCalledTimes(4);
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
