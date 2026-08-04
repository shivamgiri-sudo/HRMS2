import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { buildScopeWhereEmployees, type DashboardScope } from "../../shared/dashboardScope.js";

export type OperationsDrillLevel = "branch" | "process" | "team" | "analyst";

export interface OperationsDrillNode {
  id: string;
  name: string;
  secondaryLabel: string | null;
  headcount: number;
  presentRatePct: number | null;
  absentRatePct: number | null;
  lateRatePct: number | null;
  avgBiometricMinutes: number | null;
  hasChildren: boolean;
}

export interface OperationsSummaryResponse {
  level: OperationsDrillLevel;
  parentId: string | null;
  parentLabel: string | null;
  nodes: OperationsDrillNode[];
  rangeDays: number;
  asOf: string;
}

const DEFAULT_RANGE_DAYS = 30;

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

type AttendanceAggRow = RowDataPacket & {
  group_id: string | null;
  headcount: number;
  present_days: number;
  absent_days: number;
  late_days: number;
  total_days: number;
  avg_biometric_minutes: number | null;
};

/**
 * Every dedicated team-leader-link column in this schema (wfm_roster_assignment.team_leader_employee_id,
 * kpi_daily_actual.team_leader_id_at_event) is 0% populated in production. The only populated
 * grouping mechanism is the employee's own immediate manager, same as dashboardScope.ts's
 * TEAM_ONLY resolver uses — reporting_manager_id first, manager_id as fallback.
 */
const TEAM_GROUP_EXPR = "COALESCE(e.reporting_manager_id, e.manager_id)";

