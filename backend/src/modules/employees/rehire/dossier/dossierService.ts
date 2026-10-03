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
  /** Evaluated fresh from live facts, not the snapshot stored when the request was raised. */
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
         reinstatement_reason, raised_by_role, gap_days
    FROM employee_reactivation_requests
   WHERE id = ?`;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const UNKNOWN_EMPLOYEE: RehireVerdict = {
  status: "blocked",
  reasons: [{ code: "EMPLOYEE_NOT_FOUND", severity: "blocked", message: "The employee record could not be loaded." }],
  requiresFreshOnboarding: false,
  requiresAbscondingAck: false,
};

export async function buildDossier(db: SqlExecutor, requestId: string): Promise<Dossier | null> {
  const [reqRows] = await db.execute<RowDataPacket[]>(REQUEST_SQL, [requestId]);
  const req = reqRows[0];
  if (!req) return null;
  const employeeId = String(req.employee_id);

  const loaded = await loadRehireFacts(db, employeeId, String(req.proposed_joining_date));
  const eligibility = loaded ? evaluateRehire(loaded.facts) : UNKNOWN_EMPLOYEE;

  // The window ends on the last day of the previous stint: the branch head is judging how this person
  // performed before leaving, not how they look today.
  const w = buildWindow(employeeId, loaded?.previousEndDate ?? todayIso(), 12);

  // Sequential on purpose: one connection, and a failing section must not abort the others.
  const header = await settle(() => loadHeaderSection(db, w));
  const attendance = await settle(() => loadAttendanceSection(db, w));
  const kpi = await settle(() => loadKpiSection(db, w));
  const leave = await settle(() => loadLeaveSection(db, w));
  const learning = await settle(() => loadLearningSection(db, w));
  const conduct = await settle(() => loadConductSection(db, w));
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
