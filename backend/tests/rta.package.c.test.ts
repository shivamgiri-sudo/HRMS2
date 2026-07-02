import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { db } from "../src/db/mysql.js";
import {
  reconciliationService,
  shrinkageService,
  alertService,
  payrollReadinessService,
  leaveImpactService,
} from "../src/modules/rta/rta.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

// ── Test fixtures ──────────────────────────────────────────────────────────────

const DATE = "2026-05-30";

const fakeRosterRow = {
  employee_id: "emp-1",
  shift_start_time: "09:00",
  shift_end_time: "18:00",
  plan_id: "plan-1",
  required_minutes: 480,
  sm_start: "09:00",
  sm_end: "18:00",
};

const fakeSessionRow = {
  employee_id: "emp-1",
  login_time: `${DATE}T09:05:00`,
  logout_time: `${DATE}T18:02:00`,
  total_login_minutes: 477,
  current_status: "Logged Out",
  punch_source: "MANUAL",
};

const fakeShrinkageRow = {
  id: "snap-1",
  snapshot_date: DATE,
  process_id: null,
  branch_id: null,
  rostered_hc: 10,
  present_hc: 8,
  absent_hc: 1,
  on_leave_hc: 1,
  late_count: 0,
  planned_shrinkage_pct: 10,
  unplanned_shrinkage_pct: 10,
  total_shrinkage_pct: 20,
  avg_adherence_pct: 95,
  attendance_locked: 0,
};

// ── Reconciliation ─────────────────────────────────────────────────────────────

describe("reconciliationService.reconcileDate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reconciles a date with sessions and returns counts", async () => {
    mockExecute
      .mockResolvedValueOnce([[fakeRosterRow]])  // roster
      .mockResolvedValueOnce([[fakeSessionRow]]) // sessions
      .mockResolvedValueOnce([[]])               // leaves (none)
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // upsert

    const result = await reconciliationService.reconcileDate(DATE, { userId: "u-1" });
    expect(result.reconciled).toBe(1);
    expect(result.absent).toBe(0);
  });

  it("marks absent when no session found", async () => {
    mockExecute
      .mockResolvedValueOnce([[fakeRosterRow]]) // roster
      .mockResolvedValueOnce([[]])              // no sessions
      .mockResolvedValueOnce([[]])              // leaves
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await reconciliationService.reconcileDate(DATE, { userId: "u-1" });
    expect(result.absent).toBe(1);
    expect(result.reconciled).toBe(0);
  });

  it("marks leave_approved for employee on approved leave", async () => {
    mockExecute
      .mockResolvedValueOnce([[fakeRosterRow]])           // roster
      .mockResolvedValueOnce([[]])                        // no sessions
      .mockResolvedValueOnce([[{ employee_id: "emp-1" }]]) // on leave
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await reconciliationService.reconcileDate(DATE, { userId: "u-1" });
    // On leave = not absent, not reconciled in the present sense
    expect(result.absent).toBe(0);
    expect(result.reconciled).toBe(0);
  });
});

describe("reconciliationService.listReconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated records", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ employee_id: "emp-1", attendance_status: "present" }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
    const result = await reconciliationService.listReconciliation({ fromDate: DATE, toDate: DATE, page: 1, limit: 50 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

// ── Shrinkage ──────────────────────────────────────────────────────────────────

describe("shrinkageService.calculateSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calculates shrinkage and upserts snapshot", async () => {
    mockExecute
      .mockResolvedValueOnce([[                               // status counts
        { attendance_status: "present", cnt: 8 },
        { attendance_status: "absent",  cnt: 1 },
        { attendance_status: "leave_approved", cnt: 1 },
      ]])
      .mockResolvedValueOnce([[{ avg_adh: 95, avg_prod: 460, total_break: 120, late_count: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])           // upsert
      .mockResolvedValueOnce([[fakeShrinkageRow]]);            // re-fetch

    const snap = await shrinkageService.calculateSnapshot(DATE, { userId: "u-1" });
    expect(snap.rostered_hc).toBe(10);
    expect(snap.total_shrinkage_pct).toBe(20);
  });
});

describe("shrinkageService.listSnapshots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns snapshots for date range", async () => {
    mockExecute.mockResolvedValueOnce([[fakeShrinkageRow]]);
    const result = await shrinkageService.listSnapshots({ fromDate: DATE, toDate: DATE });
    expect(result).toHaveLength(1);
    expect(result[0].snapshot_date).toBe(DATE);
  });
});

