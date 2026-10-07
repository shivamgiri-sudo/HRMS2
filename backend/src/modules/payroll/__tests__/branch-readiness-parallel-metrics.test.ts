/**
 * refreshLiveMetrics used to await ~12 independent metric queries one after another (per branch,
 * per process). They now start together, capped by a module-level slot limit, and are collected in
 * the original order. These tests pin: (1) the values written are what the sequential code wrote,
 * including the derived flags, (2) the queries genuinely overlap, (3) the cap holds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../policy-engine/policy-engine.cache.js", () => ({
  getPolicyValue: vi.fn(),
}));

import { payrollBranchReadinessService as svc } from "../payroll-branch-readiness.service.js";

let inFlight = 0;
let maxInFlight = 0;
let updateCall: { sql: string; params: unknown[] } | null = null;
let infoSchemaCalls = 0;

function answer(sql: string): unknown[] {
  if (/FROM salary_prep_run/i.test(sql)) return [{ frozen: 1 }];
  if (/FROM incentive_upload_batch/i.test(sql) && /pay_month LIKE/i.test(sql))
    return [{ status: "approved" }];
  if (/COUNT\(DISTINCT e\.id\) AS total/i.test(sql))
    return [{ total: 4, with_bank: 2 }];
  if (/AS with_uan/i.test(sql)) return [{ total: 4, with_uan: 1 }];
  if (/information_schema\.COLUMNS/i.test(sql)) {
    infoSchemaCalls++;
    return [{ COLUMN_NAME: "request_date" }];
  }
  if (/FROM leave_request/i.test(sql)) return [{ cnt: 0 }];
  if (/FROM attendance_regularization/i.test(sql)) return [{ cnt: 3 }];
  if (/attendance_daily_record/i.test(sql)) return [{ cnt: 7 }];
  if (/FROM incentive_upload_batch/i.test(sql)) return [{ status: "approved" }];
  if (/cost_centre_master/i.test(sql)) return [{ staffed: 2, approved: 2 }];
  if (/employee_deduction_entries/i.test(sql)) return [{ cnt: 0 }];
  if (/holiday_work_request/i.test(sql)) return [{ cnt: 0 }];
  return [{ cnt: 0 }];
}

beforeEach(() => {
  execute.mockReset();
  inFlight = 0;
  maxInFlight = 0;
  updateCall = null;
  infoSchemaCalls = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/^\s*UPDATE payroll_branch_readiness/i.test(sql)) {
      updateCall = { sql, params };
      return [{}, []];
    }
    if (/SELECT 1 FROM payroll_branch_readiness LIMIT 0/i.test(sql))
      return [[], []];
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return [answer(sql), []];
  });
});

describe("refreshLiveMetrics", () => {
  it("writes the same values and derived flags the sequential version did, in the same column order", async () => {
    await svc.refreshLiveMetrics("2026-08", "br-1", "pr-1");
    expect(updateCall).not.toBeNull();
    const cols = updateCall!.sql
      .match(/SET (.*)\n\s*WHERE/s)![1]
      .split(",")
      .map((c) => c.split("=")[0].trim());
    expect(cols).toEqual([
      "attendance_frozen",
      "incentives_status",
      "incentives_confirmed_at",
      "bank_details_pct",
      "uan_complete_pct",
      "noc_resolved",
      "holiday_work_approved",
      "pending_leave_count",
      "pending_regularization_count",
      "employees_without_attendance",
      "incentive_batch_status",
      "attendance_data_ready",
      "leave_finalized",
      "custom_deductions_uploaded",
    ]);
    const v = updateCall!.params;
    expect(v[0]).toBe(1); // frozen
    expect(v[1]).toBe("approved"); // incentives_status
    expect(v[3]).toBe(50); // bank pct
    expect(v[4]).toBe(25); // uan pct
    expect(v[7]).toBe(0); // pending leave
    expect(v[8]).toBe(3); // pending regularization (>0 => regularization_complete NOT raised)
    expect(v[11]).toBe(1); // attendance_data_ready derived from CC chain
    expect(v[12]).toBe(1); // leave_finalized derived (0 pending)
    expect(v[13]).toBe(1); // custom_deductions_uploaded derived (0 entries)
    expect(v.slice(-3)).toEqual(["2026-08", "br-1", "pr-1"]);
  });

  it("runs the independent metric queries concurrently but never above the cap", async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        svc.refreshLiveMetrics("2026-08", `br-${i}`, "pr-1"),
      ),
    );
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(10);
  });

  it("looks up the holiday_work_request date column once, not per call", async () => {
    await svc.refreshLiveMetrics("2026-08", "br-1");
    await svc.refreshLiveMetrics("2026-08", "br-2");
    expect(infoSchemaCalls).toBeLessThanOrEqual(1);
  });
});

describe("getSummaryForBranch", () => {
  it("keeps process order and skips a failing process, refreshing in concurrent chunks", async () => {
    const procs = ["p1", "p2", "p3", "p4", "p5"].map((id) => ({
      id,
      process_name: id,
    }));
    const spy = vi
      .spyOn(svc, "getOrRefresh")
      .mockImplementation(async (_m, _b, pid = "") => {
        if (pid === "p2") throw new Error("boom");
        await new Promise((r) => setTimeout(r, pid === "p1" ? 20 : 1));
        return { process_id: pid } as any;
      });
    execute.mockReset();
    execute.mockResolvedValueOnce([procs, []]);
    const out = await svc.getSummaryForBranch("2026-08", "br-1");
    expect(out.map((r: any) => r.process_id)).toEqual(["p1", "p3", "p4", "p5"]);
    spy.mockRestore();
  });
});
