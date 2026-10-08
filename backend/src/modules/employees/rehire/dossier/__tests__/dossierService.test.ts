import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  loadRehireFacts: vi.fn(),
  header: vi.fn(), attendance: vi.fn(), kpi: vi.fn(), leave: vi.fn(), learning: vi.fn(),
  conduct: vi.fn(), exit: vi.fn(), payroll: vi.fn(), timeline: vi.fn(),
}));
vi.mock("../../rehireFacts.js", async (orig) => ({ ...(await orig<typeof import("../../rehireFacts.js")>()), loadRehireFacts: m.loadRehireFacts }));
vi.mock("../dossier.header.js", () => ({ loadHeaderSection: m.header }));
vi.mock("../dossier.attendance.js", () => ({ loadAttendanceSection: m.attendance }));
vi.mock("../dossier.kpi.js", () => ({ loadKpiSection: m.kpi }));
vi.mock("../dossier.people.js", () => ({ loadLeaveSection: m.leave, loadLearningSection: m.learning }));
vi.mock("../dossier.conduct.js", () => ({ loadConductSection: m.conduct }));
vi.mock("../dossier.exit.js", () => ({ loadExitSection: m.exit }));
vi.mock("../dossier.payroll.js", () => ({ loadPayrollSection: m.payroll }));
vi.mock("../dossier.timeline.js", () => ({ loadTimelineSection: m.timeline }));

const { buildDossier } = await import("../dossierService.js");

const requestRow = {
  id: "r1", employee_id: "e1", status: "pending", proposed_joining_date: "2026-09-20",
  reinstatement_reason: "Good record", raised_by_role: "hr", gap_days: 10,
};
const facts = {
  exitRequestId: "x1", previousEndDate: "2026-09-10", ffAlreadyPaid: false,
  facts: { hasExitRecord: true, exitType: "voluntary", exitSubType: "resignation", exitReasonCategory: "relocation", legacyStatusText: "Resigned",
    disciplinaryFlag: false, blockLifted: false, gapDays: 10, priorRejoinCount: 0, totalAbscondingExits: 0,
    openClearanceCase: false, assetsUnreturned: false, ffAlreadyPaid: false },
};
const attendance = { months: [], totals: {}, attendancePct: 96, regularizations: { total: 0, approved: 0, rejected: 0, pending: 0 }, late: { totalLateMarks: 2, avgLateMarksPerMonth: 1, avgLateMinutes: 10, worstMonth: null } };
const kpi = { months: [], monthsWithData: 10, monthsAtTarget: 9, atTargetPct: 90, best: null, worst: null };
const conduct = { warnings: [], activeWarnings: 0, finalWarnings: 0, pips: [], openPip: false, unacknowledgedAlerts: 0, completedCoachingSessions: 0, disciplinaryFlag: { flagged: false, reason: null, date: null, lifted: false }, priorAbscondingExits: 0, priorRejoins: 0, priorRejoinRequests: 0 };

function db(rows: unknown[] = [requestRow]) {
  return { execute: vi.fn(async () => [rows, []]) };
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.loadRehireFacts.mockResolvedValue(facts);
  m.header.mockResolvedValue({ tenureMonths: 14 });
  m.attendance.mockResolvedValue(attendance);
  m.kpi.mockResolvedValue(kpi);
  m.leave.mockResolvedValue({});
  m.learning.mockResolvedValue({});
  m.conduct.mockResolvedValue(conduct);
  m.exit.mockResolvedValue(null);
  m.payroll.mockResolvedValue({});
  m.timeline.mockResolvedValue({ events: [], skipped: [] });
});

