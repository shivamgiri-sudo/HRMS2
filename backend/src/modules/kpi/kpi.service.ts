import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queueAutoAwards } from "../engagement/badge.service.js";
import type {
  FamilySummary, KpiAssignment, KpiFamily, KpiMetric, KpiScore, KpiSummary,
  KpiTemplate, KpiTemplateMetric, LeaderboardEntry,
} from "./kpi.types.js";
import type {
  AddTemplateMetricInput, AssignTemplateInput, BulkScoreInput,
  CreateMetricInput, CreateTemplateInput, LeaderboardFilters,
  MetricsFilters, RecordScoreInput,
} from "./kpi.validation.js";

const r2 = (n: number) => Math.round(n * 100) / 100;

const RATING_THRESHOLDS: Array<{ min: number; rating: KpiSummary["rating"] }> = [
  { min: 100, rating: "S" },
  { min: 90,  rating: "A" },
  { min: 75,  rating: "B" },
  { min: 60,  rating: "C" },
  { min: 0,   rating: "D" },
];

function toRating(score: number): KpiSummary["rating"] {
  return (RATING_THRESHOLDS.find(t => score >= t.min) ?? RATING_THRESHOLDS[4]).rating;
}

export const kpiService = {
  // ─── Metrics ──────────────────────────────────────────────────────────────

  async listMetrics(filters: MetricsFilters = {}): Promise<KpiMetric[]> {
    const conds: string[] = ["active_status = 1"];
    const params: unknown[] = [];
    if (filters.family) {
      conds.push("family = ?");
      params.push(filters.family);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM kpi_metric_master WHERE ${conds.join(" AND ")} ORDER BY family, category, metric_name`,
      params
    );
    return rows as KpiMetric[];
  },

  async createMetric(input: CreateMetricInput, _userId: string): Promise<KpiMetric> {
    const [dup] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM kpi_metric_master WHERE metric_code = ? LIMIT 1", [input.metricCode]
    );
    if ((dup as RowDataPacket[]).length > 0) throw new Error("Metric code already exists");

    const id = randomUUID();
    await db.execute(
      "INSERT INTO kpi_metric_master (id, metric_code, metric_name, category, unit, direction) VALUES (?, ?, ?, ?, ?, ?)",
      [id, input.metricCode, input.metricName, input.category, input.unit, input.direction]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM kpi_metric_master WHERE id = ? LIMIT 1", [id]
    );
    return (rows as KpiMetric[])[0];
  },

  // ─── Templates ────────────────────────────────────────────────────────────

  async listTemplates(): Promise<KpiTemplate[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM kpi_template WHERE active_status = 1 ORDER BY template_name"
    );
    return rows as KpiTemplate[];
  },

  async createTemplate(input: CreateTemplateInput, _userId: string): Promise<KpiTemplate> {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO kpi_template (id, template_name, description) VALUES (?, ?, ?)",
      [id, input.templateName, input.description ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM kpi_template WHERE id = ? LIMIT 1", [id]
    );
    return (rows as KpiTemplate[])[0];
  },

  // ─── Template Metrics ─────────────────────────────────────────────────────

  async listTemplateMetrics(templateId: string): Promise<KpiTemplateMetric[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT tm.*, m.metric_code, m.metric_name, m.unit, m.direction
       FROM kpi_template_metric tm
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       WHERE tm.template_id = ?
       ORDER BY tm.weight_pct DESC`,
      [templateId]
    );
    return rows as KpiTemplateMetric[];
  },

  async addTemplateMetric(
    input: AddTemplateMetricInput & { templateId: string },
    _userId: string
  ): Promise<KpiTemplateMetric> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO kpi_template_metric (id, template_id, metric_id, target_value, weight_pct)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE target_value = VALUES(target_value), weight_pct = VALUES(weight_pct)`,
      [id, input.templateId, input.metricId, input.targetValue, input.weightPct]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM kpi_template_metric WHERE template_id = ? AND metric_id = ? LIMIT 1",
      [input.templateId, input.metricId]
    );
    return (rows as KpiTemplateMetric[])[0];
  },

  // ─── Assignments ──────────────────────────────────────────────────────────

  async assignTemplate(input: AssignTemplateInput, _userId: string): Promise<KpiAssignment> {
    if (!input.designationId && !input.departmentId && !input.employeeId) {
      throw new Error("Must specify at least one assignment target");
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO kpi_assignment (id, template_id, designation_id, department_id, employee_id)
       VALUES (?, ?, ?, ?, ?)`,
      [id, input.templateId, input.designationId ?? null, input.departmentId ?? null, input.employeeId ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM kpi_assignment WHERE id = ? LIMIT 1", [id]
    );
    return (rows as KpiAssignment[])[0];
  },

  async getEmployeeTemplate(employeeId: string): Promise<KpiAssignment | null> {
    // Priority: employee > designation > department
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ka.* FROM kpi_assignment ka
       LEFT JOIN employees e ON e.id = ?
       WHERE ka.active_status = 1
         AND (
           ka.employee_id = ?
           OR ka.designation_id = e.designation_id
           OR ka.department_id  = e.department_id
         )
       ORDER BY
         (ka.employee_id  IS NOT NULL) DESC,
         (ka.designation_id IS NOT NULL) DESC,
         (ka.department_id IS NOT NULL) DESC
       LIMIT 1`,
      [employeeId, employeeId]
    );
    return (rows as KpiAssignment[])[0] ?? null;
  },

  // ─── Scores ───────────────────────────────────────────────────────────────

  async recordScore(input: RecordScoreInput, _userId: string): Promise<KpiScore> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO kpi_score (id, employee_id, metric_id, period, actual_value, source)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = VALUES(source)`,
      [id, input.employeeId, input.metricId, input.period, input.actualValue, input.source ?? "manual"]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM kpi_score WHERE employee_id = ? AND metric_id = ? AND period = ? LIMIT 1",
      [input.employeeId, input.metricId, input.period]
    );
    const score = (rows as KpiScore[])[0];
    queueAutoAwards(input.employeeId, "kpi_score_recorded");
    return score;
  },

  async bulkRecordScores(input: BulkScoreInput, _userId: string): Promise<{ recorded: number }> {
    if (input.scores.length === 0) return { recorded: 0 };
    const valuePlaceholders = input.scores.map(() => "(UUID(), ?, ?, ?, ?, ?)").join(", ");
    const params: unknown[] = [];
    for (const s of input.scores) {
      params.push(s.employeeId, s.metricId, input.period, s.actualValue, s.source ?? "manual");
    }
    const [result] = await db.execute(
      `INSERT INTO kpi_score (id, employee_id, metric_id, period, actual_value, source)
       VALUES ${valuePlaceholders}
       ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = VALUES(source)`,
      params
    );
    for (const employeeId of new Set(input.scores.map((score) => score.employeeId))) {
      queueAutoAwards(employeeId, "kpi_score_recorded");
    }
    return { recorded: (result as any).affectedRows ?? input.scores.length };
  },

  // ─── Summary ──────────────────────────────────────────────────────────────

  async getEmployeeSummary(
    employeeId: string, templateId: string, period: string
  ): Promise<KpiSummary> {
    const [tplRows] = await db.execute<RowDataPacket[]>(
      `SELECT tm.metric_id, m.metric_code, tm.target_value, tm.weight_pct, m.direction
       FROM kpi_template_metric tm
       JOIN kpi_metric_master m ON m.id = tm.metric_id
       WHERE tm.template_id = ?`,
      [templateId]
    );
    const templateMetrics = tplRows as Array<{
      metric_id: string; metric_code: string; target_value: number; weight_pct: number; direction: string;
    }>;

    const metricIds = templateMetrics.map(m => m.metric_id);
    let actuals: Array<{ metric_id: string; actual_value: number }> = [];
    if (metricIds.length > 0) {
      const placeholders = metricIds.map(() => "?").join(", ");
      const [scoreRows] = await db.execute<RowDataPacket[]>(
        `SELECT metric_id, actual_value FROM kpi_score
         WHERE employee_id = ? AND period = ? AND metric_id IN (${placeholders})`,
        [employeeId, period, ...metricIds]
      );
      actuals = scoreRows as typeof actuals;
    }

    const actualMap = new Map(actuals.map(a => [a.metric_id, a.actual_value]));
    const MAX_ACHIEVEMENT = 1.2; // cap overachievement at 120%

    let weightedSum = 0;
    let totalWeight = 0;
    const metrics = templateMetrics.map(tm => {
      const actual = actualMap.get(tm.metric_id) ?? null;
      let achievementPct = 0;
      if (actual !== null && tm.target_value > 0) {
        const raw = tm.direction === "lower_is_better"
          ? tm.target_value / actual
          : actual / tm.target_value;
        achievementPct = r2(Math.min(raw, MAX_ACHIEVEMENT) * 100);
      }
      weightedSum += achievementPct * tm.weight_pct;
      totalWeight += tm.weight_pct;
      return { metric_id: tm.metric_id, metric_code: tm.metric_code, target_value: tm.target_value, actual_value: actual, weight_pct: tm.weight_pct, achievement_pct: achievementPct, direction: tm.direction };
    });

    const weightedScore = totalWeight > 0 ? r2(weightedSum / totalWeight) : 0;

    return {
      employee_id: employeeId,
      template_id: templateId,
      period,
      weighted_score_pct: weightedScore,
      rating: toRating(weightedScore),
      metrics,
    };
  },

  // ─── Leaderboard ──────────────────────────────────────────────────────────

  async getLeaderboard(filters: LeaderboardFilters): Promise<LeaderboardEntry[]> {
    const conds: string[] = ["DATE_FORMAT(kda.score_date, '%Y-%m') = ?"];
    const params: unknown[] = [filters.period];
    if (filters.branchId)  { conds.push("e.branch_id = ?");  params.push(filters.branchId); }
    if (filters.processId) { conds.push("e.process_id = ?"); params.push(filters.processId); }
    if (filters.family)    { conds.push("m.family = ?");     params.push(filters.family); }
    const limit = filters.limit ?? 50;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         e.id AS employee_id,
         e.employee_code,
         e.full_name,
         ROUND(SUM((
           CASE WHEN m.direction = 'lower_is_better'
                THEN LEAST(kpc.target_value / NULLIF(kda.actual_value,0), 1.2)
                ELSE LEAST(kda.actual_value / NULLIF(kpc.target_value,0), 1.2)
           END * 100
         ) * kpc.weightage) / NULLIF(SUM(kpc.weightage), 0), 2) AS weighted_score_pct
       FROM kpi_daily_actual kda
       JOIN employees e ON e.id = kda.employee_id AND e.active_status = 1
       JOIN kpi_process_config kpc
         ON kpc.process_id = e.process_id
        AND kpc.metric_id = kda.metric_id
       JOIN kpi_metric_master m ON m.id = kda.metric_id
       WHERE ${conds.join(" AND ")}
       GROUP BY e.id, e.employee_code, e.full_name
       ORDER BY weighted_score_pct DESC
       LIMIT ${limit}`,
      params
    );

    return (rows as any[]).map(row => ({
      ...row,
      rating: toRating(Number(row.weighted_score_pct)),
    }));
  },

  // ─── Family Summary ───────────────────────────────────────────────────────

  async getFamilySummary(processId: string, period: string): Promise<FamilySummary> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         m.family,
         ROUND(
           SUM(
             CASE WHEN m.direction = 'lower_is_better'
                  THEN LEAST(tm.target_value / NULLIF(ks.actual_value, 0), 1.2)
                  ELSE LEAST(ks.actual_value / NULLIF(tm.target_value, 0), 1.2)
             END * tm.weight_pct
           ) / NULLIF(SUM(tm.weight_pct), 0) * 100, 2
         ) AS avg_score,
         COUNT(DISTINCT ks.employee_id) AS employees_scored
       FROM kpi_score ks
       JOIN employees e ON e.id = ks.employee_id
       JOIN kpi_template_metric tm ON tm.metric_id = ks.metric_id
       JOIN kpi_metric_master m ON m.id = ks.metric_id
       WHERE ks.period = ? AND e.process_id = ?
       GROUP BY m.family`,
      [period, processId]
    );

    const defaultEntry = { avg_score: 0, employees_scored: 0 };
    const result: FamilySummary = {
      operations:  { ...defaultEntry },
      quality:     { ...defaultEntry },
      performance: { ...defaultEntry },
      custom:      { ...defaultEntry },
    };

    for (const row of rows as Array<{ family: KpiFamily; avg_score: number; employees_scored: number }>) {
      if (row.family in result) {
        result[row.family] = {
          avg_score: Number(row.avg_score),
          employees_scored: Number(row.employees_scored),
        };
      }
    }
    return result;
  },
};
