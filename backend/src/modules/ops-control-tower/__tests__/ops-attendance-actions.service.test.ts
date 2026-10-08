import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ execute: vi.fn(), heal: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => m.execute(...a) } }));
vi.mock("../../../shared/timezone.js", () => ({ nowIST: () => "2026-10-03T16:00:00" }));
vi.mock("../../wfm/attendance-heal.service.js", () => ({ healMissingAttendance: (...a: unknown[]) => m.heal(...a) }));

const { closeOldAttendanceIssues, closablePayrollMonths, runBackfill, getSyncHealth } = await import("../ops-attendance-actions.service.js");

beforeEach(() => { m.execute.mockReset(); m.heal.mockReset(); });

describe("closablePayrollMonths", () => {
  it("only months whose payroll is finished and has nothing still open", () => {
    expect(closablePayrollMonths([
      { month: "2026-06", status: "finalized" },
      { month: "2026-07", status: "locked" },
      { month: "2026-08", status: "processing" },
    ])).toEqual(["2026-06", "2026-07"]);
  });
  it("a month with ANY run still open is not closable, even if another run is locked", () => {
    expect(closablePayrollMonths([{ month: "2026-07", status: "locked" }, { month: "2026-07", status: "processing" }])).toEqual([]);
  });
  it("a month with no run, or only rejected / cancelled runs, is not closable", () => {
    expect(closablePayrollMonths([{ month: "2026-09", status: "cancelled" }, { month: "2026-10", status: "rejected" }])).toEqual([]);
    expect(closablePayrollMonths([])).toEqual([]);
  });
  it("a rejected run beside a locked one does not block the month", () => {
    expect(closablePayrollMonths([{ month: "2026-07", status: "locked" }, { month: "2026-07", status: "rejected" }])).toEqual(["2026-07"]);
  });
  it("status matching is case-insensitive", () => {
    expect(closablePayrollMonths([{ month: "2026-07", status: "LOCKED" }])).toEqual(["2026-07"]);
  });
});