class OperationsDashboardV2Service {
  private async runAggregate(
    groupExpr: string,
    scope: DashboardScope,
    rangeDays: number,
    extraWhere: string,
    extraParams: unknown[],
  ): Promise<AttendanceAggRow[]> {
    const scopeClause = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         ${groupExpr} AS group_id,
         COUNT(DISTINCT a.employee_id) AS headcount,
         SUM(a.attendance_status = 'present') AS present_days,
         SUM(a.attendance_status = 'absent') AS absent_days,
         SUM(a.late_mark = 1) AS late_days,
         COUNT(*) AS total_days,
         AVG(a.biometric_minutes) AS avg_biometric_minutes
       FROM attendance_daily_record a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.record_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND e.active_status = 1
         AND ${scopeClause.sql}
         AND ${extraWhere}
       GROUP BY ${groupExpr}
       HAVING group_id IS NOT NULL`,
      [rangeDays, ...scopeClause.params, ...extraParams],
    ).catch((err) => {
      logger.error("operations-dashboard-v2 aggregate failed", err);
      return [[]] as unknown as [RowDataPacket[]];
    });
    return rows as AttendanceAggRow[];
  }

  private toNode(row: AttendanceAggRow, name: string, secondaryLabel: string | null, hasChildren: boolean): OperationsDrillNode {
    return {
      id: String(row.group_id),
      name,
      secondaryLabel,
      headcount: Number(row.headcount) || 0,
      presentRatePct: pct(Number(row.present_days) || 0, Number(row.total_days) || 0),
      absentRatePct: pct(Number(row.absent_days) || 0, Number(row.total_days) || 0),
      lateRatePct: pct(Number(row.late_days) || 0, Number(row.total_days) || 0),
      avgBiometricMinutes: row.avg_biometric_minutes !== null ? Math.round(Number(row.avg_biometric_minutes)) : null,
      hasChildren,
    };
  }

  async branchLevel(scope: DashboardScope, rangeDays: number): Promise<OperationsSummaryResponse> {
    const rows = await this.runAggregate("a.branch_id", scope, rangeDays, "1=1", []);
    const ids = rows.map((r) => r.group_id).filter(Boolean) as string[];
    const names = await this.branchNames(ids);
    return {
      level: "branch",
      parentId: null,
      parentLabel: null,
      nodes: rows.map((r) => this.toNode(r, names.get(String(r.group_id)) ?? "Unknown Branch", null, true)),
      rangeDays,
      asOf: new Date().toISOString(),
    };
  }

  async processLevel(branchId: string | null, scope: DashboardScope, rangeDays: number): Promise<OperationsSummaryResponse> {
    if (!branchId) throw new Error("branchId is required for process level");
    const rows = await this.runAggregate("a.process_id", scope, rangeDays, "a.branch_id = ?", [branchId]);
    const ids = rows.map((r) => r.group_id).filter(Boolean) as string[];
    const names = await this.processNames(ids);
    const parentLabel = (await this.branchNames([branchId])).get(branchId) ?? null;
    return {
      level: "process",
      parentId: branchId,
      parentLabel,
      nodes: rows.map((r) => this.toNode(r, names.get(String(r.group_id)) ?? "Unassigned Process", null, true)),
      rangeDays,
      asOf: new Date().toISOString(),
    };
  }

  async teamLevel(processId: string | null, scope: DashboardScope, rangeDays: number): Promise<OperationsSummaryResponse> {
    if (!processId) throw new Error("processId is required for team level");
    const rows = await this.runAggregate(TEAM_GROUP_EXPR, scope, rangeDays, "a.process_id = ?", [processId]);
    const ids = rows.map((r) => r.group_id).filter(Boolean) as string[];
    const names = await this.employeeNames(ids);
    const parentLabel = (await this.processNames([processId])).get(processId) ?? null;
    return {
      level: "team",
      parentId: processId,
      parentLabel,
      nodes: rows.map((r) => {
        const info = names.get(String(r.group_id));
        return this.toNode(r, info ? `${info.fullName}'s team` : "Unassigned team", info?.employeeCode ?? null, true);
      }),
      rangeDays,
      asOf: new Date().toISOString(),
    };
  }

  async analystLevel(managerId: string | null, scope: DashboardScope, rangeDays: number): Promise<OperationsSummaryResponse> {
    if (!managerId) throw new Error("managerId is required for analyst level");
    const rows = await this.runAggregate("a.employee_id", scope, rangeDays, `${TEAM_GROUP_EXPR} = ?`, [managerId]);
    const ids = rows.map((r) => r.group_id).filter(Boolean) as string[];
    const names = await this.employeeNames(ids);
    const parentInfo = (await this.employeeNames([managerId])).get(managerId);
    return {
      level: "analyst",
      parentId: managerId,
      parentLabel: parentInfo?.fullName ?? null,
      nodes: rows.map((r) => {
        const info = names.get(String(r.group_id));
        return this.toNode(r, info?.fullName ?? "Unknown", info?.employeeCode ?? null, false);
      }),
      rangeDays,
      asOf: new Date().toISOString(),
    };
  }

  private async branchNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, branch_name FROM branch_master WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    return new Map((rows as any[]).map((r) => [String(r.id), r.branch_name]));
  }

  private async processNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, process_name FROM process_master WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    return new Map((rows as any[]).map((r) => [String(r.id), r.process_name]));
  }

  private async employeeNames(ids: string[]): Promise<Map<string, { fullName: string; employeeCode: string }>> {
    if (ids.length === 0) return new Map();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, full_name, employee_code FROM employees WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    return new Map((rows as any[]).map((r) => [String(r.id), { fullName: r.full_name, employeeCode: r.employee_code }]));
  }

  /** Level-5 drill: a single analyst's day-by-day attendance detail for the range. */
  async analystDetail(employeeId: string, rangeDays: number): Promise<{
    employee: { id: string; fullName: string; employeeCode: string } | null;
    days: Array<{ date: string; status: string; lateMark: boolean; biometricMinutes: number | null; diallerMinutes: number | null }>;
  }> {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, full_name, employee_code FROM employees WHERE id = ? LIMIT 1`,
      [employeeId],
    );
    const employee = (empRows as any[])[0]
      ? { id: employeeId, fullName: (empRows as any[])[0].full_name, employeeCode: (empRows as any[])[0].employee_code }
      : null;

    const [dayRows] = await db.execute<RowDataPacket[]>(
      `SELECT record_date, attendance_status, late_mark, biometric_minutes, dialler_minutes
         FROM attendance_daily_record
        WHERE employee_id = ? AND record_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        ORDER BY record_date DESC`,
      [employeeId, rangeDays],
    );

    return {
      employee,
      days: (dayRows as any[]).map((r) => ({
        date: r.record_date,
        status: r.attendance_status,
        lateMark: !!r.late_mark,
        biometricMinutes: r.biometric_minutes,
        diallerMinutes: r.dialler_minutes,
      })),
    };
  }
}

export const operationsDashboardV2Service = new OperationsDashboardV2Service();
