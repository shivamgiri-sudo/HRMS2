import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { calculateMetricScore } from './kpi-score-engine.js';

export type OrgUnitType = 'department' | 'designation' | 'process' | 'cost_centre';
export type Period = 'day' | 'wtd' | 'mtd' | 'past_month';

export interface KpiMasterConfigInput {
  metric_id: string;
  org_unit_type: OrgUnitType;
  org_unit_id: string;
  target_value: number;
  min_threshold?: number | null;
  max_achievement?: number;
  weightage?: number;
  created_by?: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export function getDateRange(period: Period): DateRange {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === 'day') {
    return { start: today, end: today };
  }

  if (period === 'wtd') {
    const day = now.getDay(); // 0=Sun, 1=Mon
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    const mon = new Date(now);
    mon.setDate(now.getDate() - diff);
    return { start: fmt(mon), end: today };
  }

  if (period === 'mtd') {
    return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today };
  }

  // past_month
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pmLast = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: fmt(pm), end: fmt(pmLast) };
}

// ─── List KPI master configs ─────────────────────────────────────────────────

export async function listKpiMasterConfig(filters: {
  org_unit_type?: OrgUnitType;
  is_active?: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.org_unit_type) {
    conditions.push('kmc.org_unit_type = ?');
    params.push(filters.org_unit_type);
  }
  if (filters.is_active !== undefined) {
    conditions.push('kmc.is_active = ?');
    params.push(filters.is_active);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      kmc.id,
      kmc.metric_id,
      kmm.metric_code,
      kmm.metric_name,
      kmm.category,
      kmm.unit,
      kmm.direction,
      kmm.family,
      kmc.org_unit_type,
      kmc.org_unit_id,
      COALESCE(
        dm.dept_name,
        desm.designation_name,
        pm.process_name,
        ccm.cost_centre_name
      ) AS org_unit_name,
      kmc.target_value,
      kmc.min_threshold,
      kmc.max_achievement,
      kmc.weightage,
      kmc.is_active,
      kmc.created_at,
      kmc.updated_at
    FROM kpi_master_config kmc
    JOIN kpi_metric_master kmm ON kmm.id = kmc.metric_id
    LEFT JOIN department_master  dm   ON kmc.org_unit_type = 'department'   AND dm.id   = kmc.org_unit_id
    LEFT JOIN designation_master desm ON kmc.org_unit_type = 'designation'  AND desm.id = kmc.org_unit_id
    LEFT JOIN process_master     pm   ON kmc.org_unit_type = 'process'      AND pm.id   = kmc.org_unit_id
    LEFT JOIN cost_centre_master ccm  ON kmc.org_unit_type = 'cost_centre'  AND ccm.id  = kmc.org_unit_id
    ${where}
    ORDER BY kmm.category, kmm.metric_name, kmc.org_unit_type
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

// ─── Upsert a KPI master config ───────────────────────────────────────────────

export async function upsertKpiMasterConfig(input: KpiMasterConfigInput) {
  const sql = `
    INSERT INTO kpi_master_config
      (metric_id, org_unit_type, org_unit_id, target_value, min_threshold,
       max_achievement, weightage, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON DUPLICATE KEY UPDATE
      target_value    = VALUES(target_value),
      min_threshold   = VALUES(min_threshold),
      max_achievement = VALUES(max_achievement),
      weightage       = VALUES(weightage),
      is_active       = 1,
      updated_at      = CURRENT_TIMESTAMP
  `;

  const [result] = await db.execute<ResultSetHeader>(sql, [
    input.metric_id,
    input.org_unit_type,
    input.org_unit_id,
    input.target_value,
    input.min_threshold ?? null,
    input.max_achievement ?? 120,
    input.weightage ?? 100,
    input.created_by ?? null,
  ]);

  return result;
}

// ─── Soft-delete ──────────────────────────────────────────────────────────────

export async function deleteKpiMasterConfig(id: string) {
  const [result] = await db.execute<ResultSetHeader>(
    'UPDATE kpi_master_config SET is_active = 0 WHERE id = ?',
    [id]
  );
  return result;
}

// ─── Resolve KPIs for employee ────────────────────────────────────────────────
// Priority: process(1) > cost_centre(2) > designation(3) > department(4)

export async function resolveEmployeeKpis(employeeId: string): Promise<number> {
  // Fetch employee org unit attributes
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT department_id, designation_id, process_id, cost_centre_id
     FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const emp = (empRows as any[])[0];
  if (!emp) throw new Error(`Employee not found: ${employeeId}`);

  const { department_id, designation_id, process_id, cost_centre_id } = emp;

  // Build dynamic WHERE across all applicable org units
  const orClauses: string[] = [];
  const params: unknown[] = [];

  if (process_id) {
    orClauses.push(`(kmc.org_unit_type = 'process' AND kmc.org_unit_id = ?)`);
    params.push(process_id);
  }
  if (cost_centre_id) {
    orClauses.push(`(kmc.org_unit_type = 'cost_centre' AND kmc.org_unit_id = ?)`);
    params.push(cost_centre_id);
  }
  if (designation_id) {
    orClauses.push(`(kmc.org_unit_type = 'designation' AND kmc.org_unit_id = ?)`);
    params.push(designation_id);
  }
  if (department_id) {
    orClauses.push(`(kmc.org_unit_type = 'department' AND kmc.org_unit_id = ?)`);
    params.push(department_id);
  }

  if (!orClauses.length) return 0;

  const sql = `
    SELECT
      kmc.metric_id,
      kmc.target_value,
      kmc.min_threshold,
      kmc.max_achievement,
      kmc.weightage,
      kmc.org_unit_type,
      CASE kmc.org_unit_type
        WHEN 'process'      THEN 1
        WHEN 'cost_centre'  THEN 2
        WHEN 'designation'  THEN 3
        WHEN 'department'   THEN 4
      END AS priority
    FROM kpi_master_config kmc
    WHERE kmc.is_active = 1 AND (${orClauses.join(' OR ')})
    ORDER BY kmc.metric_id, priority ASC
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  const candidates = rows as any[];

  // Deduplicate: keep lowest priority per metric_id
  const bestByMetric = new Map<string, any>();
  for (const row of candidates) {
    if (!bestByMetric.has(row.metric_id)) {
      bestByMetric.set(row.metric_id, row);
    }
  }

  if (!bestByMetric.size) return 0;

  // UPSERT into kpi_employee_resolved
  const upsertSql = `
    INSERT INTO kpi_employee_resolved
      (employee_id, metric_id, target_value, min_threshold, max_achievement, weightage, resolved_from)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      target_value    = VALUES(target_value),
      min_threshold   = VALUES(min_threshold),
      max_achievement = VALUES(max_achievement),
      weightage       = VALUES(weightage),
      resolved_from   = VALUES(resolved_from),
      resolved_at     = CURRENT_TIMESTAMP
  `;

  const PRIORITY_LABEL: Record<number, string> = { 1: 'process', 2: 'cost_centre', 3: 'designation', 4: 'department' };

  for (const row of bestByMetric.values()) {
    await db.execute(upsertSql, [
      employeeId,
      row.metric_id,
      row.target_value,
      row.min_threshold ?? null,
      row.max_achievement,
      row.weightage,
      PRIORITY_LABEL[row.priority] ?? row.org_unit_type,
    ]);
  }

  return bestByMetric.size;
}

// ─── Get resolved KPIs for employee ──────────────────────────────────────────

export async function getResolvedKpis(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ker.id,
       ker.metric_id,
       kmm.metric_code,
       kmm.metric_name,
       kmm.category,
       kmm.unit,
       kmm.direction,
       kmm.family,
       ker.target_value,
       ker.min_threshold,
       ker.max_achievement,
       ker.weightage,
       ker.resolved_from,
       ker.resolved_at
     FROM kpi_employee_resolved ker
     JOIN kpi_metric_master kmm ON kmm.id = ker.metric_id
     WHERE ker.employee_id = ?
     ORDER BY kmm.category, kmm.metric_name`,
    [employeeId]
  );
  return rows;
}

// ─── Live KPI performance ──────────────────────────────────────────────────────

export async function getLiveKpiPerformance(employeeId: string, period: Period) {
  const resolved = await getResolvedKpis(employeeId);
  if (!resolved.length) return { period, metrics: [] };

  const { start, end } = getDateRange(period);

  const metricIds = (resolved as any[]).map(r => r.metric_id);
  const placeholders = metricIds.map(() => '?').join(',');

  // Get daily actuals in date range
  const [actuals] = await db.execute<RowDataPacket[]>(
    `SELECT metric_id, score_date, actual_value, source
     FROM kpi_daily_actual
     WHERE employee_id = ?
       AND score_date BETWEEN ? AND ?
       AND metric_id IN (${placeholders})
     ORDER BY score_date ASC`,
    [employeeId, start, end, ...metricIds]
  );

  // Get rating config (S/A/B/C/D)
  const [ratingRows] = await db.execute<RowDataPacket[]>(
    `SELECT rating_label, min_score_pct, max_score_pct, color_code
     FROM kpi_rating_config WHERE process_id IS NULL ORDER BY min_score_pct DESC`
  );
  const ratingBands = ratingRows as any[];

  function getRating(scorePct: number) {
    for (const band of ratingBands) {
      if (scorePct >= Number(band.min_score_pct) && scorePct <= Number(band.max_score_pct)) {
        return { label: band.rating_label, color: band.color_code };
      }
    }
    return { label: 'D', color: '#dc2626' };
  }

  // Group daily actuals by metric_id
  const actualsByMetric = new Map<string, any[]>();
  for (const row of actuals as any[]) {
    if (!actualsByMetric.has(row.metric_id)) actualsByMetric.set(row.metric_id, []);
    actualsByMetric.get(row.metric_id)!.push(row);
  }

  const metrics = (resolved as any[]).map(kpi => {
    const dailyRows = actualsByMetric.get(kpi.metric_id) ?? [];
    const values = dailyRows.map(r => Number(r.actual_value)).filter(v => !isNaN(v));
    const avgActual = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

    let scorePct = 0;
    let scoreStatus: string = 'missing_source';

    if (avgActual !== null) {
      const scored = calculateMetricScore({
        scoringType: kpi.direction === 'lower_is_better' ? 'lower_better' : 'higher_better',
        actualValue: avgActual,
        targetValue: Number(kpi.target_value),
        minValue: kpi.min_threshold,
        maxValue: Number(kpi.max_achievement),
        weightage: Number(kpi.weightage),
      });
      scorePct = scored.metricScore;
      scoreStatus = scored.status;
    }

    const rating = avgActual !== null ? getRating(scorePct) : null;

    return {
      metric_id: kpi.metric_id,
      metric_code: kpi.metric_code,
      metric_name: kpi.metric_name,
      category: kpi.category,
      unit: kpi.unit,
      direction: kpi.direction,
      family: kpi.family,
      target_value: Number(kpi.target_value),
      min_threshold: kpi.min_threshold ? Number(kpi.min_threshold) : null,
      actual_value: avgActual,
      score_pct: scorePct,
      score_status: scoreStatus,
      rating: rating?.label ?? null,
      rating_color: rating?.color ?? null,
      resolved_from: kpi.resolved_from,
      trend_data: dailyRows.map(r => ({
        date: r.score_date instanceof Date
          ? r.score_date.toISOString().split('T')[0]
          : String(r.score_date).split('T')[0],
        value: Number(r.actual_value),
        source: r.source,
      })),
    };
  });

  // Overall weighted score
  const scored = metrics.filter(m => m.actual_value !== null);
  const totalWeight = scored.reduce((s, m) => s + (Number(m.score_pct) * Number((resolved as any[]).find(r => r.metric_id === m.metric_id)?.weightage ?? 100) / 100), 0);
  const weightSum = scored.reduce((s, m) => s + Number((resolved as any[]).find(r => r.metric_id === m.metric_id)?.weightage ?? 100), 0);
  const overallScore = weightSum > 0 ? totalWeight / weightSum * 100 : 0;
  const overallRating = scored.length ? getRating(overallScore) : null;

  return {
    period,
    date_range: { start, end },
    overall_score: Math.round(overallScore * 100) / 100,
    overall_rating: overallRating?.label ?? null,
    overall_rating_color: overallRating?.color ?? null,
    metrics,
  };
}

// ─── Org unit options for dropdown ────────────────────────────────────────────

export async function getOrgUnitOptions(type: OrgUnitType) {
  const tableMap: Record<OrgUnitType, { table: string; id: string; name: string }> = {
    department:  { table: 'department_master',  id: 'id', name: 'dept_name' },
    designation: { table: 'designation_master', id: 'id', name: 'designation_name' },
    process:     { table: 'process_master',     id: 'id', name: 'process_name' },
    cost_centre: { table: 'cost_centre_master', id: 'id', name: 'cost_centre_name' },
  };

  const { table, id, name } = tableMap[type];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT \`${id}\` AS id, \`${name}\` AS name FROM \`${table}\` ORDER BY \`${name}\``
  );
  return rows;
}