describe("closeOldAttendanceIssues", () => {
  const RUNS = [[{ month: "2026-06", status: "finalized" }, { month: "2026-07", status: "locked" }, { month: "2026-08", status: "processing" }]];

  it("needs a real reason", async () => {
    for (const reason of ["", "  ", "no"]) {
      expect(await closeOldAttendanceIssues({ branchId: "b", reason, actorId: "u" })).toMatchObject({ ok: false, status: 400 });
    }
    expect(await closeOldAttendanceIssues({ branchId: "b", reason: "x".repeat(501), actorId: "u" })).toMatchObject({ ok: false, status: 400 });
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("closes only old items of active staff in months whose payroll is closed, and reports how many it left open", async () => {
    m.execute.mockResolvedValueOnce(RUNS).mockResolvedValueOnce([{ affectedRows: 42 }]).mockResolvedValueOnce([[{ n: 900 }]]);
    const out = await closeOldAttendanceIssues({ branchId: "b1", reason: "Payroll closed for the month", actorId: "u1", today: "2026-10-03" });
    expect(out).toEqual({ ok: true, closed: 42, leftOpen: 900, closableMonths: ["2026-06", "2026-07"] });
    const [sql, params] = m.execute.mock.calls[1];
    expect(String(sql)).toContain("ari.issue_date < ?");
    expect(String(sql)).toContain("e.active_status = 1");
    expect(String(sql)).toContain("ari.resolved_at IS NULL");
    expect(String(sql)).toContain("LEFT(CAST(ari.issue_date AS CHAR), 7) IN (?,?)");
    expect(params).toEqual(["u1", "Payroll closed for the month", "b1", "2026-09-26", "2026-06", "2026-07"]);
  });
  it("August (payroll still processing) and September (no run yet) are never in the closable list", async () => {
    m.execute.mockResolvedValueOnce(RUNS).mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[{ n: 0 }]]);
    await closeOldAttendanceIssues({ branchId: "b1", reason: "reviewed by HR", actorId: "u1", today: "2026-10-03" });
    const params = m.execute.mock.calls[1][1] as string[];
    expect(params).not.toContain("2026-08");
    expect(params).not.toContain("2026-09");
  });
  it("when no month is closed it closes nothing, writes nothing, and says how many remain", async () => {
    m.execute.mockResolvedValueOnce([[{ month: "2026-08", status: "processing" }]]).mockResolvedValueOnce([[{ n: 300 }]]);
    const out = await closeOldAttendanceIssues({ branchId: "b1", reason: "reviewed by HR", actorId: "u1", today: "2026-10-03" });
    expect(out).toEqual({ ok: true, closed: 0, leftOpen: 300, closableMonths: [] });
    expect(m.execute.mock.calls.some((c) => String(c[0]).includes("UPDATE attendance_reconciliation_issue"))).toBe(false);
  });
  it("uses an auto_fix_status value the ENUM allows ('skipped'), never a made-up one", async () => {
    m.execute.mockResolvedValueOnce(RUNS).mockResolvedValueOnce([{ affectedRows: 0 }]).mockResolvedValueOnce([[{ n: 0 }]]);
    await closeOldAttendanceIssues({ branchId: "b1", reason: "reviewed by HR", actorId: "u1" });
    const sql = String(m.execute.mock.calls[1][0]);
    expect(sql).toContain("auto_fix_status = 'skipped'");
    expect(sql).not.toContain("closed_by_hr");
  });
  it("keeps only known issue types and refuses a list with none", async () => {
    m.execute.mockResolvedValueOnce(RUNS).mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([[{ n: 0 }]]);
    await closeOldAttendanceIssues({ branchId: "b1", reason: "reviewed by HR", actorId: "u1", issueTypes: ["missing_adr", "'; DROP TABLE x; --"] });
    expect(m.execute.mock.calls[1][1].slice(-1)).toEqual(["missing_adr"]);
    expect(String(m.execute.mock.calls[1][0])).toContain("ari.issue_type IN (?)");
    expect(await closeOldAttendanceIssues({ branchId: "b1", reason: "reviewed by HR", actorId: "u1", issueTypes: ["bogus"] })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("runBackfill", () => {
  const base = { branchId: "b1", from: "2026-07-20", to: "2026-07-31", actorId: "u1", today: "2026-10-03" };
  const heal = { found: 559, truncated: false, processed: 0, failed: 0, byBranch: { b1: 559 }, byDate: { "2026-07-26": 559 }, errors: [], dryRun: true };

  it("rejects an invalid range before touching the database", async () => {
    expect(await runBackfill({ ...base, from: "2026-10-01", to: "2026-10-03", mode: "preview" })).toMatchObject({ ok: false, status: 400 });
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.heal).not.toHaveBeenCalled();
  });
  it("preview is a dry run, lists the payroll runs for the months touched, and says confirmation will be needed", async () => {
    m.execute.mockResolvedValueOnce([[{ month: "2026-07", status: "disbursed" }]]);
    m.heal.mockResolvedValueOnce(heal);
    const out = await runBackfill({ ...base, mode: "preview" });
    expect(out).toMatchObject({ ok: true, data: { found: 559, needsConfirmation: true, payrollRunsInRange: [{ month: "2026-07", status: "disbursed" }] } });
    expect(m.heal).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, branchId: "b1", from: "2026-07-20", to: "2026-07-31" }));
  });
  it("commit beyond the automatic window is refused without the exact phrase, and runs nothing", async () => {
    m.execute.mockResolvedValueOnce([[]]);
    for (const confirm of [undefined, "", "backfill", "yes"]) {
      m.execute.mockResolvedValueOnce([[]]);
      const out = await runBackfill({ ...base, mode: "commit", confirm });
      expect(out).toMatchObject({ ok: false, status: 409 });
    }
    expect(m.heal).not.toHaveBeenCalled();
  });
  it("commit with the phrase runs the heal for real, attributed to the approver", async () => {
    m.execute.mockResolvedValueOnce([[]]);
    m.heal.mockResolvedValueOnce({ ...heal, dryRun: false, processed: 559 });
    const out = await runBackfill({ ...base, mode: "commit", confirm: "BACKFILL" });
    expect(out).toMatchObject({ ok: true, data: { processed: 559 } });
    expect(m.heal).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, actor: "backfill:u1" }));
  });
  it("a recent range needs no phrase (it is inside the automatic window)", async () => {
    m.execute.mockResolvedValueOnce([[]]);
    m.heal.mockResolvedValueOnce({ ...heal, dryRun: false });
    expect(await runBackfill({ ...base, from: "2026-09-30", to: "2026-10-02", mode: "commit" })).toMatchObject({ ok: true });
  });
});