describe("buildDossier", () => {
  it("returns null for an unknown request", async () => {
    expect(await buildDossier(db([]) as never, "nope")).toBeNull();
  });

  it("assembles every section, the fresh eligibility, and a verdict", async () => {
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.request).toMatchObject({ id: "r1", employeeId: "e1", status: "pending", raisedByRole: "hr", gapDays: 10 });
    expect(d.eligibility.status).toBe("eligible");
    expect(d.verdict.rating).toBe("strong");
    expect(Object.keys(d.sections).sort()).toEqual(["attendance", "conduct", "exit", "header", "kpi", "learning", "leave", "payroll", "timeline"]);
    expect(d.sections.attendance).toEqual({ status: "ok", data: attendance });
  });

  it("uses the last day of the previous stint as the end of the window", async () => {
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.window.end).toBe("2026-09-10");
    expect(d.window.months).toHaveLength(12);
    expect(m.attendance.mock.calls[0]![1].end).toBe("2026-09-10");
  });

  it("isolates a failing section: it reports an error, the others still load", async () => {
    m.kpi.mockRejectedValue(new Error("kpi down"));
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.sections.kpi).toEqual({ status: "error", error: "kpi down" });
    expect(d.sections.attendance.status).toBe("ok");
    expect(d.verdict.rating).toBeDefined();
  });

  it("evaluates eligibility fresh: a blocked employee shows blocked even if the request was raised earlier", async () => {
    m.loadRehireFacts.mockResolvedValue({ ...facts, facts: { ...facts.facts, exitSubType: "termination" } });
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.eligibility.status).toBe("blocked");
  });

  it("feeds conduct into the verdict: a final warning makes it weak", async () => {
    m.conduct.mockResolvedValue({ ...conduct, activeWarnings: 1, finalWarnings: 1 });
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.verdict.rating).toBe("weak");
  });

  it("falls back to today when there is no previous end date", async () => {
    m.loadRehireFacts.mockResolvedValue({ ...facts, previousEndDate: null });
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.window.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("builds for a legacy 'branch_head_approved' request that predates raised_by_role", async () => {
    const legacy = { ...requestRow, status: "branch_head_approved", raised_by_role: null, gap_days: null };
    const d = (await buildDossier(db([legacy]) as never, "r1"))!;
    expect(d.request).toMatchObject({ status: "branch_head_approved", raisedByRole: null, gapDays: 0 });
    expect(d.eligibility.status).toBe("eligible");
  });

  it("still returns a dossier when facts cannot be loaded, with no eligibility claim made up", async () => {
    m.loadRehireFacts.mockResolvedValue(null);
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.eligibility.status).toBe("blocked");
    expect(d.eligibility.reasons[0]!.code).toBe("EMPLOYEE_NOT_FOUND");
  });
});

// ── A closed (approved) request: the dossier shows the record at decision time ─────────────
// After approval, activation sets employees.date_of_exit = NULL and the exit becomes 'rejoined',
// so live facts no longer describe the stint that was judged. The window must end on the
// predecessor stint's end, eligibility must be the snapshot stored when the request was raised,
// and conduct must not count the rejoin this very request produced.

const snapshot = { status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false };
const postRejoinFacts = {
  exitRequestId: null, previousEndDate: null, ffAlreadyPaid: false,
  facts: { ...facts.facts, hasExitRecord: false, exitType: null, exitSubType: null, exitReasonCategory: null,
    legacyStatusText: "Active", priorRejoinCount: 1, gapDays: 0 },
};
const approvedRow = { ...requestRow, status: "approved", exit_request_id: "x1", eligibility_snapshot: snapshot };

type Rows = Record<string, unknown>[];
/** Routes each query by a substring of its SQL; anything unmatched returns no rows. */
function dbBy(map: { request: Rows; stint?: Rows | Error; exit?: Rows | Error }) {
  return {
    execute: vi.fn(async (sql: string) => {
      if (sql.includes("FROM employee_reactivation_requests")) return [map.request, []];
      if (sql.includes("employment_stint")) {
        if (map.stint instanceof Error) throw map.stint;
        return [map.stint ?? [], []];
      }
      if (sql.includes("FROM exit_request")) {
        if (map.exit instanceof Error) throw map.exit;
        return [map.exit ?? [], []];
      }
      return [[], []];
    }),
  };
}