// ── Alerts ─────────────────────────────────────────────────────────────────────

describe("alertService.fireAlertsForDate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires no-show alerts for absent employees", async () => {
    mockExecute
      .mockResolvedValueOnce([[]])                              // no low-adherence
      .mockResolvedValueOnce([[{ employee_id: "emp-1" }]])      // no-shows
      .mockResolvedValueOnce([{ affectedRows: 1 }])             // insert no-show
      .mockResolvedValueOnce([[]])                              // no shrinkage breach
    ;
    const count = await alertService.fireAlertsForDate(DATE, { userId: "u-1" });
    expect(count).toBeGreaterThan(0);
  });

  it("returns 0 alerts when all employees present and adherence high", async () => {
    mockExecute
      .mockResolvedValueOnce([[]])   // no low-adherence
      .mockResolvedValueOnce([[]])   // no no-shows
      .mockResolvedValueOnce([[]])   // no shrinkage breach
    ;
    const count = await alertService.fireAlertsForDate(DATE, { userId: "u-1" });
    expect(count).toBe(0);
  });
});

describe("alertService.listAlerts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns alerts with filters", async () => {
    mockExecute.mockResolvedValueOnce([[
      { id: "a-1", alert_date: DATE, alert_type: "no_show", severity: "critical", status: "open" },
    ]]);
    const alerts = await alertService.listAlerts({ status: "open", page: 1, limit: 50 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_type).toBe("no_show");
  });
});

// ── Payroll Readiness ──────────────────────────────────────────────────────────

describe("payrollReadinessService.generateReadinessFlags", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates flags for all employees with attendance data", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ employee_id: "emp-1" }, { employee_id: "emp-2" }]]) // distinct employees
      .mockResolvedValueOnce([[{ working_days: 22, present_days: 21, absent_days: 1, leave_days: 0, half_days: 0, lwp_days: 1, total_productive_mins: 9900 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ working_days: 22, present_days: 22, absent_days: 0, leave_days: 0, half_days: 0, lwp_days: 0, total_productive_mins: 10560 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await payrollReadinessService.generateReadinessFlags("2026-05-01", "2026-05-31", { userId: "u-1" });
    expect(result.flagged).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("returns empty when no reconciliation data", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // no employees
    const result = await payrollReadinessService.generateReadinessFlags("2026-05-01", "2026-05-31", { userId: "u-1" });
    expect(result.flagged).toBe(0);
  });
});

// ── Leave Impact ───────────────────────────────────────────────────────────────

describe("leaveImpactService.calculateLeaveImpact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calculates impact days for a leave request", async () => {
    mockExecute
      .mockResolvedValueOnce([[{           // leave request with roster
        employee_id: "emp-1",
        from_date: DATE,
        to_date: DATE,
        process_name: "Inbound",
        branch_name: "Mumbai",
      }]])
      .mockResolvedValueOnce([[{ total: 5 }]])  // 5 others rostered
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const days = await leaveImpactService.calculateLeaveImpact("leave-1");
    expect(days).toBe(1); // single day leave
  });

  it("returns 0 for unknown leave request", async () => {
    mockExecute.mockResolvedValueOnce([[]]); // not found
    const days = await leaveImpactService.calculateLeaveImpact("leave-missing");
    expect(days).toBe(0);
  });
});
