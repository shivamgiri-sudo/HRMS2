import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { PRESENT_SESSION_STATUSES } from "../../shared/attendanceStatus.js";
import { memo } from "./ops-command.cache.js";
import { EXIT_IGNORED_STATUSES, EXIT_OPEN_STATUSES, EXIT_PENDING_STATUSES } from "./ops-command.definitions.js";
import { num, numOrNull, realRoster, rosterWorking } from "./ops-command.context.js";

/**
 * Org-wide fact loaders. Each is a single indexed range scan over one table, memoised for a few minutes and shared
 * by every endpoint. Nothing here is scope-aware — callers must filter through the scoped employee view.
 */
const q = (sql: string, params: unknown[] = []) => db.execute<RowDataPacket[]>(sql, params).then(([r]) => r);
const inList = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

const timeout = <T>(p: Promise<T>, ms = 8000) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export interface AdrRow {
  eid: string;
  d: string;
  st: string;
  late: boolean;
  mins: number | null;
  mismatch: boolean;
}

/** Attendance rows for a date window. Served by idx_ops_adr_cover (covering) once migration 1915 is applied. */
export function adrRows(from: string, to: string): Promise<AdrRow[]> {
  return memo(`adr|${from}|${to}`, async () => {
    const rows = await q(
      `SELECT employee_id AS eid, DATE_FORMAT(record_date,'%Y-%m-%d') AS d, attendance_status AS st, late_mark AS lm,
              COALESCE(raw_minutes, biometric_minutes, dialler_minutes) AS mins,
              (mismatch_flag = 1 AND mismatch_resolved_at IS NULL) AS mm
         FROM attendance_daily_record WHERE record_date BETWEEN ? AND ?`,
      [from, to],
    );
    return rows.map((r) => ({ eid: String(r.eid), d: String(r.d), st: String(r.st), late: Number(r.lm) === 1, mins: numOrNull(r.mins), mismatch: Number(r.mm) === 1 }));
  });
}

export interface RosterRow {
  eid: string;
  d: string;
  working: boolean;
  weekoff: boolean;
  training: boolean;
  published: boolean;
  ackPending: boolean;
  ackRejected: boolean;
  minutes: number;
}

/** Raw roster rows for a window (index: idx_roster_date). Adherence is joined to attendance in memory by the caller. */
export function rosterRows(from: string, to: string): Promise<RosterRow[]> {
  return memo(`roster|${from}|${to}`, async () => {
    const W = rosterWorking("ra");
    const rows = await q(
      `SELECT ra.employee_id AS eid, DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d, ${W} AS w,
              (COALESCE(ra.is_week_off,0) = 1 OR COALESCE(ra.assignment_type,'') = 'WEEK_OFF') AS wo,
              (COALESCE(ra.assignment_type,'') = 'TRAINING') AS tr, (ra.publish_status = 'published') AS pub,
              (ra.employee_ack_status = 'pending') AS ap, (ra.employee_ack_status = 'rejected') AS ar,
              COALESCE(ra.scheduled_minutes,0) AS mins
         FROM wfm_roster_assignment ra
        WHERE ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}`,
      [from, to],
    );
    return rows.map((r) => ({
      eid: String(r.eid), d: String(r.d), working: num(r.w) === 1, weekoff: num(r.wo) === 1, training: num(r.tr) === 1,
      published: num(r.pub) === 1, ackPending: num(r.ap) === 1, ackRejected: num(r.ar) === 1, minutes: num(r.mins),
    }));
  });
}

/** Employees that have at least one real roster row in the window. */
export function rosteredEmployees(from: string, to: string): Promise<Set<string>> {
  return memo(`rostered|${from}|${to}`, async () => {
    const rows = await q(`SELECT DISTINCT ra.employee_id AS eid FROM wfm_roster_assignment ra WHERE ra.roster_date BETWEEN ? AND ? AND ${realRoster("ra")}`, [from, to]);
    return new Set(rows.map((r) => String(r.eid)));
  });
}

export interface ExitReq {
  eid: string;
  id: string;
  status: string;
  type: string;
  subType: string;
  reason: string | null;
  lwd: string | null;
  lwdProposed: string | null;
  createdAt: string;
}

