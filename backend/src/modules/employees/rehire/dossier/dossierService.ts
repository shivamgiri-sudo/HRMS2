import type { RowDataPacket } from "mysql2";
import { evaluateRehire, type RehireVerdict } from "../rehireEligibility.js";
import { loadRehireFacts } from "../rehireFacts.js";
import { loadAttendanceSection } from "./dossier.attendance.js";
import { loadConductSection } from "./dossier.conduct.js";
import { loadExitSection } from "./dossier.exit.js";
import { loadHeaderSection } from "./dossier.header.js";
import { loadKpiSection } from "./dossier.kpi.js";
import { loadLeaveSection, loadLearningSection } from "./dossier.people.js";
import { loadPayrollSection } from "./dossier.payroll.js";
import { loadTimelineSection } from "./dossier.timeline.js";
import { buildVerdict, type DossierVerdict } from "./dossierVerdict.js";
import { buildWindow, settle, type SectionResult, type SqlExecutor } from "./dossierTypes.js";

import type { AttendanceSection } from "./dossier.attendance.js";
import type { ConductSection } from "./dossier.conduct.js";
import type { ExitSection } from "./dossier.exit.js";
import type { HeaderSection } from "./dossier.header.js";
import type { KpiSection } from "./dossier.kpi.js";
import type { LeaveSection, LearningSection } from "./dossier.people.js";
import type { PayrollSection } from "./dossier.payroll.js";
import type { TimelineSection } from "./dossier.timeline.js";

export interface Dossier {
  request: {
    id: string;
    employeeId: string;
    status: string;
    proposedJoiningDate: string;
    reason: string;
    raisedByRole: string | null;
    gapDays: number;
  };
  window: { start: string; end: string; months: string[] };
  /**
   * Open requests: evaluated fresh from live facts. An approved request: the snapshot stored when it
   * was raised (after activation the person is Active and a live evaluation means nothing).
   */
  eligibility: RehireVerdict;
  /** Advisory only. */
  verdict: DossierVerdict;
  sections: {
    header: SectionResult<HeaderSection | null>;
    attendance: SectionResult<AttendanceSection>;
    kpi: SectionResult<KpiSection>;
    leave: SectionResult<LeaveSection>;
    learning: SectionResult<LearningSection>;
    conduct: SectionResult<ConductSection>;
    exit: SectionResult<ExitSection | null>;
    payroll: SectionResult<PayrollSection>;
    timeline: SectionResult<TimelineSection>;
  };
  generatedAt: string;
}

const REQUEST_SQL = `
  SELECT id, employee_id, status, DATE_FORMAT(proposed_joining_date, '%Y-%m-%d') AS proposed_joining_date,
         reinstatement_reason, raised_by_role, gap_days, exit_request_id, eligibility_snapshot
    FROM employee_reactivation_requests
   WHERE id = ?`;

// The stint this request opened, and how the stint before it ended. That end is the last working day
// the branch head was judging; employees.date_of_exit is NULL after activation.
const OWN_STINT_SQL = `
  SELECT s.stint_no,
         DATE_FORMAT(p.end_date, '%Y-%m-%d') AS prev_end,
         DATE_FORMAT(COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed), '%Y-%m-%d') AS prev_exit_lwd
    FROM employment_stint s
    LEFT JOIN employment_stint p ON p.employee_id = s.employee_id AND p.stint_no = s.stint_no - 1
    LEFT JOIN exit_request x ON x.id = p.end_exit_request_id
   WHERE s.rejoin_request_id = ?
   LIMIT 1`;
const REQUEST_EXIT_SQL = `
  SELECT DATE_FORMAT(COALESCE(last_working_day_confirmed, last_working_day_proposed), '%Y-%m-%d') AS lwd
    FROM exit_request
   WHERE id = ?`;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const UNKNOWN_EMPLOYEE: RehireVerdict = {
  status: "blocked",
  reasons: [{ code: "EMPLOYEE_NOT_FOUND", severity: "blocked", message: "The employee record could not be loaded." }],
  requiresFreshOnboarding: false,
  requiresAbscondingAck: false,
};

/** mysql2 returns a JSON column as an object; tolerate a string. Anything not verdict-shaped is ignored. */
function parseSnapshot(raw: unknown): RehireVerdict | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<RehireVerdict>;
  if (typeof o.status !== "string" || !Array.isArray(o.reasons)) return null;
  return v as RehireVerdict;
}

const isoDate = (v: unknown): string | null =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

/**
 * For an approved request: the last working day of the stint that preceded the rejoin, and whether
 * the request's own stint exists. Lookup failures fall back (never throw): the page must still load.
 */
