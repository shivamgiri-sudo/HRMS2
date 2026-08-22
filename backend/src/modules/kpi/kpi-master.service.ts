import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { calculateMetricScore } from './kpi-score-engine.js';

export type OrgUnitType = 'department' | 'designation' | 'process' | 'cost_centre';
export type Period = 'day' | 'wtd' | 'mtd' | 'past_month';

export interface KpiMasterConfigInput {
  metric_id: string;
  org_unit_type: OrgUnitType;
  org_unit_id: string;
  /**
   * Optional second dimension. NULL means "every designation in this org unit", which is
   * what every pre-1035 row means. Set it to target e.g. EXECUTIVE on one process
   * differently from TEAM LEADER on the same process.
   */
  designation_id?: string | null;
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

export function getDateRange(period: Period, anchorDate?: string): DateRange {
  const now = anchorDate ? new Date(`${anchorDate}T12:00:00`) : new Date();
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
    LEFT JOIN department_master  dm   ON kmc.org_unit_type = 'department'   AND dm.id   = kmc.org_unit_id COLLATE utf8mb4_unicode_ci
    LEFT JOIN designation_master desm ON kmc.org_unit_type = 'designation'  AND desm.id = kmc.org_unit_id COLLATE utf8mb4_unicode_ci
    LEFT JOIN process_master     pm   ON kmc.org_unit_type = 'process'      AND pm.id   = kmc.org_unit_id COLLATE utf8mb4_unicode_ci
    LEFT JOIN cost_centre_master ccm  ON kmc.org_unit_type = 'cost_centre'  AND ccm.id  = kmc.org_unit_id COLLATE utf8mb4_unicode_ci
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
      (metric_id, org_unit_type, org_unit_id, designation_id, target_value, min_threshold,
       max_achievement, weightage, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
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
    input.designation_id ?? null,
    input.target_value,
    input.min_threshold ?? null,
    input.max_achievement ?? 120,
    input.weightage ?? 100,
    input.created_by ?? null,
  ]);

  return result;
}

/**
 * Clears a single cell so it falls back to whatever it inherits, rather than deleting the
 * row's meaning. Scoped by the full key including designation so clearing the EXECUTIVE
 * override on a process cannot take the process-wide row with it.
 */
export async function clearKpiMasterConfigCell(input: {
  metric_id: string;
  org_unit_type: OrgUnitType;
  org_unit_id: string;
  designation_id?: string | null;
}) {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE kpi_master_config
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE metric_id = ?
        AND org_unit_type = ?
        AND org_unit_id = ?
        AND COALESCE(designation_id, '~ANY~') = COALESCE(?, '~ANY~')`,
    [input.metric_id, input.org_unit_type, input.org_unit_id, input.designation_id ?? null],
  );
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

/**
 * Restrict target resolution to the version in force today — but only once the
 * columns exist.
 *
 * kpi_master_config upserts in place, so editing a target rewrites history: a
 * score computed in June against a target of 80 later reports as having been
 * measured against 95, and a performance conversation cannot separate "the agent
 * got worse" from "we raised the bar". Migration 1048 adds effective_from /
 * effective_to to fix that.
 *
 * The check is not defensive padding. Production runs SKIP_MIGRATIONS=true, so
 * this code can ship before 1048 is applied, and an unconditional predicate
 * would make every KPI resolution fail with ER_BAD_FIELD_ERROR. That exact
 * sequence took reimbursements down from the day it shipped, and made every LMS
 * mapping save throw silently. getLineageColumns() in kpi-data-connector guards
 * the same way.
 */
let effectiveDatingSupported: boolean | null = null;

async function effectiveDatingPredicate(): Promise<string> {
  if (effectiveDatingSupported === null) {
    const [rows] = await db
      .execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS n
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'kpi_master_config'
            AND COLUMN_NAME IN ('effective_from', 'effective_to')`,
      )
      .catch(() => [[{ n: 0 }], []] as any);
    effectiveDatingSupported = Number((rows as any[])[0]?.n ?? 0) === 2;
  }
  // NULL on either bound means "no bound", not "excluded".
  //
  // This originally read `kmc.effective_from <= CURDATE()`. Both columns already
  // existed on production — added by an earlier change, nullable, and NULL on
  // all 372 rows — so the support check found them, switched the filter on, and
  // NULL <= CURDATE() is never true. Every target row would have been filtered
  // out and every employee would have resolved to zero KPIs.
  //
  // Caught by executing the migration against a throwaway schema rather than
  // reading it. A NULL-tolerant predicate is also the right semantics
  // independently: a target with no start date has always applied.
  return effectiveDatingSupported
    ? "AND (kmc.effective_from IS NULL OR kmc.effective_from <= CURDATE()) " +
      "AND (kmc.effective_to IS NULL OR kmc.effective_to >= CURDATE())"
    : "";
}

