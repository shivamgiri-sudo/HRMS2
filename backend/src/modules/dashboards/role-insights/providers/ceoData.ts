import type { InsightContext } from "../types.js";
import { empScope, num, rows } from "../helpers.js";
import { buildScopeWhere } from "../../../../shared/dashboardScope.js";
import { EXPECTED_TO_WORK_EXCLUSIONS, PRESENT_STATUSES, statusList } from "../../../../shared/attendanceStatus.js";
import { buildFlow, hiringGap, monthKeys, pivotAttendance, requiredHeadcount, type DayAttendance, type FlowPoint, type MandateRow } from "./ceoCalc.js";

/** Shared, memoised data fetchers for the CEO insight sections (see ceo.ts for the source audit). */

export const SLA_DAYS = 3;
/** Exit-request statuses that are finished (no longer "in the approval chain / in notice"). */
export const TERMINAL_EXIT = `('exited','closed','completed','cancelled','withdrawn','revoked','rejected','terminated','draft')`;
/** Requests that never became an exit — excluded when counting exit TYPE of people who actually left. */
export const NOT_EXITING = `('withdrawn','revoked','cancelled','rejected','draft')`;
const MEMO_MS = 5 * 60_000;
const memo = new Map<string, { at: number; p: Promise<unknown> }>();

/** Share one in-flight/recent computation between sections (the exit-history scan is the heavy one). */
function memoised<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => { if (memo.get(key)?.p === p) memo.delete(key); });
  return p;
}

export const scopeKey = (ctx: InsightContext) =>
  `${ctx.scope.level}|${ctx.scope.branchIds.join(",")}|${ctx.scope.processIds.join(",")}|${ctx.scope.employeeIds.length}`;

/**
 * Scope predicate for attendance_daily_record. It carries its own branch_id / process_id, so branch / process /
 * custom scopes filter on those and skip the employees join (22s -> ~1s for a branch-scoped caller); person-keyed
 * scopes (team / self) still need the join.
 */
export function attendanceScope(ctx: InsightContext): { join: string; where: string; params: string[]; branchCol: string } {
  const l = ctx.scope.level;
  if (l === "ORG_ALL") return { join: "", where: "", params: [], branchCol: "adr.branch_id" };
  if (l === "BRANCH_ALL" || l === "PROCESS_ALL" || l === "CUSTOM_SCOPE") {
    const b = buildScopeWhere(ctx.scope, "adr.branch_id", "adr.process_id");
    return { join: "", where: ` AND ${b.sql}`, params: b.params, branchCol: "adr.branch_id" };
  }
  const sc = empScope(ctx, "e");
  return { join: "JOIN employees e ON e.id = adr.employee_id", where: sc.sql, params: sc.params, branchCol: "e.branch_id" };
}
export const drill = (metric: string, filters?: Record<string, string>) =>
  `/dashboards/drill/CEO_DASHBOARD/${metric}${filters ? `?${new URLSearchParams(filters).toString()}` : ""}`;

// ─── shared fetchers ────────────────────────────────────────────────────────────────────────────

export interface ExitScan {
  months: string[];
  exits: Array<{ branchId: string | null; month: string; x: number; early: number; x30: number; x90: number }>;
  joinsByMonth: Map<string, number>;
  joins30: number;
  headcountNow: number;
  branches: Array<{ branchId: string | null; name: string; headcount: number }>;
}

/**
 * Exits + joins over 13 months and headcount now. Exits are keyed on employees.date_of_exit
 * (29,645 rows; date_of_leaving is set on 31 and resignation_date is the NOTICE date, which would
 * count people a month before they leave). date_of_exit has no index, so this is one grouped scan
 * of employees — it is memoised for 5 minutes and shared by the attrition and branch sections.
 */
export function exitScan(ctx: InsightContext): Promise<ExitScan> {
  return memoised(`ceo:exit:${scopeKey(ctx)}:${ctx.today}`, MEMO_MS, async () => {
    const months = monthKeys(ctx.today, 13);
    const from = `${months[0]}-01`;
    const sc = empScope(ctx, "e");
    const d30 = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    const d90 = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
    const [exitRows, joinRows, hcRows] = await Promise.all([
      rows(
        `SELECT e.branch_id AS branchId, DATE_FORMAT(e.date_of_exit, '%Y-%m') AS m, COUNT(*) AS x,
                SUM(DATEDIFF(e.date_of_exit, e.date_of_joining) <= 90) AS early,
                SUM(e.date_of_exit >= ?) AS x30, SUM(e.date_of_exit >= ?) AS x90
           FROM employees e
          WHERE e.date_of_exit >= ? AND e.date_of_exit <= ?${sc.sql}
          GROUP BY e.branch_id, m`,
        [d30, d90, from, ctx.today, ...sc.params],
      ),
      rows(
        `SELECT DATE_FORMAT(e.date_of_joining, '%Y-%m') AS m, COUNT(*) AS j, SUM(e.date_of_joining >= ?) AS j30
           FROM employees e
          WHERE e.date_of_joining >= ? AND e.date_of_joining <= ?${sc.sql}
          GROUP BY m`,
        [d30, from, ctx.today, ...sc.params],
      ),
      rows(
        `SELECT e.branch_id AS branchId, COALESCE(NULLIF(b.display_name, ''), b.branch_name, 'Unmapped') AS name, COUNT(*) AS hc
           FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
          WHERE e.active_status = 1 AND e.date_of_joining <= ?${sc.sql}
          GROUP BY e.branch_id, name`,
        [ctx.today, ...sc.params],
      ),
    ]);
    const branches = hcRows.map((r) => ({ branchId: (r.branchId as string | null) ?? null, name: String(r.name), headcount: num(r.hc) ?? 0 }));
    return {
      months,
      exits: exitRows.map((r) => ({
        branchId: (r.branchId as string | null) ?? null, month: String(r.m), x: num(r.x) ?? 0, early: num(r.early) ?? 0,
        x30: num(r.x30) ?? 0, x90: num(r.x90) ?? 0,
      })),
      joinsByMonth: new Map(joinRows.map((r) => [String(r.m), num(r.j) ?? 0])),
      joins30: joinRows.reduce((s, r) => s + (num(r.j30) ?? 0), 0),
      headcountNow: branches.reduce((s, b) => s + b.headcount, 0),
      branches,
    };
  });
}

