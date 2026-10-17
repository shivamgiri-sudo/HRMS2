/**
 * WFM report 2026-10-17: the Ops Control Tower "Attendance mismatch" count did not match the exported list
 * and did not move after an APR upload. The count and the drill-down must cover the current IST month only,
 * must drop a day once its attendance record is locked (APR upload / correction / payroll freeze), and the
 * drill-down must not be capped below the count.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import * as svc from "../ops-control-tower.service.js";

const B = "b0000000-0000-0000-0000-000000000001";
let calls: Array<{ sql: string; params: unknown[] }> = [];

beforeEach(() => {
  calls = [];
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM branch_master")) return [[{ id: B, branch_name: "NOIDA" }]];
    if (sql.includes("open_count")) return [[{ branch_id: B, open_count: 7, last_resolved: null }]];
    return [[]];
  });
});

const issueCall = () => calls.find((c) => c.sql.includes("attendance_reconciliation_issue"))!;

describe("currentMonthWindowIST", () => {
  it("starts on the 1st of the IST month and ends today (IST)", () => {
    expect(svc.currentMonthWindowIST(Date.UTC(2026, 9, 17, 6, 0))).toEqual({ from: "2026-10-01", to: "2026-10-17" });
  });
  it("uses the IST date, not UTC, just after IST midnight on the 1st", () => {
    // 2026-10-31 19:00 UTC = 2026-11-01 00:30 IST
    expect(svc.currentMonthWindowIST(Date.UTC(2026, 9, 31, 19, 0))).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });
});

describe("open-item predicate", () => {
  it("treats a day with a locked attendance record as settled, and a missing record as filled once one exists", () => {
    expect(svc.ATTENDANCE_MISMATCH_OPEN_SQL).toContain("ari.resolved_at IS NULL");
    expect(svc.ATTENDANCE_MISMATCH_OPEN_SQL).toContain("NOT EXISTS");
    expect(svc.ATTENDANCE_MISMATCH_OPEN_SQL).toContain("adr.is_locked = 1");
    expect(svc.ATTENDANCE_MISMATCH_OPEN_SQL).toContain("ari.issue_type = 'missing_adr'");
  });
});

describe("summary count", () => {
  it("is bounded to the current month and counts only unsettled items", async () => {
    const block = await svc.getAttendanceMismatchBlock();
    const { sql, params } = issueCall();
    const win = svc.currentMonthWindowIST();
    expect(sql).toContain("ari.issue_date BETWEEN ? AND ?");
    expect(params).toEqual([win.from, win.to]);
    expect(sql).toContain(`CASE WHEN ${svc.ATTENDANCE_MISMATCH_OPEN_SQL} THEN 1 ELSE 0 END`);
    expect(block.grandTotal).toBe(7);
  });
});

describe("drill-down list (and its CSV)", () => {
  it("uses the same month and predicate as the count, for the requested branch", async () => {
    await svc.getAttendanceMismatchDetail(B);
    const { sql, params } = issueCall();
    const win = svc.currentMonthWindowIST();
    expect(params).toEqual([B, win.from, win.to]);
    expect(sql).toContain("ari.issue_date BETWEEN ? AND ?");
    expect(sql).toContain(svc.ATTENDANCE_MISMATCH_OPEN_SQL);
  });
  it("is not capped at 200 rows (NOIDA alone had 362 open items in October)", async () => {
    await svc.getAttendanceMismatchDetail(B);
    const limit = Number(/LIMIT (\d+)/.exec(issueCall().sql)?.[1]);
    expect(limit).toBeGreaterThanOrEqual(5000);
  });
});