/** Exposed so a test, or a process that just ran the migration, can re-check. */
export function resetEffectiveDatingSupport() {
  effectiveDatingSupported = null;
}

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

  if (process_id && designation_id) {
    orClauses.push(
      `(kmc.org_unit_type = 'process' AND kmc.org_unit_id = ? AND kmc.designation_id = ?)`
    );
    params.push(process_id, designation_id);
  }
  if (process_id) {
    orClauses.push(`(kmc.org_unit_type = 'process' AND kmc.org_unit_id = ? AND kmc.designation_id IS NULL)`);
    params.push(process_id);
  }
  if (cost_centre_id) {
    orClauses.push(`(kmc.org_unit_type = 'cost_centre' AND kmc.org_unit_id = ? AND kmc.designation_id IS NULL)`);
    params.push(cost_centre_id);
  }
  if (designation_id) {
    orClauses.push(`(kmc.org_unit_type = 'designation' AND kmc.org_unit_id = ?)`);
    params.push(designation_id);
  }
  if (department_id) {
    orClauses.push(`(kmc.org_unit_type = 'department' AND kmc.org_unit_id = ? AND kmc.designation_id IS NULL)`);
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
      CASE
        WHEN kmc.org_unit_type = 'process'     AND kmc.designation_id IS NOT NULL THEN 0
        WHEN kmc.org_unit_type = 'process'     THEN 1
        WHEN kmc.org_unit_type = 'cost_centre' THEN 2
        WHEN kmc.org_unit_type = 'designation' THEN 3
        WHEN kmc.org_unit_type = 'department'  THEN 4
      END AS priority
    FROM kpi_master_config kmc
    WHERE kmc.is_active = 1 AND (${orClauses.join(' OR ')})
      ${await effectiveDatingPredicate()}
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

  const PRIORITY_LABEL: Record<number, string> = {
    0: 'process_designation',
    1: 'process',
    2: 'cost_centre',
    3: 'designation',
    4: 'department',
  };

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
       kmm.scoring_type,
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

/**
 * A metric opts in to floor gating by setting scoring_type; until then it scores exactly as
 * before. min_threshold sits on the worse side of the target — below it when higher is
 * better, above it when lower is better — so the direction picks which gate applies.
 */
function scoringTypeFor(kpi: { direction?: string | null; scoring_type?: string | null }): string {
  const lowerBetter = kpi.direction === 'lower_is_better';
  if (kpi.scoring_type) {
    if (kpi.scoring_type === 'floor_gated') return lowerBetter ? 'floor_gated_lower' : 'floor_gated_higher';
    return kpi.scoring_type;
  }
  return lowerBetter ? 'lower_better' : 'higher_better';
}

/**
 * Direction-aware percentile of `myValue` among `peerValues` (each peer's own
 * period average for this same metric). For a lower_is_better metric (AHT,
 * ACW), beating more peers means having a LOWER average than more of them —
 * inverting this would tell an agent they're in the top percentile for being
 * the slowest on the team. Returns null when there's no meaningful peer set
 * (fewer than 2 peers) rather than a misleading 0/100.
 */
export function computePercentile(myValue: number, peerValues: number[], lowerIsBetter: boolean): number | null {
  if (peerValues.length < 2) return null;
  const beatenOrTied = peerValues.filter(v => (lowerIsBetter ? v >= myValue : v <= myValue)).length;
  return Math.round((beatenOrTied / peerValues.length) * 100);
}

// ─── Live KPI performance ──────────────────────────────────────────────────────

export async function getLiveKpiPerformance(employeeId: string, period: Period, anchorDate?: string) {
  // Keep the employee cache aligned with the current process/designation/
  // department configuration before reading source facts.
  await resolveEmployeeKpis(employeeId);
  const resolved = await getResolvedKpis(employeeId);
  if (!resolved.length) return { period, metrics: [], daily_performance: [] };

  const { start, end } = getDateRange(period, anchorDate);

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

  // Peer comparison: same job/process peer group, same date range, same metrics.
  // Peer group narrows from most to least specific (process+designation is who
  // this employee actually works alongside doing the same job; department is a
  // fallback for anyone process/designation can't group). Mirrors the same
  // "exclude automated test records" pattern kpi.service.ts's leaderboard query
  // uses — a Codex E2E synthetic employee sharing a process would otherwise
  // silently distort a real employee's peer average.
  const peerAverages = new Map<string, { peer_avg: number; peer_count: number }>();
  const peerValuesByMetric = new Map<string, Array<{ employee_id: string; avg_value: number }>>();
  try {
    const [empOrgRows] = await db.execute<RowDataPacket[]>(
      `SELECT department_id, designation_id, process_id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const empOrg = (empOrgRows as any[])[0];
    let peerClause: string | null = null;
    let peerParam: string | null = null;
    if (empOrg?.process_id && empOrg?.designation_id) {
      peerClause = 'e.process_id = ? AND e.designation_id = ?';
    } else if (empOrg?.process_id) {
      peerClause = 'e.process_id = ?';
    } else if (empOrg?.designation_id) {
      peerClause = 'e.designation_id = ?';
    } else if (empOrg?.department_id) {
      peerClause = 'e.department_id = ?';
    }

    if (peerClause && metricIds.length) {
      const peerParams: unknown[] = empOrg?.process_id && empOrg?.designation_id
        ? [empOrg.process_id, empOrg.designation_id]
        : [empOrg?.process_id ?? empOrg?.designation_id ?? empOrg?.department_id];

      const [peerRows] = await db.execute<RowDataPacket[]>(
        `SELECT kda.metric_id, kda.employee_id, AVG(kda.actual_value) AS avg_value
         FROM kpi_daily_actual kda
         JOIN employees e ON e.id = kda.employee_id AND e.active_status = 1
         WHERE kda.metric_id IN (${placeholders})
           AND kda.score_date BETWEEN ? AND ?
           AND ${peerClause}
           AND e.employee_code NOT LIKE 'CODEX\\_E2E%'
           AND COALESCE(e.full_name, '') NOT LIKE '%Codex E2E%'
         GROUP BY kda.metric_id, kda.employee_id`,
        [...metricIds, start, end, ...peerParams]
      );

      for (const row of peerRows as any[]) {
        const avgValue = Number(row.avg_value);
        if (isNaN(avgValue)) continue;
        if (!peerValuesByMetric.has(row.metric_id)) peerValuesByMetric.set(row.metric_id, []);
        peerValuesByMetric.get(row.metric_id)!.push({ employee_id: row.employee_id, avg_value: avgValue });
      }
      for (const [metricId, values] of peerValuesByMetric) {
        // Include self in both the average and the count — "peer average" reads
        // as "people like me" and excluding self from a 2-person process would
        // make "peer average" mean "the one other person", which is misleading.
        const sum = values.reduce((s, v) => s + v.avg_value, 0);
        peerAverages.set(metricId, {
          peer_avg: Math.round((sum / values.length) * 100) / 100,
          peer_count: values.length,
        });
      }
    }
  } catch {
    // Peer comparison is an enrichment, not core data — if it fails for any
    // reason (missing org-unit columns, transient query error), the KPI card
    // must still render with real scores; peer_avg/percentile simply stay null.
  }

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
        scoringType: scoringTypeFor(kpi),
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

    // Percentile among the peer group actually queried above (same process +
    // designation where available), direction-aware: for a lower_is_better
    // metric like AHT, beating more peers means having a LOWER average than
    // more of them, not a higher one.
    const peerInfo = peerAverages.get(kpi.metric_id) ?? null;
    const percentile = avgActual !== null && peerInfo
      ? computePercentile(
          avgActual,
          (peerValuesByMetric.get(kpi.metric_id) ?? []).map(v => v.avg_value),
          kpi.direction === 'lower_is_better'
        )
      : null;

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
      peer_avg: peerInfo?.peer_avg ?? null,
      peer_count: peerInfo?.peer_count ?? null,
      percentile,
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

  const resolvedByMetric = new Map((resolved as any[]).map((row) => [row.metric_id, row]));
  const dailyActuals = new Map<string, any[]>();
  for (const row of actuals as any[]) {
    const date = row.score_date instanceof Date
      ? row.score_date.toISOString().split('T')[0]
      : String(row.score_date).split('T')[0];
    if (!dailyActuals.has(date)) dailyActuals.set(date, []);
    dailyActuals.get(date)!.push(row);
  }

  const dailyPerformance = Array.from(dailyActuals.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, rows]) => {
      let weightedScore = 0;
      let dailyWeight = 0;
      const dailyMetrics = rows.map((row) => {
        const kpi = resolvedByMetric.get(row.metric_id);
        if (!kpi) return null;
        const actualValue = Number(row.actual_value);
        const result = calculateMetricScore({
          scoringType: scoringTypeFor(kpi),
          actualValue,
          targetValue: Number(kpi.target_value),
          minValue: kpi.min_threshold,
          maxValue: Number(kpi.max_achievement),
          weightage: Number(kpi.weightage),
        });
        const weight = Number(kpi.weightage ?? 100);
        weightedScore += result.metricScore * weight;
        dailyWeight += weight;
        return {
          metric_id: row.metric_id,
          metric_code: kpi.metric_code,
          metric_name: kpi.metric_name,
          unit: kpi.unit,
          actual_value: actualValue,
          target_value: Number(kpi.target_value),
          score_pct: result.metricScore,
          source: row.source,
        };
      }).filter(Boolean);
      const score = dailyWeight > 0 ? weightedScore / dailyWeight : 0;
      const rating = dailyMetrics.length ? getRating(score) : null;
      return {
        date,
        overall_score: Math.round(score * 100) / 100,
        overall_rating: rating?.label ?? null,
        overall_rating_color: rating?.color ?? null,
        metrics: dailyMetrics,
      };
    });

  return {
    period,
    date_range: { start, end },
    overall_score: Math.round(overallScore * 100) / 100,
    overall_rating: overallRating?.label ?? null,
    overall_rating_color: overallRating?.color ?? null,
    metrics,
    daily_performance: dailyPerformance,
  };
}

// ─── Target matrix: every process × designation pair that has employees ──────────────
//
// The two existing config screens each show one slice at a time — /kpi-config one process
// per visit, /kpi-master a flat list of every row — so there has never been a view that
// answers "what is EXECUTIVE on Onfido actually targeted at, and where did that number come
// from". This builds that view in one payload.
//
// Only pairs with active headcount are returned. The full cross product is 55 processes ×
// 42 designations = 2,310 cells, of which 133 exist in reality.

export type CellSource = 'explicit' | 'process' | 'cost_centre' | 'designation' | 'department' | 'none';

/** Mirrors resolveEmployeeKpis()'s priority. Kept adjacent so the two cannot drift apart. */
const MATRIX_TIERS: ReadonlyArray<{ source: CellSource; key: (pair: MatrixPair) => string | null }> = [
  { source: 'explicit',    key: (p) => (p.process_id && p.designation_id ? `process|${p.process_id}|${p.designation_id}` : null) },
  { source: 'process',     key: (p) => (p.process_id ? `process|${p.process_id}|~ANY~` : null) },
  { source: 'cost_centre', key: (p) => (p.cost_centre_id ? `cost_centre|${p.cost_centre_id}|~ANY~` : null) },
  { source: 'designation', key: (p) => (p.designation_id ? `designation|${p.designation_id}|~ANY~` : null) },
  { source: 'department',  key: (p) => (p.department_id ? `department|${p.department_id}|~ANY~` : null) },
];

export interface MatrixPair {
  process_id: string | null;
  process_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  headcount: number;
  department_id: string | null;
  cost_centre_id: string | null;
  /**
   * True when the pair's employees sit in more than one department or cost centre, so an
   * inherited value shown here does not apply identically to all of them.
   */
  inherit_varies: boolean;
}

export async function getKpiTargetMatrix() {
  const [pairRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.process_id,
       p.process_name,
       e.designation_id,
       d.designation_name,
       COUNT(*)                              AS headcount,
       MIN(e.department_id)                  AS department_id,
       MIN(e.cost_centre_id)                 AS cost_centre_id,
       COUNT(DISTINCT e.department_id)       AS department_variants,
       COUNT(DISTINCT e.cost_centre_id)      AS cost_centre_variants
     FROM employees e
     LEFT JOIN process_master     p ON p.id = e.process_id
     LEFT JOIN designation_master d ON d.id = e.designation_id
     WHERE e.active_status = 1 AND e.employment_status = 'active'
     GROUP BY e.process_id, p.process_name, e.designation_id, d.designation_name
     ORDER BY headcount DESC`
  );

  // A metric earns a column if it can actually be scored — it already receives actuals — or
  // if somebody has configured it.
  const [metricRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       m.id, m.metric_code, m.metric_name, m.unit, m.direction, m.category,
       COALESCE(a.n, 0) AS actual_rows,
       COALESCE(c.n, 0) AS config_rows
     FROM kpi_metric_master m
     LEFT JOIN (SELECT metric_id, COUNT(*) AS n FROM kpi_daily_actual GROUP BY metric_id) a
            ON a.metric_id = m.id
     LEFT JOIN (SELECT metric_id, COUNT(*) AS n FROM kpi_master_config WHERE is_active = 1 GROUP BY metric_id) c
            ON c.metric_id = m.id
     WHERE COALESCE(a.n, 0) > 0 OR COALESCE(c.n, 0) > 0
     ORDER BY m.category, m.metric_name`
  );

  const [configRows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_id, org_unit_type, org_unit_id, designation_id,
            target_value, min_threshold, max_achievement, weightage
       FROM kpi_master_config
      WHERE is_active = 1`
  );

  // Which metrics each process actually produces. Processes do not share a metric set:
  // an e-commerce process reports AOV/COD_SHARE/RTO_RATE, a voice process reports
  // AHT/ACW/TALK_TIME, and CUSTOMER ACQUISITION (671 people) reports attendance alone.
  // Offering every metric everywhere would invite a revenue target on a process that has
  // never recorded a sale.
  const [producedRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.process_id, a.metric_id
       FROM kpi_daily_actual a
       JOIN employees e ON e.id = a.employee_id
      WHERE e.process_id IS NOT NULL
      GROUP BY e.process_id, a.metric_id`
  );
  const producedByProcess = new Set(
    (producedRows as any[]).map((row) => `${row.process_id}|${row.metric_id}`),
  );

  // Keyed by metric as well as scope — without it every metric sharing a scope would
  // overwrite the previous one and the whole grid would show a single metric's targets.
  const configIndex = new Map<string, any>();
  for (const row of configRows as any[]) {
    const designation = row.designation_id ? String(row.designation_id) : '~ANY~';
    configIndex.set(`${row.metric_id}|${row.org_unit_type}|${row.org_unit_id}|${designation}`, row);
  }

  const pairs: MatrixPair[] = (pairRows as any[]).map((row) => ({
    process_id: row.process_id ? String(row.process_id) : null,
    process_name: row.process_name ?? null,
    designation_id: row.designation_id ? String(row.designation_id) : null,
    designation_name: row.designation_name ?? null,
    headcount: Number(row.headcount),
    department_id: row.department_id ? String(row.department_id) : null,
    cost_centre_id: row.cost_centre_id ? String(row.cost_centre_id) : null,
    inherit_varies: Number(row.department_variants) > 1 || Number(row.cost_centre_variants) > 1,
  }));

  const cells: Record<string, {
    target_value: number | null;
    min_threshold: number | null;
    max_achievement: number | null;
    weightage: number | null;
    source: CellSource;
    /**
     * Whether this metric is measured for this process at all. False means no employee on
     * the process has ever produced the metric and nobody has configured it.
     */
    applicable: boolean;
  }> = {};

  for (const pair of pairs) {
    for (const metric of metricRows as any[]) {
      let resolved: { row: any; source: CellSource } | null = null;
      for (const tier of MATRIX_TIERS) {
        const scopeKey = tier.key(pair);
        if (!scopeKey) continue;
        const match = configIndex.get(`${metric.id}|${scopeKey}`);
        if (match) { resolved = { row: match, source: tier.source }; break; }
      }
      const cellKey = `${pair.process_id ?? '~'}|${pair.designation_id ?? '~'}|${metric.id}`;
      // An existing target counts as applicable even without data — somebody deliberately
      // set it, and hiding it would make a live configuration invisible.
      const applicable = Boolean(resolved)
        || (pair.process_id ? producedByProcess.has(`${pair.process_id}|${metric.id}`) : false);
      cells[cellKey] = resolved
        ? {
            target_value: Number(resolved.row.target_value),
            min_threshold: resolved.row.min_threshold === null ? null : Number(resolved.row.min_threshold),
            max_achievement: resolved.row.max_achievement === null ? null : Number(resolved.row.max_achievement),
            weightage: resolved.row.weightage === null ? null : Number(resolved.row.weightage),
            source: resolved.source,
            applicable,
          }
        : { target_value: null, min_threshold: null, max_achievement: null, weightage: null, source: 'none', applicable };
    }
  }

  return {
    pairs,
    metrics: (metricRows as any[]).map((row) => ({
      id: String(row.id),
      metric_code: row.metric_code,
      metric_name: row.metric_name,
      unit: row.unit,
      direction: row.direction,
      category: row.category,
      actual_rows: Number(row.actual_rows),
      has_data: Number(row.actual_rows) > 0,
    })),
    cells,
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
    `SELECT MIN(\`${id}\`) AS id, MIN(TRIM(\`${name}\`)) AS name
       FROM \`${table}\`
      WHERE active_status = 1 AND TRIM(COALESCE(\`${name}\`, '')) <> ''
      GROUP BY LOWER(TRIM(\`${name}\`))
      ORDER BY name`
  );
  return rows;
}

// ─── Team KPI summary (for manager view) ─────────────────────────────────────

export async function getTeamKpiSummary(managerEmployeeId: string, period: Period, anchorDate?: string) {
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
      date_range: getDateRange(period, anchorDate),
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
      const perf = await getLiveKpiPerformance(m.id, period, anchorDate);
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
    date_range: getDateRange(period, anchorDate),
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
