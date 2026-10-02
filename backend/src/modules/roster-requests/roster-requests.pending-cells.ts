/**
 * Roster-cell pending badges: every (employee, date) cell that has an undecided roster request,
 * across all four kinds, so the roster grids can mark the cell and link to the hub row.
 *
 * "Pending" matches what the decide service still accepts: swap 'pending' (both the requester's
 * and the counterpart's cell), week-off 'pending_manager_action' / 'escalated_to_hr', an
 * unresolved dispute, and an unresolved conflict.
 */
import type { RowDataPacket } from "mysql2";
import { db as defaultDb } from "../../db/mysql.js";
import type { RequestKind } from "./roster-requests.types.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export const PENDING_CELLS_LIMIT = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface PendingCellsQuery {
  from: string;
  to: string;
  processId: string | null;
  branchId: string | null;
}

export interface PendingCell {
  employeeId: string;
  date: string;
  kind: RequestKind;
  id: string;
}

const validDate = (v: unknown): v is string => {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const optionalId = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parsePendingCellsQuery(q: Record<string, unknown>): PendingCellsQuery | null {
  const { from, to } = q;
  if (!validDate(from) || !validDate(to) || from > to) return null;
  return { from, to, processId: optionalId(q.processId), branchId: optionalId(q.branchId) };
}

/** `scope` is a predicate over `e` (employees), e.g. employeeScope(userId); "1=1" for org-wide users. */
export async function listPendingCells(
  q: PendingCellsQuery,
  scope: { sql: string; params: unknown[] },
  exec: Exec = defaultDb as any,
): Promise<PendingCell[]> {
  const filters: string[] = [];
  const filterParams: unknown[] = [];
  if (q.processId) { filters.push("e.process_id = ?"); filterParams.push(q.processId); }
  if (q.branchId) { filters.push("e.branch_id = ?"); filterParams.push(q.branchId); }
  const extra = [...filters, `(${scope.sql})`].join(" AND ");
  const branchParams = [q.from, q.to, ...filterParams, ...scope.params];

  const branches = [
    `SELECT e.id AS employee_id, DATE_FORMAT(s.swap_date, '%Y-%m-%d') AS date, 'swap' AS kind, s.id
       FROM wfm_roster_swap_request s
       JOIN employees e ON e.id IN (s.requester_emp_id, s.swap_with_emp_id)
      WHERE s.status = 'pending' AND s.swap_date BETWEEN ? AND ? AND ${extra}`,
    `SELECT e.id AS employee_id, DATE_FORMAT(wra.roster_date, '%Y-%m-%d') AS date, 'weekoff_rejection' AS kind, wra.id
       FROM wfm_roster_assignment wra
       JOIN employees e ON e.id = wra.employee_id
      WHERE wra.final_roster_status IN ('pending_manager_action', 'escalated_to_hr') AND wra.roster_date BETWEEN ? AND ? AND ${extra}`,
    `SELECT e.id AS employee_id, DATE_FORMAT(rda.roster_date, '%Y-%m-%d') AS date, 'dispute' AS kind, rda.id
       FROM roster_daily_assignment rda
       JOIN employees e ON e.id = rda.employee_id
      WHERE rda.acknowledgement_status = 'disputed' AND rda.dispute_resolved_at IS NULL AND rda.roster_date BETWEEN ? AND ? AND ${extra}`,
    `SELECT e.id AS employee_id, DATE_FORMAT(c.conflict_date, '%Y-%m-%d') AS date, 'conflict' AS kind, c.id
       FROM wfm_roster_conflict_log c
       JOIN employees e ON e.id = c.employee_id
      WHERE c.resolved = 0 AND c.conflict_date BETWEEN ? AND ? AND ${extra}`,
  ];
  const sql = `SELECT employee_id, date, kind, id FROM (
    ${branches.join("\n    UNION ALL\n    ")}
  ) pending ORDER BY date, kind, employee_id LIMIT ${PENDING_CELLS_LIMIT}`;
  const [rows] = await exec.execute(sql, branches.flatMap(() => branchParams));
  return (rows as RowDataPacket[]).map((r) => ({
    employeeId: String(r.employee_id),
    date: String(r.date),
    kind: r.kind as RequestKind,
    id: String(r.id),
  }));
}
