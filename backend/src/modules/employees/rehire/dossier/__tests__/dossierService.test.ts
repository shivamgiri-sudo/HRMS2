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

  it("still returns a dossier when facts cannot be loaded, with no eligibility claim made up", async () => {
    m.loadRehireFacts.mockResolvedValue(null);
    const d = (await buildDossier(db() as never, "r1"))!;
    expect(d.eligibility.status).toBe("blocked");
    expect(d.eligibility.reasons[0]!.code).toBe("EMPLOYEE_NOT_FOUND");
  });
});
