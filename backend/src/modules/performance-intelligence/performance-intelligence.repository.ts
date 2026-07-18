import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  buildScopeWhereEmployees,
  type DashboardScope,
} from "../../shared/dashboardScope.js";
import {
  PERFORMANCE_METRIC_CODES,
  type MetricFact,
  type PerformanceMetricCode,
  type PerformancePersonRow,
  type PerformanceQuery,
  type PerformanceRepository,
} from "./performance-intelligence.contracts.js";

type MetricFactRow = RowDataPacket & {
  employee_id: string;
  metric_code: PerformanceMetricCode;
  score_date: string;
  actual_value: number | string | null;
  numerator_value: number | string | null;
  denominator_value: number | string | null;
  target_value: number | string | null;
  direction: "higher_is_better" | "lower_is_better";
  source_system: string | null;
  source_record_count: number | string | null;
  formula_version: string | null;
  computed_at: Date | string;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function mapFact(row: MetricFactRow): MetricFact {
  return {
    employeeId: String(row.employee_id),
    metricCode: row.metric_code,
    scoreDate: String(row.score_date),
    actualValue: numberOrNull(row.actual_value),
    numeratorValue: numberOrNull(row.numerator_value),
    denominatorValue: numberOrNull(row.denominator_value),
    targetValue: numberOrNull(row.target_value),
    direction: row.direction,
    sourceSystem: row.source_system ? String(row.source_system) : null,
    sourceRecordCount: numberOrNull(row.source_record_count),
    formulaVersion: row.formula_version ? String(row.formula_version) : null,
    computedAt: toIso(row.computed_at),
  };
}

const DATABASE_METRIC_CODES = PERFORMANCE_METRIC_CODES.map((code) =>
  code === "CALLS" ? "DIALS" : code
);
const metricPlaceholders = DATABASE_METRIC_CODES.map(() => "?").join(", ");

async function listFacts(
  scope: DashboardScope,
  query: PerformanceQuery,
  employeeIds?: string[],
): Promise<MetricFact[]> {
  if (employeeIds && employeeIds.length === 0) return [];

  const scoped = buildScopeWhereEmployees(scope, "e");
  const conditions = [
    "e.active_status = 1",
    scoped.sql,
    "kda.score_date BETWEEN ? AND ?",
    `kmm.metric_code IN (${metricPlaceholders})`,
  ];
  const params: unknown[] = [
    ...scoped.params,
    query.from,
    query.to,
    ...DATABASE_METRIC_CODES,
  ];

  if (employeeIds) {
    conditions.push(`e.id IN (${employeeIds.map(() => "?").join(", ")})`);
    params.push(...employeeIds);
  }

  const [rows] = await db.execute<MetricFactRow[]>(
    `SELECT
       e.id AS employee_id,
       CASE WHEN kmm.metric_code = 'DIALS' THEN 'CALLS' ELSE kmm.metric_code END AS metric_code,
       DATE_FORMAT(kda.score_date, '%Y-%m-%d') AS score_date,
       kda.actual_value,
       kda.numerator_value,
       kda.denominator_value,
       ker.target_value,
       kmm.direction,
       COALESCE(kda.source_system, CAST(kda.source AS CHAR)) AS source_system,
       kda.source_record_count,
       CASE
         WHEN kfv.id IS NULL THEN NULL
         ELSE CONCAT(kfv.formula_code, ':v', kfv.version_no)
       END AS formula_version,
       COALESCE(kda.computed_at, kda.created_at) AS computed_at
     FROM kpi_daily_actual kda
     JOIN employees e
       ON e.id = kda.employee_id
     JOIN kpi_metric_master kmm
       ON kmm.id = kda.metric_id
      AND kmm.active_status = 1
     LEFT JOIN kpi_employee_resolved ker
       ON ker.employee_id = e.id
      AND ker.metric_id = kda.metric_id
     LEFT JOIN kpi_formula_version kfv
       ON kfv.id = kda.formula_version_id
      AND kfv.status = 'active'

     WHERE ${conditions.join(" AND ")}
     ORDER BY kda.score_date ASC, e.id ASC, kmm.metric_code ASC`,
    params,
  );

  return rows.map(mapFact);
}

export const performanceIntelligenceRepository: PerformanceRepository = {
  async findSubjectEmployeeId(userId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id
         FROM employees
        WHERE user_id = ?
          AND active_status = 1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0]?.id ? String(rows[0].id) : null;
  },

  async canAccessEmployee(scope, employeeId) {
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id
         FROM employees e
        WHERE e.id = ?
          AND e.active_status = 1
          AND ${scoped.sql}
        LIMIT 1`,
      [employeeId, ...scoped.params],
    );
    return rows.length > 0;
  },

  async listMetricFacts(scope, query, subjectEmployeeId) {
    return listFacts(
      scope,
      query,
      subjectEmployeeId ? [subjectEmployeeId] : undefined,
    );
  },

  async listDailyTrendFacts(scope, query, subjectEmployeeId) {
    return listFacts(
      scope,
      query,
      subjectEmployeeId ? [subjectEmployeeId] : undefined,
    );
  },

  async listPeople(scope, query) {
    const scoped = buildScopeWhereEmployees(scope, "e");
    // MariaDB variants used in production can reject LIMIT/OFFSET as prepared
    // statement parameters. These values are already validated/coerced by
    // parsePerformanceQuery, so inline bounded integers while keeping all
    // data-bearing filters parameterized.
    const pageSize = Math.max(1, Math.min(100, Math.trunc(query.pageSize)));
    const offset = Math.max(0, (Math.max(1, Math.trunc(query.page)) - 1) * pageSize);
    const conditions = ["e.active_status = 1", scoped.sql];
    const params = [...scoped.params];

    const [[countRows], [rows]] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
           FROM employees e
          WHERE ${conditions.join(" AND ")}`,
        params,
      ),
      db.execute<RowDataPacket[]>(
        `SELECT
           e.id AS employee_id,
           e.employee_code,
           COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
           bm.branch_name,
           pm.process_name
         FROM employees e
         LEFT JOIN (
           SELECT employee_id, COUNT(*) AS fact_count
             FROM kpi_daily_actual
            WHERE score_date BETWEEN ? AND ?
            GROUP BY employee_id
         ) perf ON perf.employee_id = e.id
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
         LEFT JOIN process_master pm ON pm.id = e.process_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY COALESCE(perf.fact_count, 0) DESC, employee_name ASC, e.employee_code ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
        [query.from, query.to, ...params],
      ),
    ]);

    return {
      total: Number(countRows[0]?.total ?? 0),
      rows: rows.map((row): Omit<PerformancePersonRow, "metrics" | "overallAchievementPct"> => ({
        employeeId: String(row.employee_id),
        employeeCode: String(row.employee_code ?? ""),
        employeeName: String(row.employee_name ?? row.employee_code ?? "Employee"),
        branchName: row.branch_name ? String(row.branch_name) : null,
        processName: row.process_name ? String(row.process_name) : null,
      })),
    };
  },

  async listMetricFactsForEmployees(scope, query, employeeIds) {
    return listFacts(scope, query, employeeIds);
  },
};
