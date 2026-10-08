import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  execute: vi.fn(),
  processEmployee: vi.fn(),
  upsertDailyRecord: vi.fn(),
  getExceptionBucketMap: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => m.execute(...a) } }));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../shared/timezone.js", () => ({ nowIST: () => "2026-10-03T16:00:00" }));
vi.mock("../attendance-engine.service.js", () => ({
  attendanceEngineService: {
    processEmployee: (...a: unknown[]) => m.processEmployee(...a),
    upsertDailyRecord: (...a: unknown[]) => m.upsertDailyRecord(...a),
    getExceptionBucketMap: (...a: unknown[]) => m.getExceptionBucketMap(...a),
  },
}));

const { findMissingPersonDays, healMissingAttendance, resolveFilledGaps, runAutomaticHeal } = await import("../attendance-heal.service.js");

const row = (id: string, code: string, branch: string | null, date: string) => ({ employee_id: id, employee_code: code, branch_id: branch, record_date: date });

beforeEach(() => {
  m.execute.mockReset();
  m.processEmployee.mockReset().mockResolvedValue({ employeeId: "x" });
  m.upsertDailyRecord.mockReset().mockResolvedValue({});
  m.getExceptionBucketMap.mockReset().mockResolvedValue(new Map());
});

describe("findMissingPersonDays", () => {
  it("passes the window, optional branch and limit in the right placeholder order, and leaves leavers out", async () => {
    m.execute.mockResolvedValueOnce([[row("e1", "M1", "b1", "2026-07-26")]]);
    const out = await findMissingPersonDays({ from: "2026-07-20", to: "2026-07-31", branchId: "b1", limit: 100 });
    const [sql, params] = m.execute.mock.calls[0];
    expect(params).toEqual(["2026-07-20", "2026-07-31", "2026-07-20", "2026-07-20", "2026-07-31", "b1", 101]);
    expect(String(sql)).toContain("e.active_status = 1");
    expect(String(sql)).toContain("NOT EXISTS");
    expect(String(sql)).toContain("AND e.branch_id = ?");
    expect(out).toEqual({ rows: [{ employeeId: "e1", employeeCode: "M1", branchId: "b1", date: "2026-07-26" }], truncated: false });
  });
  it("reports truncation when more than the cap exist, and never exceeds the hard cap", async () => {
    m.execute.mockResolvedValueOnce([[row("a", "1", "b", "2026-07-26"), row("b", "2", "b", "2026-07-26"), row("c", "3", "b", "2026-07-26")]]);
    const out = await findMissingPersonDays({ from: "2026-07-26", to: "2026-07-26", limit: 2 });
    expect(out.rows).toHaveLength(2);
    expect(out.truncated).toBe(true);
    m.execute.mockResolvedValueOnce([[]]);
    await findMissingPersonDays({ from: "2026-07-26", to: "2026-07-26", limit: 999999 });
    expect(m.execute.mock.calls[1][1].at(-1)).toBe(5001);
  });
});

describe("healMissingAttendance", () => {
  it("a dry run reports what it found and writes nothing", async () => {
    m.execute.mockResolvedValueOnce([[row("e1", "M1", "b1", "2026-07-26"), row("e2", "M2", "b1", "2026-07-26")]]);
    const r = await healMissingAttendance({ from: "2026-07-26", to: "2026-07-26", dryRun: true });
    expect(r).toMatchObject({ found: 2, processed: 0, failed: 0, dryRun: true, byBranch: { b1: 2 }, byDate: { "2026-07-26": 2 } });
    expect(m.processEmployee).not.toHaveBeenCalled();
    expect(m.upsertDailyRecord).not.toHaveBeenCalled();
  });
  it("fills each missing person-day with the engine and records who did it", async () => {
    m.execute.mockResolvedValueOnce([[row("e1", "M1", "b1", "2026-07-26"), row("e2", "M2", "b1", "2026-07-27")]]).mockResolvedValue([{ affectedRows: 0 }]);
    const r = await healMissingAttendance({ from: "2026-07-26", to: "2026-07-27", actor: "backfill:u9" });
    expect(r.processed).toBe(2);
    expect(m.processEmployee).toHaveBeenCalledWith("e1", "2026-07-26", null);
    expect(m.upsertDailyRecord).toHaveBeenCalledWith(expect.anything(), "backfill:u9");
  });
  it("one failing person does not stop the rest, and is reported by code and date", async () => {
    m.execute.mockResolvedValueOnce([[row("e1", "M1", "b", "2026-07-26"), row("e2", "M2", "b", "2026-07-26")]]).mockResolvedValue([{ affectedRows: 0 }]);
    m.processEmployee.mockRejectedValueOnce(new Error("no rule")).mockResolvedValue({});
    const r = await healMissingAttendance({ from: "2026-07-26", to: "2026-07-26" });
    expect(r.processed).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toContain("M1/2026-07-26");
  });
  it("closes the gap items it just filled", async () => {
    m.execute.mockResolvedValueOnce([[row("e1", "M1", "b", "2026-07-26")]]).mockResolvedValue([{ affectedRows: 1 }]);
    await healMissingAttendance({ from: "2026-07-26", to: "2026-07-26" });
    expect(m.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE attendance_reconciliation_issue"))).toBe(true);
  });
});

describe("resolveFilledGaps", () => {
  it("only closes missing_adr items whose record now exists, of any age", async () => {
    m.execute.mockResolvedValueOnce([{ affectedRows: 7 }]);
    expect(await resolveFilledGaps()).toBe(7);
    const sql = String(m.execute.mock.calls[0][0]);
    expect(sql).toContain("issue_type = 'missing_adr'");
    expect(sql).toContain("JOIN attendance_daily_record adr");
    expect(sql).toContain("auto_fix_status = 'fixed'");
    expect(sql).not.toMatch(/issue_date\s*[<>]/); // no age restriction
  });
});

describe("runAutomaticHeal closes filled gap items even when nothing is missing", () => {
  it("runs the closer when the window is already complete", async () => {
    m.execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ affectedRows: 3 }]);
    await runAutomaticHeal();
    expect(m.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE attendance_reconciliation_issue"))).toBe(true);
  });
  it("a failing closer never breaks the repair run", async () => {
    m.execute.mockResolvedValueOnce([[]]).mockRejectedValueOnce(new Error("lock wait"));
    await expect(runAutomaticHeal()).resolves.toMatchObject({ found: 0 });
  });
});

describe("runAutomaticHeal", () => {
  it("covers the last 7 complete days ending yesterday", async () => {
    m.execute.mockResolvedValueOnce([[]]);
    await runAutomaticHeal();
    expect(m.execute.mock.calls[0][1].slice(0, 2)).toEqual(["2026-09-26", "2026-10-02"]);
  });
});