// ─── Team KPI summary (for manager view) ─────────────────────────────────────

export async function getTeamKpiSummary(managerEmployeeId: string, period: Period) {
  // Fetch direct reports
  const [teamRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
            pm.process_name
     FROM employees e
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE e.reporting_manager_id = ? AND e.active_status = 1
     ORDER BY full_name`,
    [managerEmployeeId]
  );
  const teamMembers = teamRows as any[];

  if (!teamMembers.length) {
    return {
      period,
      date_range: getDateRange(period),
      team_size: 0,
      team_avg_score: 0,
      team_rating: null,
      score_distribution: { S: 0, A: 0, B: 0, C: 0, D: 0, no_data: 0 },
      members_on_target: 0,
      members_at_risk: 0,
      per_metric_averages: [],
      members: [],
    };
  }

  // Get rating config for labelling
  const [ratingRows] = await db.execute<RowDataPacket[]>(
    `SELECT rating_label, min_score_pct, max_score_pct, color_code
     FROM kpi_rating_config WHERE process_id IS NULL ORDER BY min_score_pct DESC`
  );
  const ratingBands = ratingRows as any[];

  function getRatingLabel(score: number): string {
    for (const band of ratingBands) {
      if (score >= Number(band.min_score_pct) && score <= Number(band.max_score_pct)) return band.rating_label;
    }
    return 'D';
  }

  // Fetch per-member live performance in parallel
  const memberResults = await Promise.all(
    teamMembers.map(async (m) => {
      const perf = await getLiveKpiPerformance(m.id, period);
      return {
        employee_id: m.id,
        employee_code: m.employee_code,
        full_name: m.full_name,
        process_name: m.process_name ?? null,
        ...perf,
      };
    })
  );

  // Aggregate
  const dist: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, no_data: 0 };
  let totalScore = 0;
  let scoredCount = 0;
  let membersOnTarget = 0;
  let membersAtRisk = 0;

  // Per-metric aggregation across team
  const metricAccum = new Map<string, {
    metric_code: string; metric_name: string; unit: string; direction: string; category: string;
    values: number[]; scores: number[]; target: number;
  }>();

  for (const member of memberResults) {
    const hasData = (member.metrics as any[]).some(m => m.actual_value !== null);
    if (!hasData) {
      dist.no_data++;
      continue;
    }

    const score: number = member.overall_score ?? 0;
    totalScore += score;
    scoredCount++;

    const rating = getRatingLabel(score);
    dist[rating] = (dist[rating] ?? 0) + 1;

    if (score >= 90) membersOnTarget++;
    if (score < 60 && score > 0) membersAtRisk++;

    for (const m of member.metrics as any[]) {
      if (m.actual_value === null) continue;
      if (!metricAccum.has(m.metric_code)) {
        metricAccum.set(m.metric_code, {
          metric_code: m.metric_code,
          metric_name: m.metric_name,
          unit: m.unit,
          direction: m.direction,
          category: m.category,
          values: [],
          scores: [],
          target: m.target_value,
        });
      }
      const acc = metricAccum.get(m.metric_code)!;
      acc.values.push(m.actual_value);
      acc.scores.push(m.score_pct);
    }
  }

  const teamAvgScore = scoredCount > 0 ? Math.round((totalScore / scoredCount) * 100) / 100 : 0;
  const teamRating = scoredCount > 0 ? getRatingLabel(teamAvgScore) : null;

  const perMetricAverages = Array.from(metricAccum.values()).map(acc => ({
    metric_code: acc.metric_code,
    metric_name: acc.metric_name,
    unit: acc.unit,
    direction: acc.direction,
    category: acc.category,
    team_avg_actual: Math.round((acc.values.reduce((a, b) => a + b, 0) / acc.values.length) * 100) / 100,
    team_avg_score_pct: Math.round((acc.scores.reduce((a, b) => a + b, 0) / acc.scores.length) * 100) / 100,
    team_avg_rating: getRatingLabel(acc.scores.reduce((a, b) => a + b, 0) / acc.scores.length),
    target_value: acc.target,
    members_with_data: acc.values.length,
  }));

  return {
    period,
    date_range: getDateRange(period),
    team_size: teamMembers.length,
    team_avg_score: teamAvgScore,
    team_rating: teamRating,
    score_distribution: dist,
    members_on_target: membersOnTarget,
    members_at_risk: membersAtRisk,
    per_metric_averages: perMetricAverages,
    members: memberResults,
  };
}