async function closedRequestFacts(
  db: SqlExecutor,
  requestId: string,
  exitRequestId: string | null,
): Promise<{ endDate: string | null; ownStint: boolean }> {
  let endDate: string | null = null;
  let ownStint = false;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(OWN_STINT_SQL, [requestId]);
    const s = rows[0];
    if (s) {
      ownStint = true;
      endDate = isoDate(s.prev_end) ?? isoDate(s.prev_exit_lwd);
    }
  } catch { /* fall through */ }
  if (!endDate && exitRequestId) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(REQUEST_EXIT_SQL, [exitRequestId]);
      endDate = isoDate(rows[0]?.lwd);
    } catch { /* fall through */ }
  }
  return { endDate, ownStint };
}

export async function buildDossier(db: SqlExecutor, requestId: string): Promise<Dossier | null> {
  const [reqRows] = await db.execute<RowDataPacket[]>(REQUEST_SQL, [requestId]);
  const req = reqRows[0];
  if (!req) return null;
  const employeeId = String(req.employee_id);
  // An approved request is closed: activation has already changed the facts it was decided on
  // ('rejoined' exit, date_of_exit NULL, a new stint). Show the record as it was at decision time.
  const closed = String(req.status) === "approved";

  const loaded = await loadRehireFacts(db, employeeId, String(req.proposed_joining_date));
  const atDecision = closed
    ? await closedRequestFacts(db, String(req.id), req.exit_request_id ? String(req.exit_request_id) : null)
    : null;

  let eligibility: RehireVerdict;
  const snapshot = closed ? parseSnapshot(req.eligibility_snapshot) : null;
  if (snapshot) {
    eligibility = snapshot;
  } else if (!loaded) {
    eligibility = UNKNOWN_EMPLOYEE;
  } else if (atDecision?.ownStint) {
    // Live fallback for an approved request with no stored snapshot: its own rejoin is not "before".
    eligibility = evaluateRehire({ ...loaded.facts, priorRejoinCount: Math.max(0, loaded.facts.priorRejoinCount - 1) });
  } else {
    eligibility = evaluateRehire(loaded.facts);
  }

  // The window ends on the last day of the previous stint: the branch head is judging how this person
  // performed before leaving, not how they look today.
  const windowEnd = atDecision ? atDecision.endDate : loaded?.previousEndDate;
  const w = buildWindow(employeeId, windowEnd ?? todayIso(), 12);

  // Sequential on purpose: one connection, and a failing section must not abort the others.
  const header = await settle(() => loadHeaderSection(db, w));
  const attendance = await settle(() => loadAttendanceSection(db, w));
  const kpi = await settle(() => loadKpiSection(db, w));
  const leave = await settle(() => loadLeaveSection(db, w));
  const learning = await settle(() => loadLearningSection(db, w));
  const conduct = await settle(() =>
    closed ? loadConductSection(db, w, { excludeRejoinRequestId: String(req.id) }) : loadConductSection(db, w));
  const exit = await settle(() => loadExitSection(db, w));
  const payroll = await settle(() => loadPayrollSection(db, w));
  const timeline = await settle(() => loadTimelineSection(db, w));

  const att = attendance.status === "ok" ? attendance.data : null;
  const k = kpi.status === "ok" ? kpi.data : null;
  const c = conduct.status === "ok" ? conduct.data : null;
  const h = header.status === "ok" ? header.data : null;

  const verdict = buildVerdict({
    attendancePct: att?.attendancePct ?? null,
    avgLateMarksPerMonth: att?.late.avgLateMarksPerMonth ?? null,
    kpiMonthsAtTargetPct: k?.atTargetPct ?? null,
    kpiMonthsWithData: k?.monthsWithData ?? 0,
    activeWarnings: c?.activeWarnings ?? 0,
    finalWarnings: c?.finalWarnings ?? 0,
    openPip: c?.openPip ?? false,
    priorAbsconding: (c?.priorAbscondingExits ?? 0) > 0,
    tenureMonths: h?.tenureMonths ?? null,
  });

  return {
    request: {
      id: String(req.id),
      employeeId,
      status: String(req.status),
      proposedJoiningDate: String(req.proposed_joining_date),
      reason: String(req.reinstatement_reason ?? ""),
      raisedByRole: req.raised_by_role ?? null,
      gapDays: Number(req.gap_days ?? 0),
    },
    window: { start: w.start, end: w.end, months: w.months },
    eligibility,
    verdict,
    sections: { header, attendance, kpi, leave, learning, conduct, exit, payroll, timeline },
    generatedAt: new Date().toISOString(),
  };
}
