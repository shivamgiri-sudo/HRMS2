import type { RowDataPacket } from "mysql2";
import { num, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface ConductSection {
  warnings: { id: string; date: string; category: string; severity: string; status: string; description: string | null }[];
  activeWarnings: number;
  finalWarnings: number;
  pips: { id: string; start: string; end: string | null; status: string; outcome: string | null; reason: string | null }[];
  /** status active or extended (pip_record has no 'open'). */
  openPip: boolean;
  unacknowledgedAlerts: number;
  completedCoachingSessions: number;
  /** HR's flag from employee_rehire_control; a super_admin lift is shown, not hidden. */
  disciplinaryFlag: { flagged: boolean; reason: string | null; date: string | null; lifted: boolean };
  priorAbscondingExits: number;
  priorRejoins: number;
  priorRejoinRequests: number;
}

const WARNING_SQL = `
  SELECT id, DATE_FORMAT(warning_date, '%Y-%m-%d') AS warning_date, category, severity, status, description
    FROM employee_warning
   WHERE employee_id = ?
   ORDER BY warning_date DESC
   LIMIT 50`;
const PIP_SQL = `
  SELECT id, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date,
         status, outcome, reason
    FROM pip_record
   WHERE employee_id = ?
   ORDER BY start_date DESC
   LIMIT 20`;
const ALERT_SQL = `SELECT COUNT(*) AS n FROM performance_alert WHERE employee_id = ? AND acknowledged = 0`;
const COACHING_SQL = `SELECT COUNT(*) AS n FROM coaching_session WHERE employee_id = ? AND status = 'completed'`;
const CONTROL_SQL = `
  SELECT disciplinary_flag, disciplinary_reason,
         DATE_FORMAT(disciplinary_flag_date, '%Y-%m-%d') AS disciplinary_flag_date, block_lifted_at
    FROM employee_rehire_control
   WHERE employee_id = ?`;
const ABSCOND_SQL = `
  SELECT COUNT(*) AS n FROM exit_request
   WHERE employee_id = ?
     AND (LOWER(exit_sub_type) IN ('absconding','abandonment') OR LOWER(exit_reason_category) = 'absconding')`;
const STINT_SQL = `SELECT COUNT(*) AS n FROM employment_stint WHERE employee_id = ? AND stint_no > 1`;
const STINT_EXCLUDING_SQL = `${STINT_SQL} AND (rejoin_request_id IS NULL OR rejoin_request_id <> ?)`;
const REQUEST_SQL = `SELECT COUNT(*) AS n FROM employee_reactivation_requests WHERE employee_id = ? AND status = 'approved'`;
const REQUEST_EXCLUDING_SQL = `${REQUEST_SQL} AND id <> ?`;

export interface ConductOptions {
  /**
   * For an approved request's dossier: leave out the stint (and the approved request) that this
   * very request produced, so "has rejoined before" reflects the record at decision time.
   */
  excludeRejoinRequestId?: string | null;
}

export async function loadConductSection(db: SqlExecutor, w: DossierWindow, opts: ConductOptions = {}): Promise<ConductSection> {
  const id = [w.employeeId];
  const exclude = opts.excludeRejoinRequestId ?? null;
  const rejoinSql = (base: string, excluding: string) =>
    exclude ? ([excluding, [w.employeeId, exclude]] as const) : ([base, id] as const);
  const [warnRows] = await db.execute<RowDataPacket[]>(WARNING_SQL, id);
  const [pipRows] = await db.execute<RowDataPacket[]>(PIP_SQL, id);
  const [alertRows] = await db.execute<RowDataPacket[]>(ALERT_SQL, id);
  const [coachRows] = await db.execute<RowDataPacket[]>(COACHING_SQL, id);
  const [ctlRows] = await db.execute<RowDataPacket[]>(CONTROL_SQL, id);
  const [abscondRows] = await db.execute<RowDataPacket[]>(ABSCOND_SQL, id);
  const [stintSql, stintParams] = rejoinSql(STINT_SQL, STINT_EXCLUDING_SQL);
  const [stintRows] = await db.execute<RowDataPacket[]>(stintSql, [...stintParams]);
  const [reqSql, reqParams] = rejoinSql(REQUEST_SQL, REQUEST_EXCLUDING_SQL);
  const [reqRows] = await db.execute<RowDataPacket[]>(reqSql, [...reqParams]);

  const warnings = warnRows.map((r) => ({
    id: String(r.id),
    date: String(r.warning_date),
    category: String(r.category),
    severity: String(r.severity),
    status: String(r.status),
    description: r.description ?? null,
  }));
  const active = warnings.filter((x) => x.status === "active");
  const pips = pipRows.map((r) => ({
    id: String(r.id),
    start: String(r.start_date),
    end: r.end_date ?? null,
    status: String(r.status),
    outcome: r.outcome ?? null,
    reason: r.reason ?? null,
  }));
  const ctl = ctlRows[0];

  return {
    warnings,
    activeWarnings: active.length,
    finalWarnings: active.filter((x) => x.severity === "final").length,
    pips,
    openPip: pips.some((p) => p.status === "active" || p.status === "extended"),
    unacknowledgedAlerts: num(alertRows[0]?.n),
    completedCoachingSessions: num(coachRows[0]?.n),
    disciplinaryFlag: {
      flagged: Number(ctl?.disciplinary_flag) === 1,
      reason: ctl?.disciplinary_reason ?? null,
      date: ctl?.disciplinary_flag_date ?? null,
      lifted: ctl?.block_lifted_at != null,
    },
    priorAbscondingExits: num(abscondRows[0]?.n),
    priorRejoins: num(stintRows[0]?.n),
    priorRejoinRequests: num(reqRows[0]?.n),
  };
}
