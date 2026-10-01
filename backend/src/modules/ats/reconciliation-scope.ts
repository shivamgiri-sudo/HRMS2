import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildEmployeeScopeCondition, resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { buildCandidateScopeSql, resolveAtsBranchScope } from "./ats-branch-scope.js";

/**
 * Branch scoping for the reconciliation report (owner ruling 2026-10-01: hr is branch-scoped, only the
 * org-wide roles see every branch). Every reconciliation row carries a candidate_id and/or an employee_id,
 * so rows are filtered to the caller's branch after the (unchanged) anomaly query runs. A row that names
 * neither is dropped for a scoped caller (fail closed).
 */
type Row = Record<string, unknown>;
const CHUNK = 800;

async function allowedIds(sql: (ph: string) => string, params: unknown[], ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const [rows] = await db.execute<RowDataPacket[]>(sql(part.map(() => "?").join(",")), [...part, ...params]);
    for (const r of rows as RowDataPacket[]) out.add(String(r.id));
  }
  return out;
}

export async function scopeReconciliationRows<T extends Row>(userId: string, rows: T[]): Promise<T[]> {
  const cand = await resolveAtsBranchScope(userId);
  if (cand.orgWide) return rows;
  if (rows.length === 0) return rows;

  const cids = [...new Set(rows.map((r) => r.candidate_id).filter(Boolean).map(String))];
  const eids = [...new Set(rows.filter((r) => !r.candidate_id).map((r) => r.employee_id).filter(Boolean).map(String))];

  const cs = buildCandidateScopeSql(cand, "c");
  const es = buildEmployeeScopeCondition(await resolveUserBusinessScope(userId), {
    employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", lobId: "e.lob_id",
    departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id",
  });
  const okC = cids.length ? await allowedIds((ph) => `SELECT c.id FROM ats_candidate c WHERE c.id IN (${ph}) AND (${cs.sql})`, cs.params, cids) : new Set<string>();
  const okE = eids.length ? await allowedIds((ph) => `SELECT e.id FROM employees e WHERE e.id IN (${ph}) AND (${es.sql})`, es.params, eids) : new Set<string>();

  return rows.filter((r) => (r.candidate_id ? okC.has(String(r.candidate_id)) : r.employee_id ? okE.has(String(r.employee_id)) : false));
}
