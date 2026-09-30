/**
 * Publish & Acknowledge overview + drill-downs for the Trends & Publish panel.
 *
 * Lifecycle context (CLAUDE.md "Roster Governance"): demand > allocation > draft > publish >
 * acknowledge > active > lock > payroll-input-ready. The Process Manager owns publication for
 * their mapped process, and any change after publication needs a reason + audit trail — so the
 * drawers surface weekly_roster_cycle.published_by/at, roster_change_log reasons and
 * audit_action_log entries rather than only counts.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { REAL_ROSTER, scopeSql, type ScopeFilters } from "./roster-trends.sql.js";
import {
  addDays, buildFunnel, deltaPts, funnelByWeek, isPublishStage, previousWindow, stageTotals, type StageCount,
} from "./roster-trends.calc.js";
import { resolveActors, actorName } from "./roster-audit.actors.js";
import { todayLocalDateStr } from "./shift-due.util.js";

export interface PublishFilters extends ScopeFilters { from: string; to: string }

/** DATETIME -> ISO-8601 with the pool's fixed +05:30 offset (dateStrings:true returns bare strings). */
function isoIst(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(" ", "T").slice(0, 19)}+05:30` : new Date(s).toISOString();
}

const WEEK_EXPR = "DATE_FORMAT(DATE_SUB(ra.roster_date, INTERVAL WEEKDAY(ra.roster_date) DAY), '%Y-%m-%d')";

async function stageCounts(from: string, to: string, f: ScopeFilters): Promise<StageCount[]> {
  const s = scopeSql(f);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${WEEK_EXPR} AS week, COALESCE(ra.final_roster_status,'generated') AS status, COUNT(*) AS cnt
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
      WHERE ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}${s.sql}
      GROUP BY week, status`,
    [from, to, ...s.params],
  );
  return rows.map((r) => ({ week: String(r.week), status: String(r.status), count: Number(r.cnt) }));
}

function cycleScope(f: ScopeFilters): { sql: string; params: unknown[] } {
  let sql = ""; const params: unknown[] = [];
  if (f.processId) { sql += " AND c.process_id = ?"; params.push(f.processId); }
  if (f.branchId) { sql += " AND (c.branch_id = ? OR c.branch_id IS NULL)"; params.push(f.branchId); }
  return { sql, params };
}