export function flowFrom(scan: ExitScan): FlowPoint[] {
  const exits = new Map<string, number>();
  const early = new Map<string, number>();
  for (const r of scan.exits) {
    exits.set(r.month, (exits.get(r.month) ?? 0) + r.x);
    early.set(r.month, (early.get(r.month) ?? 0) + r.early);
  }
  return buildFlow(scan.months, scan.joinsByMonth, exits, early, scan.headcountNow);
}

/** Daily processed-attendance counts for the last 31 days (complete days only are used downstream). */
export function attendanceDays(ctx: InsightContext): Promise<DayAttendance[]> {
  return memoised(`ceo:att:${scopeKey(ctx)}:${ctx.today}`, 60_000, async () => {
    const sc = attendanceScope(ctx);
    // Grouped by (date, status) so the whole query is answered from idx_adr_record_date_status
    // (~1s); the per-day pivot happens here. Pivoting in SQL with SUM(CASE) took ~10s on the same data.
    const r = await rows(
      `SELECT DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS d, adr.attendance_status AS s, COUNT(*) AS c
         FROM attendance_daily_record adr ${sc.join}
        WHERE adr.record_date >= DATE_SUB(?, INTERVAL 31 DAY) AND adr.record_date <= ?${sc.where}
        GROUP BY adr.record_date, adr.attendance_status ORDER BY adr.record_date`,
      [ctx.today, ctx.today, ...sc.params],
    );
    return pivotAttendance(r.map((x) => ({ date: String(x.d), status: String(x.s ?? ""), n: num(x.c) ?? 0 })));
  });
}

export function mandateRows(ctx: InsightContext): Promise<MandateRow[]> {
  return memoised(`ceo:mandate:${scopeKey(ctx)}:${ctx.today}`, 60_000, async () => {
    const sc = empScope(ctx, "e");
    const [mand, active] = await Promise.all([
      rows(
        `SELECT wm.branch_id AS branchId, wm.process_id AS processId, wm.mandated_hc AS mandate,
                wm.buffer_pct AS buf, wm.shrinkage_pct AS shr, wm.attrition_buffer_pct AS att, wm.training_buffer_pct AS trn,
                COALESCE(NULLIF(b.display_name, ''), b.branch_name, 'Unmapped') AS branch, COALESCE(p.process_name, 'Unmapped') AS process
           FROM workforce_mandate wm
           LEFT JOIN branch_master b ON b.id = wm.branch_id LEFT JOIN process_master p ON p.id = wm.process_id
          WHERE wm.active_status = 1 AND wm.effective_from <= ? AND (wm.effective_to IS NULL OR wm.effective_to >= ?)`,
        [ctx.today, ctx.today],
      ),
      rows(
        `SELECT e.branch_id AS branchId, e.process_id AS processId, COUNT(*) AS hc
           FROM employees e WHERE e.active_status = 1 AND e.date_of_joining <= ?${sc.sql}
          GROUP BY e.branch_id, e.process_id`,
        [ctx.today, ...sc.params],
      ),
    ]);
    const hc = new Map(active.map((r) => [`${r.branchId}|${r.processId}`, num(r.hc) ?? 0]));
    // A scoped caller (branch / process) only sees the mandates inside their scope.
    const scoped = mand.filter((m) => {
      if (ctx.scope.branchIds.length && !ctx.scope.branchIds.includes(String(m.branchId))) return false;
      if (ctx.scope.processIds.length && !ctx.scope.processIds.includes(String(m.processId))) return false;
      return true;
    });
    return scoped.map((m) => {
      const mandate = num(m.mandate) ?? 0;
      return {
        branch: String(m.branch), process: String(m.process), mandate,
        seatTarget: mandate + Math.ceil((mandate * (Number(m.buf) || 0)) / 100),
        required: requiredHeadcount(mandate, [Number(m.buf), Number(m.shr), Number(m.att), Number(m.trn)]),
        active: hc.get(`${m.branchId}|${m.processId}`) ?? 0,
      };
    });
  });
}

