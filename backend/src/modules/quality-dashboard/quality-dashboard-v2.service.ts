import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { querySource } from "../../db/sourceDb.js";
import { logger } from "../../logger.js";
import type { DashboardScope } from "../../shared/dashboardScope.js";

export type QualityDrillLevel = "branch" | "process" | "team" | "analyst";

export interface QualityDrillNode {
  id: string;
  name: string;
  secondaryLabel: string | null;
  agentCount: number;
  callsAudited: number;
  avgQualityPct: number | null;
  hasChildren: boolean;
}

export interface QualitySummaryResponse {
  level: QualityDrillLevel;
  parentId: string | null;
  parentLabel: string | null;
  nodes: QualityDrillNode[];
  rangeDays: number;
  asOf: string;
}

const DEFAULT_RANGE_DAYS = 30;

type PerUserAgg = { user: string; calls: number; scoreSum: number; scoredCalls: number };

type EmployeeInfo = {
  id: string;
  employeeCode: string;
  fullName: string;
  branchId: string | null;
  processId: string | null;
  reportsTo: string | null;
  activeStatus: boolean;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The manual qa_audit-form pipeline is 0 rows in production (verified 2026-08-04) — the
 * real, live quality-scoring engine is db_audit.call_quality_assessment, an upstream
 * read-only source (Database Boundary Rule) queried via querySource. Its `User` column
 * matches employees.employee_code exactly (verified on a live sample), so identity/scope
 * resolution happens in application code rather than a cross-schema SQL JOIN, mirroring
 * how operations-live.service.ts resolves employee identity separately from roster data.
 */
class QualityDashboardV2Service {
  private async perUserAggregates(rangeDays: number): Promise<PerUserAgg[]> {
    const rows = await querySource<{ User: string; calls: number; score_sum: string | null; scored_calls: number }>(
      `SELECT User,
              COUNT(*) AS calls,
              SUM(CASE WHEN quality_percentage IS NOT NULL THEN quality_percentage ELSE 0 END) AS score_sum,
              SUM(quality_percentage IS NOT NULL) AS scored_calls
         FROM db_audit.call_quality_assessment
        WHERE CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND User IS NOT NULL AND TRIM(User) <> ''
        GROUP BY User`,
      [rangeDays],
    ).catch((err) => {
      logger.error("quality-dashboard-v2 db_audit aggregate failed", err);
      return [] as Array<{ User: string; calls: number; score_sum: string | null; scored_calls: number }>;
    });
    return rows.map((r) => ({
      user: r.User,
      calls: Number(r.calls) || 0,
      scoreSum: Number(r.score_sum) || 0,
      scoredCalls: Number(r.scored_calls) || 0,
    }));
  }

  private async employeesByCode(codes: string[]): Promise<Map<string, EmployeeInfo>> {
    if (codes.length === 0) return new Map();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, full_name, branch_id, process_id, reporting_manager_id, manager_id, active_status
         FROM employees
        WHERE employee_code IN (${codes.map(() => "?").join(",")})`,
      codes,
    );
    const map = new Map<string, EmployeeInfo>();
    for (const r of rows as any[]) {
      map.set(r.employee_code, {
        id: r.id,
        employeeCode: r.employee_code,
        fullName: r.full_name,
        branchId: r.branch_id,
        processId: r.process_id,
        reportsTo: r.reporting_manager_id ?? r.manager_id ?? null,
        activeStatus: !!r.active_status,
      });
    }
    return map;
  }

  /**
   * Single source of truth for "can this scope see this employee's data" —
   * shared by scopedUserRows (the branch/process/team/analyst drill levels)
   * and analystCalls (the level-5 individual-call drill). analystCalls used
   * to have no scope check at all for BRANCH_ALL/PROCESS_ALL/CUSTOM_SCOPE
   * callers — only the route's own SELF_ONLY/TEAM_ONLY special case existed,
   * so a BRANCH_ALL caller could pass any employeeId, including one outside
   * their branch, and read that employee's individually audited calls
   * (delta-audit 2026-08-14, P1). Extracted here so both call sites can
   * never drift apart on what "in scope" means.
   */
  private isEmployeeInScope(scope: DashboardScope, info: EmployeeInfo): boolean {
    if (!info.activeStatus) return false;
    if (scope.level === "ORG_ALL") return true;
    if (scope.level === "BRANCH_ALL") return !!info.branchId && scope.branchIds.includes(info.branchId);
    if (scope.level === "PROCESS_ALL") return !!info.processId && scope.processIds.includes(info.processId);
    if (scope.level === "TEAM_ONLY" || scope.level === "SELF_ONLY") return scope.employeeIds.includes(info.id);
    if (scope.level === "CUSTOM_SCOPE") {
      const branchOk = scope.branchIds.length === 0 || (!!info.branchId && scope.branchIds.includes(info.branchId));
      const processOk = scope.processIds.length === 0 || (!!info.processId && scope.processIds.includes(info.processId));
      return branchOk && processOk;
    }
    return false;
  }

  /** Scope-filter + join per-user call aggregates against employee identity, in application code. */
  private async scopedUserRows(scope: DashboardScope, rangeDays: number): Promise<Array<PerUserAgg & EmployeeInfo>> {
    const aggs = await this.perUserAggregates(rangeDays);
    const employees = await this.employeesByCode(aggs.map((a) => a.user));

    const out: Array<PerUserAgg & EmployeeInfo> = [];
    for (const agg of aggs) {
      const info = employees.get(agg.user);
      if (!info || !this.isEmployeeInScope(scope, info)) continue;
      out.push({ ...agg, ...info });
    }
    return out;
  }

  private rollup(rows: Array<PerUserAgg & EmployeeInfo>, keyOf: (r: PerUserAgg & EmployeeInfo) => string | null) {
    const groups = new Map<string, { agentCount: Set<string>; calls: number; scoreSum: number; scoredCalls: number }>();
    for (const r of rows) {
      const key = keyOf(r);
      if (!key) continue;
      const g = groups.get(key) ?? { agentCount: new Set<string>(), calls: 0, scoreSum: 0, scoredCalls: 0 };
      g.agentCount.add(r.id);
      g.calls += r.calls;
      g.scoreSum += r.scoreSum;
      g.scoredCalls += r.scoredCalls;
      groups.set(key, g);
    }
    return groups;
  }

  async branchLevel(scope: DashboardScope, rangeDays: number): Promise<QualitySummaryResponse> {
    const rows = await this.scopedUserRows(scope, rangeDays);
    const groups = this.rollup(rows, (r) => r.branchId);
    const names = await this.branchNames([...groups.keys()]);
    return this.toResponse("branch", null, null, groups, (id) => names.get(id) ?? "Unknown Branch", () => null, true, rangeDays);
  }

  async processLevel(branchId: string | null, scope: DashboardScope, rangeDays: number): Promise<QualitySummaryResponse> {
    if (!branchId) throw new Error("branchId is required for process level");
    const rows = (await this.scopedUserRows(scope, rangeDays)).filter((r) => r.branchId === branchId);
    const groups = this.rollup(rows, (r) => r.processId);
    const names = await this.processNames([...groups.keys()]);
    const parentLabel = (await this.branchNames([branchId])).get(branchId) ?? null;
    return this.toResponse("process", branchId, parentLabel, groups, (id) => names.get(id) ?? "Unassigned Process", () => null, true, rangeDays);
  }

  async teamLevel(processId: string | null, scope: DashboardScope, rangeDays: number): Promise<QualitySummaryResponse> {
    if (!processId) throw new Error("processId is required for team level");
    const rows = (await this.scopedUserRows(scope, rangeDays)).filter((r) => r.processId === processId);
    const groups = this.rollup(rows, (r) => r.reportsTo);
    const names = await this.employeeNames([...groups.keys()]);
    const parentLabel = (await this.processNames([processId])).get(processId) ?? null;
    return this.toResponse(
      "team", processId, parentLabel, groups,
      (id) => { const n = names.get(id); return n ? `${n.fullName}'s team` : "Unassigned team"; },
      (id) => names.get(id)?.employeeCode ?? null,
      true, rangeDays,
    );
  }

  async analystLevel(managerId: string | null, scope: DashboardScope, rangeDays: number): Promise<QualitySummaryResponse> {
    if (!managerId) throw new Error("managerId is required for analyst level");
    const rows = (await this.scopedUserRows(scope, rangeDays)).filter((r) => r.reportsTo === managerId);
    const groups = this.rollup(rows, (r) => r.id);
    const names = await this.employeeNames([...groups.keys()]);
    const parentInfo = (await this.employeeNames([managerId])).get(managerId);
    return this.toResponse(
      "analyst", managerId, parentInfo?.fullName ?? null, groups,
      (id) => names.get(id)?.fullName ?? "Unknown",
      (id) => names.get(id)?.employeeCode ?? null,
      false, rangeDays,
    );
  }

  private toResponse(
    level: QualityDrillLevel,
    parentId: string | null,
    parentLabel: string | null,
    groups: Map<string, { agentCount: Set<string>; calls: number; scoreSum: number; scoredCalls: number }>,
    nameOf: (id: string) => string,
    secondaryOf: (id: string) => string | null,
    hasChildren: boolean,
    rangeDays: number,
  ): QualitySummaryResponse {
    const nodes: QualityDrillNode[] = [...groups.entries()].map(([id, g]) => ({
      id,
      name: nameOf(id),
      secondaryLabel: secondaryOf(id),
      agentCount: g.agentCount.size,
      callsAudited: g.calls,
      avgQualityPct: g.scoredCalls > 0 ? round1(g.scoreSum / g.scoredCalls) : null,
      hasChildren,
    }));
    return { level, parentId, parentLabel, nodes, rangeDays, asOf: new Date().toISOString() };
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

  /** Level-5 drill: an analyst's individually audited calls for the range. */
  async analystCalls(employeeId: string, rangeDays: number, scope: DashboardScope): Promise<{
    employee: { id: string; fullName: string; employeeCode: string } | null;
    calls: Array<{
      id: number;
      callDate: string;
      client: string | null;
      qualityPct: number | null;
      totalScore: number | null;
      maxScore: number | null;
      areasForImprovement: string | null;
      params: {
        callOpen: number | null;
        professionalism: number | null;
        activeListening: number | null;
        callClosure: number | null;
        accuracy: number | null;
      };
    }>;
  }> {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, full_name, employee_code, branch_id, process_id, active_status
         FROM employees WHERE id = ? LIMIT 1`,
      [employeeId],
    );
    const emp = (empRows as any[])[0];
    // Out-of-scope reads identically to not-found, same information-hiding
    // choice used elsewhere in this codebase's row-scope fixes — a caller
    // cannot tell "exists outside my scope" from "doesn't exist".
    if (!emp || !this.isEmployeeInScope(scope, {
      id: emp.id, employeeCode: emp.employee_code, fullName: emp.full_name,
      branchId: emp.branch_id, processId: emp.process_id, reportsTo: null,
      activeStatus: !!emp.active_status,
    })) {
      return { employee: null, calls: [] };
    }

    const calls = await querySource<{
      id: number; ClientId: string | null; CallDate: string; quality_percentage: string | null;
      total_score: number | null; max_score: number | null; areas_for_improvement: string | null;
      call_answered_within_5_seconds: number | null;
      professionalism_maintained: number | null;
      active_listening: number | null;
      proper_call_closure: number | null;
      correct_and_complete_information: number | null;
    }>(
      `SELECT id, ClientId, CallDate, quality_percentage, total_score, max_score,
              areas_for_improvement,
              call_answered_within_5_seconds,
              professionalism_maintained,
              active_listening,
              proper_call_closure,
              correct_and_complete_information
         FROM db_audit.call_quality_assessment
        WHERE User = ?
          AND CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND quality_percentage IS NOT NULL
        ORDER BY CallDate DESC
        LIMIT 200`,
      [emp.employee_code, rangeDays],
    ).catch((err) => {
      logger.error("quality-dashboard-v2 analystCalls failed", err);
      return [];
    });

    return {
      employee: { id: employeeId, fullName: emp.full_name, employeeCode: emp.employee_code },
      calls: calls.map((c) => ({
        id: c.id,
        callDate: c.CallDate,
        client: c.ClientId,
        qualityPct: c.quality_percentage !== null ? Number(c.quality_percentage) : null,
        totalScore: c.total_score,
        maxScore: c.max_score,
        areasForImprovement: c.areas_for_improvement,
        params: {
          callOpen:       c.call_answered_within_5_seconds,
          professionalism: c.professionalism_maintained,
          activeListening: c.active_listening,
          callClosure:    c.proper_call_closure,
          accuracy:       c.correct_and_complete_information,
        },
      })),
    };
  }
}

export const qualityDashboardV2Service = new QualityDashboardV2Service();