describe("buildDossier for an approved (closed) request", () => {
  beforeEach(() => { m.loadRehireFacts.mockResolvedValue(postRejoinFacts); });

  it("ends the window on the predecessor stint's end date, not today", async () => {
    const ex = dbBy({ request: [approvedRow], stint: [{ stint_no: 2, prev_end: "2026-09-24", prev_exit_lwd: "2026-09-20" }] });
    const d = (await buildDossier(ex as never, "r1"))!;
    expect(d.window.end).toBe("2026-09-24");
    expect(d.window.start).toBe("2025-10-01");
    expect(m.attendance.mock.calls[0]![1].end).toBe("2026-09-24");
    const stintCall = ex.execute.mock.calls.find(([sql]) => String(sql).includes("employment_stint"))!;
    expect(String(stintCall[0])).toContain("rejoin_request_id = ?");
    expect(stintCall[1]).toEqual(["r1"]);
  });

  it("falls back to the predecessor's exit last working day when its end_date is missing", async () => {
    const ex = dbBy({ request: [approvedRow], stint: [{ stint_no: 2, prev_end: null, prev_exit_lwd: "2026-09-20" }] });
    const d = (await buildDossier(ex as never, "r1"))!;
    expect(d.window.end).toBe("2026-09-20");
  });

  it("falls back to the request's own exit when there is no stint row", async () => {
    const ex = dbBy({ request: [approvedRow], stint: [], exit: [{ lwd: "2026-09-18" }] });
    const d = (await buildDossier(ex as never, "r1"))!;
    expect(d.window.end).toBe("2026-09-18");
  });

  it("falls back to today without throwing when neither stint nor exit can be read", async () => {
    const ex = dbBy({ request: [{ ...approvedRow, exit_request_id: null }], stint: new Error("no such table") });
    const d = (await buildDossier(ex as never, "r1"))!;
    expect(d.window.end).toBe(new Date().toISOString().slice(0, 10));
    expect(d.eligibility).toEqual(snapshot);
  });

  it("shows the eligibility snapshot stored when the request was raised", async () => {
    const ex = dbBy({ request: [approvedRow], stint: [{ stint_no: 2, prev_end: "2026-09-24", prev_exit_lwd: null }] });
    const d = (await buildDossier(ex as never, "r1"))!;
    expect(d.eligibility).toEqual(snapshot);
    expect(d.eligibility.reasons.map((r) => r.code)).not.toContain("NO_EXIT_SIGNAL");
  });

  it("accepts the snapshot as a JSON string (mysql2 may return either)", async () => {
    const review = { status: "review", reasons: [{ code: "ABSCONDING", severity: "review", message: "Left by absconding" }], requiresFreshOnboarding: false, requiresAbscondingAck: true };
    const ex = dbBy({ request: [{ ...approvedRow, eligibility_snapshot: JSON.stringify(review) }], stint: [{ stint_no: 2, prev_end: "2026-09-24", prev_exit_lwd: null }] });
    const d = (await buildDossier(ex as never, "r1"))!;
    expect(d.eligibility).toEqual(review);
  });

  it("without a usable snapshot, evaluates live but does not count the request's own rejoin", async () => {
    m.loadRehireFacts.mockResolvedValue({ ...facts, facts: { ...facts.facts, priorRejoinCount: 1 } });
    for (const bad of [null, "not json", { foo: 1 }]) {
      const ex = dbBy({ request: [{ ...approvedRow, eligibility_snapshot: bad }], stint: [{ stint_no: 2, prev_end: "2026-09-24", prev_exit_lwd: null }] });
      const d = (await buildDossier(ex as never, "r1"))!;
      expect(d.eligibility.status).toBe("eligible");
      expect(d.eligibility.reasons.map((r) => r.code)).not.toContain("PREVIOUS_REJOIN");
    }
  });

  it("passes the request id to conduct so its own stint is excluded", async () => {
    const ex = dbBy({ request: [approvedRow], stint: [{ stint_no: 2, prev_end: "2026-09-24", prev_exit_lwd: null }] });
    await buildDossier(ex as never, "r1");
    expect(m.conduct.mock.calls[0]![2]).toEqual({ excludeRejoinRequestId: "r1" });
  });
});

describe("buildDossier for requests that are not approved stays as it was", () => {
  it.each(["pending", "branch_head_approved", "rejected", "cancelled"])("%s: fresh eligibility, live window, no exclusion", async (status) => {
    const stale = { status: "review", reasons: [{ code: "OPEN_CLEARANCE", severity: "review", message: "x" }], requiresFreshOnboarding: false, requiresAbscondingAck: false };
    const ex = dbBy({ request: [{ ...requestRow, status, exit_request_id: "x1", eligibility_snapshot: stale }], stint: [{ stint_no: 2, prev_end: "2026-01-01", prev_exit_lwd: null }] });
    const d = (await buildDossier(ex as never, "r1"))!;
    expect(d.window.end).toBe("2026-09-10");
    expect(d.eligibility.status).toBe("eligible");
    expect(m.conduct.mock.calls[0]![2]).toBeUndefined();
    expect(ex.execute.mock.calls.some(([sql]) => String(sql).includes("employment_stint"))).toBe(false);
  });
});
