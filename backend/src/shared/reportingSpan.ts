import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { getEmployeeForUser } from "./accessGuard.js";

/**
 * A manager's reporting span for VIEW access: their direct reports (a TL sees the team) plus the
 * reports of those reports (an AM sees each TL's team). Two levels only - the skip-level view -
 * expressed as SQL so list endpoints can OR it onto their existing scope without loading ids.
 *
 * View only. Approval and action gates deliberately stay on the direct manager.
 */
export interface SpanClause {
  sql: string;
  params: string[];
}

export function spanClauseFor(employeeId: string, alias = "e"): SpanClause {
  return {
    sql: `(${alias}.reporting_manager_id = ? OR ${alias}.reporting_manager_id IN (SELECT t.id FROM employees t WHERE t.reporting_manager_id = ?))`,
    params: [employeeId, employeeId],
  };
}

/** The caller's span, or null when the login has no employee record. */
export async function reportingSpanClause(userId: string, alias = "e"): Promise<SpanClause | null> {
  const employee = await getEmployeeForUser(userId);
  return employee?.id ? spanClauseFor(String(employee.id), alias) : null;
}

/** True when at least one active employee reports to the caller (people managers often hold only the plain employee role). */
export async function hasDirectReports(userId: string): Promise<boolean> {
  const employee = await getEmployeeForUser(userId);
  if (!employee?.id) return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT 1 AS has_reports FROM employees WHERE reporting_manager_id = ? AND active_status = 1 LIMIT 1",
    [employee.id],
  );
  return rows.length > 0;
}

/** True when the employee is one of the caller's direct reports or a report of one (TL team / AM skip level). */
export async function isInReportingSpan(userId: string, employeeId: string): Promise<boolean> {
  const span = await reportingSpanClause(userId, "e");
  if (!span) return false;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT 1 AS ok FROM employees e WHERE e.id = ? AND ${span.sql} LIMIT 1`, [employeeId, ...span.params]);
  return rows.length > 0;
}