describe("getSyncHealth", () => {
  it("combines job runs and per-branch coverage, flagging a cut-off night", async () => {
    const now = Date.parse("2026-10-03T10:30:00Z");
    m.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM integration_sync_run")) return [[{ status: "completed", at: "2026-10-03T10:00:00Z", records_written: 120, records_failed: 0 }]];
      if (sql.includes("FROM worker_job_run")) return [[{ status: "completed", at: "2026-10-03T04:00:00Z", metadata: JSON.stringify({ found: 10, processed: 10, failed: 0 }) }]];
      if (sql.includes("FROM branch_master")) return [[{ id: "b1", branch_name: "NOIDA" }, { id: "b2", branch_name: "EMPTY" }]];
      if (sql.includes("COUNT(*) AS n FROM employees")) return [[{ branch_id: "b1", n: 420 }]];
      if (sql.includes("FROM attendance_daily_record adr")) return [[
        { branch_id: "b1", d: "2026-09-30", n: 430 }, { branch_id: "b1", d: "2026-10-01", n: 235 },
      ]];
      if (sql.includes("FROM apr WHERE ReportDate")) return [[
        { d: "2026-09-26", n: 190 }, { d: "2026-09-27", n: 150 }, { d: "2026-09-28", n: 195 },
        { d: "2026-09-29", n: 200 }, { d: "2026-09-30", n: 205 }, { d: "2026-10-01", n: 208 }, // 2026-10-02: no rows at all
      ]];
      return [[]];
    });
    const h = await getSyncHealth(now);
    expect(h.jobs.map((j) => j.key)).toEqual(["biometric", "engine", "heal", "reconciliation", "apr"]);
    expect(h.jobs[0]).toMatchObject({ tone: "ok", note: "120 day(s) written" });
    expect(h.jobs.find((j) => j.key === "heal")).toMatchObject({ note: "10 filled of 10 missing" });
    expect(h.coverage.map((b) => b.branchName)).toEqual(["NOIDA"]); // a branch with no active staff is left out
    const days = h.coverage[0]!.days;
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toBe("2026-09-25");
    expect(days[6]!.date).toBe("2026-10-01"); // the day before yesterday: yesterday is written at 23:00 tonight, so it is left out
    expect(days.find((d) => d.date === "2026-10-01")).toMatchObject({ records: 235, pct: 56, low: true });
    expect(days.find((d) => d.date === "2026-09-30")).toMatchObject({ pct: 100, low: false });
    expect(h.lowDays).toBe(5 + 1); // five days with no record at all, plus the 235 one
    // Dialler feed: 7 complete days up to yesterday; the day with no APR row at all is flagged.
    expect(h.aprFeed.map((d) => d.date)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(h.aprFeed.filter((d) => d.low).map((d) => d.date)).toEqual(["2026-10-02"]);
    expect(h.aprLowDays).toBe(1);
  });
  it("a job-run table that is missing reads as 'unknown' for that job, while the coverage data itself must load", async () => {
    m.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM integration_sync_run") || sql.includes("FROM worker_job_run")) throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
      if (sql.includes("FROM branch_master")) return [[]];
      return [[]];
    });
    const h = await getSyncHealth();
    expect(h.jobs.every((j) => j.tone === "unknown" && j.lastRunAt === null)).toBe(true);
    expect(h.coverage).toEqual([]);
  });
});