/** Live (non-withdrawn) exit requests. Small table; loaded whole and indexed by employee. */
export function exitRequests(): Promise<Map<string, ExitReq[]>> {
  return memo("exitreq", async () => {
    const rows = await q(
      `SELECT employee_id AS eid, id, status, exit_type AS type, exit_sub_type AS sub, exit_reason_category AS reason,
              DATE_FORMAT(last_working_day_confirmed,'%Y-%m-%d') AS lwd, DATE_FORMAT(last_working_day_proposed,'%Y-%m-%d') AS lwdp,
              DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') AS created
         FROM exit_request WHERE status NOT IN (${inList(EXIT_IGNORED_STATUSES)})`,
    );
    const map = new Map<string, ExitReq[]>();
    for (const r of rows) {
      const e: ExitReq = { eid: String(r.eid), id: String(r.id), status: String(r.status), type: String(r.type ?? ""), subType: String(r.sub ?? ""), reason: r.reason ?? null, lwd: r.lwd ?? null, lwdProposed: r.lwdp ?? null, createdAt: String(r.created) };
      map.set(e.eid, [...(map.get(e.eid) ?? []), e]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
    return map;
  });
}

export const latestExit = (m: Map<string, ExitReq[]>, eid: string): ExitReq | undefined => m.get(eid)?.[0];
export const isOpenNotice = (s: string) => (EXIT_OPEN_STATUSES as readonly string[]).includes(s);
export const isPendingExit = (s: string) => (EXIT_PENDING_STATUSES as readonly string[]).includes(s);

export function externalQuality(from: string, to: string): Promise<{ ok: boolean; rows: Array<{ code: string; n: number; sum: number; fatal: number }> }> {
  return memo(`extqa|${from}|${to}`, async () => {
    try {
      const rows = await timeout(
        q(
          `SELECT q.User AS code, COUNT(*) AS n, SUM(q.quality_percentage) AS s, SUM(q.quality_percentage = 0) AS f
             FROM db_audit.call_quality_assessment q
            WHERE q.CallDate >= ? AND q.CallDate < DATE_ADD(?, INTERVAL 1 DAY) AND q.User IS NOT NULL AND q.User <> ''
            GROUP BY q.User`,
          [from, to],
        ),
        20000,
      );
      return { ok: true, rows: rows.map((r) => ({ code: String(r.code), n: num(r.n), sum: num(r.s), fatal: num(r.f) })) };
    } catch (err) {
      logger.warn(`[ops-command] db_audit quality unavailable: ${(err as Error).message}`);
      return { ok: false, rows: [] };
    }
  });
}

export function manualQuality(from: string, to: string) {
  return memo(`manqa|${from}|${to}`, async () =>
    (await q(
      `SELECT employee_id AS eid, SUM(quality_percentage) AS s, COUNT(*) AS n FROM qa_audit
        WHERE audit_date BETWEEN ? AND ? AND status IN ('submitted','calibrated','closed') GROUP BY employee_id`,
      [from, to],
    )).map((r) => ({ eid: String(r.eid), sum: num(r.s), n: num(r.n) })),
  );
}

export function warningsFact(from: string, to: string) {
  return memo(`warn|${from}|${to}`, async () =>
    (await q(
      `SELECT employee_id AS eid, COUNT(*) AS n, SUM(severity = 'final') AS f FROM employee_warning
        WHERE status = 'active' AND warning_date BETWEEN ? AND ? GROUP BY employee_id`,
      [from, to],
    )).map((r) => ({ eid: String(r.eid), n: num(r.n), final: num(r.f) })),
  );
}

export function activePips() {
  return memo("pips", async () => (await q(`SELECT DISTINCT employee_id AS eid FROM pip_record WHERE status = 'active'`)).map((r) => String(r.eid)));
}

export function trainingFact() {
  return memo("training", async () =>
    (await q(
      `SELECT employee_id AS eid, MAX(attrition_risk_signal = 'red') AS red, MAX(ops_handover_ready = 1) AS ready,
              SUM(readiness_score) AS rs, COUNT(readiness_score) AS rn
         FROM lms_learner_progress GROUP BY employee_id`,
    )).map((r) => ({ eid: String(r.eid), red: num(r.red) === 1, ready: num(r.ready) === 1, rs: num(r.rs), rn: num(r.rn) })),
  );
}

export function breaksFact(from: string, to: string) {
  return memo(`breaks|${from}|${to}`, async () =>
    (await q(
      `SELECT employee_id AS eid,
              SUM(CASE WHEN total_break_minutes > 0 THEN total_break_minutes END) AS bsum,
              SUM(total_break_minutes > 0) AS bn, SUM(exceeded_break_count > 0) AS ex, SUM(final_status = 'No Punch Found') AS np
         FROM break_daily_summary WHERE shift_date BETWEEN ? AND ? GROUP BY employee_id`,
      [from, to],
    )).map((r) => ({ eid: String(r.eid), sum: num(r.bsum), n: num(r.bn), exceeded: num(r.ex), noPunch: num(r.np) })),
  );
}

export function liveFact(today: string) {
  return memo(`live|${today}`, async () => {
    const present = PRESENT_SESSION_STATUSES.map((s) => `'${s}'`).join(",");
    const W = rosterWorking("ra");
    const [roster, brk] = await Promise.all([
      q(
        `SELECT ra.employee_id AS eid, MAX(${W}) AS w, MAX(s.current_status IN (${present})) AS li, MAX(s.current_status = 'Logged Out') AS lo
           FROM wfm_roster_assignment ra
           LEFT JOIN wfm_attendance_session s ON s.employee_id = ra.employee_id AND s.session_date = ra.roster_date
          WHERE ra.roster_date = ? AND ${realRoster("ra")} GROUP BY ra.employee_id`,
        [today],
      ),
      q(`SELECT DISTINCT employee_id AS eid FROM break_sessions WHERE shift_date = ? AND status = 'ACTIVE'`, [today]),
    ]);
    return {
      roster: roster.map((r) => ({ eid: String(r.eid), planned: num(r.w) === 1, in: num(r.li) === 1, out: num(r.lo) === 1 })),
      onBreak: brk.map((r) => String(r.eid)),
    };
  }, 60 * 1000);
}