export async function getPublishOverview(f: PublishFilters) {
  const prev = previousWindow(f.from, f.to);
  const today = todayLocalDateStr();
  const cs = cycleScope(f);
  const s = scopeSql(f);
  const [cur, prevRows, cycles, upcoming] = await Promise.all([
    stageCounts(f.from, f.to, f),
    stageCounts(prev.from, prev.to, f),
    db.execute<RowDataPacket[]>(
      `SELECT c.id, c.status, c.week_start_date, c.week_end_date, c.published_at, c.published_by, c.ack_deadline,
              p.process_name, b.branch_name
         FROM weekly_roster_cycle c
         LEFT JOIN process_master p ON p.id = c.process_id
         LEFT JOIN branch_master b ON b.id = c.branch_id
        WHERE c.week_end_date >= ? AND c.week_start_date <= ?${cs.sql}
        ORDER BY c.week_start_date DESC, p.process_name LIMIT 200`,
      [f.from, f.to, ...cs.params],
    ).catch(() => [[]] as unknown as [RowDataPacket[]]),
    // Next 7 days still 'generated' = the roster people will work next week but have not been told.
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id
        WHERE ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}${s.sql}
          AND COALESCE(ra.final_roster_status,'generated') = 'generated'
          AND UPPER(COALESCE(ra.assignment_type,'')) NOT IN ('WEEK_OFF','HOLIDAY') AND COALESCE(ra.is_week_off,0) = 0`,
      [today, addDays(today, 7), ...s.params],
    ),
  ]);
  const funnel = buildFunnel(stageTotals(cur));
  const prevFunnel = buildFunnel(stageTotals(prevRows));
  const cycleRows = cycles[0];
  const actors = await resolveActors(cycleRows.map((c) => c.published_by as string | null));
  const cycleCounts = new Map<string, number>();
  for (const c of cycleRows) cycleCounts.set(String(c.status), (cycleCounts.get(String(c.status)) ?? 0) + 1);
  return {
    from: f.from, to: f.to, previousWindow: prev,
    funnel,
    previous: prevFunnel.total > 0 ? prevFunnel : null,
    deltas: {
      publishedPct: prevFunnel.total > 0 ? deltaPts(funnel.publishedPct, prevFunnel.publishedPct) : null,
      ackPctOfPublished: prevFunnel.published > 0 ? deltaPts(funnel.ackPctOfPublished, prevFunnel.ackPctOfPublished) : null,
    },
    byStage: stageTotals(cur),
    byWeek: funnelByWeek(cur),
    upcomingUnpublished: Number(upcoming[0][0]?.cnt ?? 0),
    cycleCounts: [...cycleCounts.entries()].map(([status, count]) => ({ status, count })),
    cycles: cycleRows.map((c) => ({
      id: String(c.id), status: String(c.status), processName: c.process_name ? String(c.process_name) : null,
      branchName: c.branch_name ? String(c.branch_name) : null,
      weekStart: String(c.week_start_date).slice(0, 10), weekEnd: String(c.week_end_date).slice(0, 10),
      publishedAt: isoIst(c.published_at),
      publishedBy: c.published_by ? actorName(actors, String(c.published_by)) : null,
      ackDeadline: isoIst(c.ack_deadline),
    })),
    cyclesTruncated: cycleRows.length >= 200,
    /** The cycle table has no LOB column, so the LOB filter narrows assignments but not cycles. */
    cyclesIgnoreLob: !!f.lob && f.lob.kind !== "none",
  };
}

/** Drill-down for one final_roster_status value across the current scope/range. */
export async function getPublishStageDetail(status: string, f: PublishFilters, week?: string) {
  const all = status === "all";
  if (!all && !isPublishStage(status)) return null;
  // `week` (a Monday) narrows the window to that Mon-Sun week, still inside the requested range.
  const from = week && week > f.from ? week : f.from;
  const weekEnd = week ? addDays(week, 6) : null;
  const to = weekEnd && weekEnd < f.to ? weekEnd : f.to;
  const s = scopeSql(f);
  const base = `ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}${s.sql}${all ? "" : " AND COALESCE(ra.final_roster_status,'generated') = ?"}`;
  const params: unknown[] = [from, to, ...s.params, ...(all ? [] : [status])];
  const [total, byProc, byWeek, sample, stages] = await Promise.all([
    db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS cnt, COUNT(DISTINCT ra.employee_id) AS emps FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id WHERE ${base}`, params),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(p.process_name,'Unassigned') AS name, COUNT(*) AS cnt
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id
         LEFT JOIN process_master p ON p.id = e.process_id WHERE ${base}
        GROUP BY name ORDER BY cnt DESC LIMIT 25`, params),
    db.execute<RowDataPacket[]>(
      `SELECT ${WEEK_EXPR} AS week, COUNT(*) AS cnt
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id WHERE ${base}
        GROUP BY week ORDER BY week`, params),
    db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d, COALESCE(ra.final_roster_status,'generated') AS stage, ra.assignment_type, ra.employee_ack_status, ra.employee_ack_at,
              ra.employee_rejection_reason, ra.manager_action_status, ra.manager_action_by, ra.manager_action_at,
              ra.manager_action_reason, ra.published_to_rta_at,
              e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              p.process_name
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id
         LEFT JOIN process_master p ON p.id = e.process_id WHERE ${base}
        ORDER BY (ra.manager_action_at IS NULL), ra.manager_action_at DESC, ra.roster_date DESC LIMIT 50`, params),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(ra.final_roster_status,'generated') AS stage, COUNT(*) AS cnt
         FROM wfm_roster_assignment ra JOIN employees e ON e.id = ra.employee_id WHERE ${base}
        GROUP BY stage ORDER BY cnt DESC`, params),
  ]);
  const actors = await resolveActors(sample[0].map((r) => r.manager_action_by as string | null));
  const count = Number(total[0][0]?.cnt ?? 0);
  return {
    status, week: week ?? null, from, to, count, employees: Number(total[0][0]?.emps ?? 0),
    byStage: stages[0].map((r) => ({ status: String(r.stage), count: Number(r.cnt) })),
    byProcess: byProc[0].map((r) => ({ name: String(r.name), count: Number(r.cnt) })),
    byWeek: byWeek[0].map((r) => ({ week: String(r.week), count: Number(r.cnt) })),
    sampleTruncated: count > sample[0].length,
    sample: sample[0].map((r) => ({
      date: String(r.d), employeeCode: String(r.employee_code), employeeName: String(r.employee_name),
      processName: r.process_name ? String(r.process_name) : null,
      stage: String(r.stage),
      assignmentType: r.assignment_type ? String(r.assignment_type) : null,
      ackStatus: r.employee_ack_status ? String(r.employee_ack_status) : null,
      ackAt: isoIst(r.employee_ack_at),
      rejectionReason: r.employee_rejection_reason ? String(r.employee_rejection_reason) : null,
      managerAction: r.manager_action_status ? String(r.manager_action_status) : null,
      managerActionBy: r.manager_action_by ? actorName(actors, String(r.manager_action_by)) : null,
      managerActionAt: isoIst(r.manager_action_at),
      managerActionReason: r.manager_action_reason ? String(r.manager_action_reason) : null,
    })),
  };
}

/** Drill-down for one weekly_roster_cycle: record, assignment stages, change log (reasons), audit. */
export async function getCycleDetail(cycleId: string) {
  const [cycleQ] = await db.execute<RowDataPacket[]>(
    `SELECT c.*, p.process_name, b.branch_name FROM weekly_roster_cycle c
       LEFT JOIN process_master p ON p.id = c.process_id LEFT JOIN branch_master b ON b.id = c.branch_id
      WHERE c.id = ? LIMIT 1`,
    [cycleId],
  );
  const c = cycleQ[0];
  if (!c) return null;
  const empty = [[]] as unknown as [RowDataPacket[]];
  const [stages, changes, audit] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(final_roster_status,'generated') AS status, COUNT(*) AS cnt
         FROM wfm_roster_assignment WHERE cycle_id = ? GROUP BY status`, [cycleId]),
    db.execute<RowDataPacket[]>(
      `SELECT change_type, reason, change_date, created_at, changed_by
         FROM roster_change_log WHERE cycle_id = ? ORDER BY created_at DESC LIMIT 30`, [cycleId]).catch(() => empty),
    db.execute<RowDataPacket[]>(
      `SELECT action_type, module_key, actor_user_id, created_at
         FROM audit_action_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 30`, [cycleId]).catch(() => empty),
  ]);
  const actors = await resolveActors([
    c.published_by as string | null, c.created_by as string | null,
    ...changes[0].map((r) => r.changed_by as string | null), ...audit[0].map((r) => r.actor_user_id as string | null),
  ]);
  const iso = isoIst;
  return {
    id: String(c.id), status: String(c.status),
    processName: c.process_name ? String(c.process_name) : null, branchName: c.branch_name ? String(c.branch_name) : null,
    weekStart: String(c.week_start_date).slice(0, 10), weekEnd: String(c.week_end_date).slice(0, 10),
    createdAt: iso(c.created_at), createdBy: c.created_by ? actorName(actors, String(c.created_by)) : null,
    publishedAt: iso(c.published_at), publishedBy: c.published_by ? actorName(actors, String(c.published_by)) : null,
    ackDeadline: iso(c.ack_deadline), lockedAt: iso(c.locked_at), payrollReadyAt: iso(c.payroll_ready_at),
    funnel: buildFunnel(stages[0].map((r) => ({ status: String(r.status), count: Number(r.cnt) }))),
    byStage: stages[0].map((r) => ({ status: String(r.status), count: Number(r.cnt) })),
    changes: changes[0].map((r) => ({
      type: String(r.change_type), reason: r.reason ? String(r.reason) : null, changeDate: r.change_date ? String(r.change_date).slice(0, 10) : null,
      at: iso(r.created_at), actor: actorName(actors, r.changed_by ? String(r.changed_by) : null),
    })),
    audit: audit[0].map((r) => ({
      action: String(r.action_type), module: String(r.module_key), at: iso(r.created_at),
      actor: actorName(actors, r.actor_user_id ? String(r.actor_user_id) : null),
    })),
  };
}
