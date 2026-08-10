import { db } from '../../db/mysql.js';
import { getPoolForKey } from '../external-db/external-db.service.js';
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { recordMappingException } from './mapping-exception.service.js';
import { readAprSourceAggregates } from './performance-apr-source-reader.js';

type KpiSource = 'apr' | 'attendance' | 'quality' | 'manual' | 'calculated';

type SyncResult = {
  synced: number;
  skipped: number;
  errors: string[];
};

type MetricFact = {
  employeeId: string;
  metricCode: string;
  date: string;
  value: number;
  source: KpiSource;
  sourceSystem?: string;
  numerator?: number | null;
  denominator?: number | null;
  sourceRecordCount?: number | null;
};

type SourceAggregate = {
  agent_user: string | null;
  total_talk?: number | string | null;
  total_dispo?: number | string | null;
  total_calls?: number | string | null;
  points_earned?: number | string | null;
  points_possible?: number | string | null;
  fatal_audits?: number | string | null;
  total_audits?: number | string | null;
  converted_sales?: number | string | null;
  eligible_contacts?: number | string | null;
  revenue?: number | string | null;
  cod_orders?: number | string | null;
  rto_orders?: number | string | null;
  total_aht?: number | string | null;
  quality_points?: number | string | null;
  quality_denominator?: number | string | null;
  source_records?: number | string | null;
  last_audit_date?: string | Date | null;
};

const LINEAGE_COLUMNS = [
  'numerator_value',
  'denominator_value',
  'source_system',
  'source_record_count',
  'formula_version_id',
  'integration_run_id',
  'computed_at',
  'process_id_at_event',
  'branch_id_at_event',
];

const FORMULA_BY_METRIC: Record<string, string> = {
  DIALS: 'CALLS_TOTAL',
  AHT: 'AHT_WEIGHTED',
  TALK_TIME: 'TALK_TIME_WEIGHTED',
  ACW: 'ACW_WEIGHTED',
  QUALITY_SCORE: 'QUALITY_WEIGHTED',
  FATAL_RATE: 'FATAL_RATE',
  CONVERSION_RATE: 'CONVERSION_RATE',
  SALES_COUNT: 'SALES_TOTAL',
  REVENUE: 'REVENUE_TOTAL',
  AOV: 'AOV_WEIGHTED',
  COD_SHARE: 'COD_SHARE',
  RTO_RATE: 'RTO_RATE',
};

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function monthBounds(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const from = `${yearMonth}-01`;
  const d = new Date(Date.UTC(year, month, 1));
  return { from, to: d.toISOString().slice(0, 10) };
}

async function getMetricIds(codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const placeholders = codes.map(() => '?').join(',');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, metric_code FROM kpi_metric_master WHERE metric_code IN (${placeholders})`,
    codes,
  );
  const map = new Map<string, string>();
  for (const row of rows as any[]) map.set(String(row.metric_code), String(row.id));
  return map;
}

async function getFormulaIds(metricCodes: string[]): Promise<Map<string, string>> {
  const formulaCodes = metricCodes.map((code) => FORMULA_BY_METRIC[code]).filter(Boolean);
  if (!formulaCodes.length) return new Map();
  const placeholders = formulaCodes.map(() => '?').join(',');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, metric_code, formula_code
       FROM kpi_formula_version
      WHERE formula_code IN (${placeholders})
        AND status IN ('active', 'draft')
      ORDER BY FIELD(status, 'active', 'draft'), version_no DESC`,
    formulaCodes,
  ).catch(() => [[], []] as any);
  const map = new Map<string, string>();
  for (const row of rows as any[]) {
    const metricCode = String(row.metric_code);
    if (!map.has(metricCode)) map.set(metricCode, String(row.id));
  }
  return map;
}

async function getLineageColumns(): Promise<Set<string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'kpi_daily_actual'
        AND COLUMN_NAME IN (${LINEAGE_COLUMNS.map(() => '?').join(',')})`,
    LINEAGE_COLUMNS,
  ).catch(() => [[], []] as any);
  return new Set((rows as any[]).map((row) => String(row.COLUMN_NAME)));
}

async function mapEmployees(identifiers: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(identifiers.map(normalizeIdentifier).filter(Boolean))];
  if (!unique.length) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  // Active employees first, but inactive ones still match.
  //
  // This filtered on active_status = 1, so the moment someone resigned their
  // work stopped being attributed — including work already done. A quality
  // average for the month an agent left silently excluded them, and the facts
  // were dropped with no record of whose they were.
  //
  // Ordering rather than filtering keeps that strictly additive: the existing
  // `if (!map.has(...))` below takes the first match, so an active employee
  // still wins any collision and no currently-attributed row changes. Only
  // identifiers that previously resolved to nobody now resolve.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, biometric_code
       FROM employees
      WHERE (UPPER(TRIM(employee_code)) IN (${placeholders})
             OR UPPER(TRIM(COALESCE(biometric_code, ''))) IN (${placeholders}))
      ORDER BY active_status DESC, created_at ASC`,
    [...unique, ...unique],
  );
  const map = new Map<string, string>();
  for (const row of rows as any[]) {
    const employeeCode = normalizeIdentifier(row.employee_code);
    const biometricCode = normalizeIdentifier(row.biometric_code);
    if (employeeCode && !map.has(employeeCode)) map.set(employeeCode, String(row.id));
    if (biometricCode && !map.has(biometricCode)) map.set(biometricCode, String(row.id));
  }
  return map;
}

type EmployeeScope = { processId: string | null; branchId: string | null };

// process_id_at_event / branch_id_at_event are a snapshot of where the employee sat when the
// fact was written, not a live join — an agent who moves process must not retro-relabel their
// old scores. Cached because upsertDailyActual runs once per employee per metric per day
// (~45k calls), but only briefly, so a mid-day transfer is picked up by the next sync rather
// than frozen for the lifetime of the process.
const EMPLOYEE_SCOPE_TTL_MS = 60_000;
let employeeScopeCache: { loadedAt: number; scopes: Map<string, EmployeeScope> } | null = null;

async function getEmployeeScope(employeeId: string): Promise<EmployeeScope> {
  if (!employeeScopeCache || Date.now() - employeeScopeCache.loadedAt > EMPLOYEE_SCOPE_TTL_MS) {
    const [rows] = await db
      .execute<RowDataPacket[]>('SELECT id, process_id, branch_id FROM employees')
      .catch(() => [[], []] as any);
    const scopes = new Map<string, EmployeeScope>();
    for (const row of rows as any[]) {
      scopes.set(String(row.id), {
        processId: row.process_id ? String(row.process_id) : null,
        branchId: row.branch_id ? String(row.branch_id) : null,
      });
    }
    employeeScopeCache = { loadedAt: Date.now(), scopes };
  }
  return employeeScopeCache.scopes.get(String(employeeId)) ?? { processId: null, branchId: null };
}

/** Exposed so tests and long-lived workers can force a reload rather than wait out the TTL. */
export function resetEmployeeScopeCache() {
  employeeScopeCache = null;
}

async function upsertDailyActual(fact: MetricFact, metricIds: Map<string, string>, formulaIds: Map<string, string>) {
  const metricId = metricIds.get(fact.metricCode);
  if (!metricId) return false;

  const lineageColumns = await getLineageColumns();
  const baseColumns = ['employee_id', 'metric_id', 'score_date', 'actual_value', 'source'];
  const baseValues: unknown[] = [fact.employeeId, metricId, fact.date, fact.value, fact.source];
  const optionalColumns: string[] = [];
  const optionalValues: unknown[] = [];

  const maybeAdd = (column: string, value: unknown) => {
    if (lineageColumns.has(column)) {
      optionalColumns.push(column);
      optionalValues.push(value);
    }
  };

  maybeAdd('numerator_value', fact.numerator ?? null);
  maybeAdd('denominator_value', fact.denominator ?? null);
  maybeAdd('source_system', fact.sourceSystem ?? fact.source);
  maybeAdd('source_record_count', fact.sourceRecordCount ?? null);
  maybeAdd('formula_version_id', formulaIds.get(fact.metricCode) ?? null);
  maybeAdd('integration_run_id', null);

  if (lineageColumns.has('process_id_at_event') || lineageColumns.has('branch_id_at_event')) {
    const scope = await getEmployeeScope(fact.employeeId);
    maybeAdd('process_id_at_event', scope.processId);
    maybeAdd('branch_id_at_event', scope.branchId);
  }

  const computedAtNow = lineageColumns.has('computed_at');
  const columns = [...baseColumns, ...optionalColumns, ...(computedAtNow ? ['computed_at'] : [])];
  const values = [...baseValues, ...optionalValues];
  const placeholders = [...values.map(() => '?'), ...(computedAtNow ? ['NOW()'] : [])];
  const updates = [
    'actual_value = VALUES(actual_value)',
    'source = VALUES(source)',
    ...optionalColumns.map((column) => `${column} = VALUES(${column})`),
    ...(computedAtNow ? ['computed_at = VALUES(computed_at)'] : []),
  ];

  await db.execute<ResultSetHeader>(
    `INSERT INTO kpi_daily_actual (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
    values,
  );
  return true;
}

async function readSourcePool(key: string): Promise<{ pool: Pool | null; errors: string[] }> {
  try {
    return { pool: (await getPoolForKey(key)) as Pool, errors: [] };
  } catch (error) {
    return { pool: null, errors: [errorMessage(error)] };
  }
}

async function writeFacts(
  rows: SourceAggregate[],
  metricCodes: string[],
  buildFacts: (row: SourceAggregate, employeeId: string) => MetricFact[],
  /**
   * Where these rows came from, so an agent code that maps to nobody can be
   * queued for someone to fix. Without it the identifier is only counted, and a
   * silent `skipped += 1` is how an agent stops being measured unnoticed.
   */
  unmappedSource?: { sourceSystem: string; sourceEntity: string },
): Promise<SyncResult> {
  const metricIds = await getMetricIds(metricCodes);
  const formulaIds = await getFormulaIds(metricCodes);
  const employeeMap = await mapEmployees(rows.map((row) => row.agent_user ?? ''));
  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const employeeId = employeeMap.get(normalizeIdentifier(row.agent_user));
    if (!employeeId) {
      skipped += 1;
      if (unmappedSource) {
        await recordMappingException({
          ...unmappedSource,
          externalIdentifier: String(row.agent_user ?? ''),
          exceptionType: 'employee_unmapped',
          detail: `No employee matches this agent identifier, so its metrics are not being recorded`,
        });
      }
      continue;
    }
    for (const fact of buildFacts(row, employeeId)) {
      const written = await upsertDailyActual(fact, metricIds, formulaIds);
      if (!written) skipped += 1;
    }
    synced += 1;
  }

  return { synced, skipped, errors };
}

export async function syncIntegrationCallMetrics(date: string): Promise<SyncResult> {
  const metricIds = await getMetricIds(['TALK_TIME', 'DIALS']);
  if (!metricIds.size) return { synced: 0, skipped: 0, errors: [] };

  await db.execute(
    `UPDATE employees e
     JOIN (
       SELECT icd.employee_code, MIN(ipa.process_id) AS process_id
       FROM integration_call_daily icd
       JOIN integration_process_alias ipa
         ON ipa.source_value = UPPER(TRIM(icd.process_name))
        AND ipa.active_status = 1
       WHERE icd.activity_date = ?
       GROUP BY icd.employee_code
       HAVING COUNT(DISTINCT ipa.process_id) = 1
     ) mapped
       ON UPPER(TRIM(mapped.employee_code)) = UPPER(TRIM(e.employee_code))
     SET e.process_id = mapped.process_id
     WHERE e.active_status = 1 AND e.process_id IS NULL`,
    [date],
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       SUM(icd.total_calls) AS total_calls,
       SUM(icd.talk_minutes) AS talk_minutes
     FROM integration_call_daily icd
     JOIN employees e
       ON UPPER(TRIM(e.employee_code)) = UPPER(TRIM(icd.employee_code))
      AND e.active_status = 1
     WHERE icd.activity_date = ?
     GROUP BY e.id`,
    [date],
  );

  const formulaIds = await getFormulaIds(['TALK_TIME', 'DIALS']);
  let synced = 0;
  for (const row of rows as any[]) {
    const totalCalls = numberValue(row.total_calls);
    const talkMinutes = numberValue(row.talk_minutes);
    await upsertDailyActual({
      employeeId: row.employee_id,
      metricCode: 'DIALS',
      date,
      value: totalCalls,
      source: 'apr',
      sourceSystem: 'integration_call_daily',
      numerator: totalCalls,
      sourceRecordCount: totalCalls,
    }, metricIds, formulaIds);
    if (totalCalls > 0) {
      const averageTalkSeconds = (talkMinutes * 60) / totalCalls;
      await upsertDailyActual({
        employeeId: row.employee_id,
        metricCode: 'TALK_TIME',
        date,
        value: round1(averageTalkSeconds),
        source: 'apr',
        sourceSystem: 'integration_call_daily',
        numerator: talkMinutes * 60,
        denominator: totalCalls,
        sourceRecordCount: totalCalls,
      }, metricIds, formulaIds);
    }
    synced += 1;
  }

  return { synced, skipped: 0, errors: [] };
}

export async function syncAprMetrics(date: string): Promise<SyncResult> {
  const { pool, errors } = await readSourcePool('apr_productivity');
  if (!pool) return { synced: 0, skipped: 0, errors };

  try {
    const result = await readAprSourceAggregates(pool, date);
    const written = await writeFacts(result.rows as SourceAggregate[], ['AHT', 'TALK_TIME', 'DIALS', 'ACW'], (row, employeeId) => {
      const totalCalls = numberValue(row.total_calls);
      const totalTalk = numberValue(row.total_talk);
      const totalDispo = numberValue(row.total_dispo);
      if (totalCalls <= 0) return [];
      return [
        {
          employeeId,
          metricCode: 'AHT',
          date,
          value: round1((totalTalk + totalDispo) / totalCalls),
          source: 'apr',
          sourceSystem: 'dialer_vicidial_agent_log_tables',
          numerator: totalTalk + totalDispo,
          denominator: totalCalls,
          sourceRecordCount: numberValue(row.source_records),
        },
        {
          employeeId,
          metricCode: 'TALK_TIME',
          date,
          value: round1(totalTalk / totalCalls),
          source: 'apr',
          sourceSystem: 'dialer_vicidial_agent_log_tables',
          numerator: totalTalk,
          denominator: totalCalls,
          sourceRecordCount: numberValue(row.source_records),
        },
        {
          employeeId,
          metricCode: 'DIALS',
          date,
          value: totalCalls,
          source: 'apr',
          sourceSystem: 'dialer_vicidial_agent_log_tables',
          numerator: totalCalls,
          sourceRecordCount: numberValue(row.source_records),
        },
        {
          employeeId,
          metricCode: 'ACW',
          date,
          value: round1(totalDispo / totalCalls),
          source: 'apr',
          sourceSystem: 'dialer_vicidial_agent_log_tables',
          numerator: totalDispo,
          denominator: totalCalls,
          sourceRecordCount: numberValue(row.source_records),
        },
      ];
    });
    return { ...written, errors: [...result.errors, ...written.errors] };
  } catch (error) {
    return { synced: 0, skipped: 0, errors: [errorMessage(error)] };
  }
}

export async function syncAttendanceMetrics(date: string): Promise<SyncResult> {
  const metricIds = await getMetricIds(['ATTENDANCE_PCT']);
  const attMetricId = metricIds.get('ATTENDANCE_PCT');
  if (!attMetricId) return { synced: 0, skipped: 0, errors: [] };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, attendance_status
     FROM attendance_daily_record
     WHERE record_date = ?`,
    [date],
  );

  const formulaIds = await getFormulaIds(['ATTENDANCE_PCT']);
  let synced = 0;
  let skipped = 0;

  // Days nobody was expected to attend, plus approved leave. Previously these fell
  // into the trailing `: 0` below and were written as a 0% attendance KPI — so a
  // week off, a public holiday or approved leave scored as total failure. That is
  // the origin of the 0.0% cohort the CEO UAT found on /operations-kpi sitting
  // beside 205 employees pinned at the 120% cap: the distribution was an artefact
  // of scoring non-working days, not a measurement.
  //
  // 'week_off_worked' is deliberately NOT excluded — that is a day actually worked
  // and must score as present, which the old ['P','PRESENT'] test also missed.
  const NOT_SCOREABLE = new Set([
    'WEEK_OFF', 'HOLIDAY', 'LEAVE_APPROVED', 'ON_LEAVE', 'LEAVE',
  ]);

  for (const rec of rows as any[]) {
    const status = String(rec.attendance_status ?? '').toUpperCase();

    if (NOT_SCOREABLE.has(status)) {
      skipped += 1;
      continue;
    }

    const value = ['P', 'PRESENT', 'WEEK_OFF_WORKED'].includes(status)
      ? 100
      : ['H', 'HALF_DAY'].includes(status)
        ? 50
        : 0;

    await upsertDailyActual({
      employeeId: rec.employee_id,
      metricCode: 'ATTENDANCE_PCT',
      date,
      value,
      source: 'attendance',
      sourceSystem: 'attendance_daily_record',
      numerator: value,
      denominator: 100,
      sourceRecordCount: 1,
    }, metricIds, formulaIds);
    synced += 1;
  }

  return { synced, skipped, errors: [] };
}

/**
 * Quality for ONE day, so a score can be attributed to the process the agent
 * actually worked that day.
 *
 * syncQualityMetrics() below aggregates a whole month with GROUP BY User and
 * writes a single fact dated at MAX(CallDate). That yields one quality number
 * per agent per month, which cannot be split across processes if the agent
 * moved mid-month, and produces no daily trend. It also only runs on the 2nd of
 * the month, for the month before, so quality is perpetually up to five weeks
 * behind every other metric.
 *
 * This mirrors syncAprMetrics: one bounded day, one fact per agent per day,
 * idempotent through the same ON DUPLICATE KEY UPDATE. The monthly function is
 * left untouched — kpi-master.routes and performance-safe-sync both call it for
 * month-close, and that is a legitimate separate job.
 */
export async function syncQualityMetricsForDate(date: string): Promise<SyncResult> {
  const { pool, errors } = await readSourcePool('quality_audit');
  if (!pool) return { synced: 0, skipped: 0, errors };

  const sql = `
    SELECT
      UPPER(TRIM(\`User\`)) AS agent_user,
      SUM(COALESCE(total_score, 0)) AS points_earned,
      SUM(COALESCE(max_score, 0)) AS points_possible,
      SUM(CASE WHEN quality_percentage = 0 THEN 1 ELSE 0 END) AS fatal_audits,
      -- Only audits that were actually scored may form the fatal-rate
      -- denominator. 1,383 of July's 6,568 audits carry quality_percentage NULL
      -- and max_score 0 — never scored at all. Because NULL never matches
      -- "= 0", counting them made an agent with 17 unscored audits report a
      -- 0% fatal rate, which reads as flawless work.
      SUM(quality_percentage IS NOT NULL) AS scored_audits,
      COUNT(*) AS total_audits
    FROM call_quality_assessment
    WHERE CallDate >= ? AND CallDate < ?
    GROUP BY UPPER(TRIM(\`User\`))
  `;

  try {
    const [rows] = await pool.execute(sql, [date, nextDate(date)]);
    return writeFacts(rows as SourceAggregate[], ['QUALITY_SCORE', 'FATAL_RATE'], (row, employeeId) => {
      const possible = numberValue(row.points_possible);
      const audits = numberValue(row.total_audits);
      const facts: MetricFact[] = [];
      if (possible > 0) {
        facts.push({
          employeeId,
          metricCode: 'QUALITY_SCORE',
          // The date being synced, not MAX(CallDate) — that is the whole
          // difference between a daily fact and a monthly rollup.
          date,
          value: round2((numberValue(row.points_earned) / possible) * 100),
          source: 'quality',
          sourceSystem: 'db_audit.call_quality_assessment',
          numerator: numberValue(row.points_earned),
          denominator: possible,
          sourceRecordCount: audits,
        });
      }
      // Emit nothing rather than a flattering zero when the day's audits were
      // never scored. No fatal rate is an honest gap; 0% is a false claim.
      const scored = numberValue((row as { scored_audits?: unknown }).scored_audits);
      if (scored > 0) {
        facts.push({
          employeeId,
          metricCode: 'FATAL_RATE',
          date,
          value: round2((numberValue(row.fatal_audits) / scored) * 100),
          source: 'quality',
          sourceSystem: 'db_audit.call_quality_assessment',
          numerator: numberValue(row.fatal_audits),
          denominator: scored,
          // Lineage keeps the true audit count, so the gap between audits taken
          // and audits scored stays visible rather than being rounded away.
          sourceRecordCount: audits,
        });
      }
      return facts;
    }, {
      sourceSystem: 'quality_audit',
      sourceEntity: 'db_audit.call_quality_assessment',
    });
  } catch (error) {
    return { synced: 0, skipped: 0, errors: [errorMessage(error)] };
  }
}

export async function syncQualityMetrics(yearMonth: string): Promise<SyncResult> {
  const { pool, errors } = await readSourcePool('quality_audit');
  if (!pool) return { synced: 0, skipped: 0, errors };
  const bounds = monthBounds(yearMonth);
  const sql = `
    SELECT
      UPPER(TRIM(\`User\`)) AS agent_user,
      SUM(COALESCE(total_score, 0)) AS points_earned,
      SUM(COALESCE(max_score, 0)) AS points_possible,
      SUM(CASE WHEN quality_percentage = 0 THEN 1 ELSE 0 END) AS fatal_audits,
      -- Same correction as the daily path: only scored audits may form the
      -- fatal-rate denominator. 21% of July's audits were never scored, and
      -- because NULL never matches "= 0" they inflated the denominator while
      -- contributing nothing to the numerator — reporting 0% for unassessed work.
      SUM(quality_percentage IS NOT NULL) AS scored_audits,
      COUNT(*) AS total_audits,
      DATE(MAX(CallDate)) AS last_audit_date
    FROM call_quality_assessment
    WHERE CallDate >= ? AND CallDate < ?
    GROUP BY UPPER(TRIM(\`User\`))
  `;

  try {
    const [rows] = await pool.execute(sql, [bounds.from, bounds.to]);
    return writeFacts(rows as SourceAggregate[], ['QUALITY_SCORE', 'FATAL_RATE'], (row, employeeId) => {
      const possible = numberValue(row.points_possible);
      const audits = numberValue(row.total_audits);
      const factDate = row.last_audit_date instanceof Date
        ? row.last_audit_date.toISOString().slice(0, 10)
        : String(row.last_audit_date ?? `${yearMonth}-01`).slice(0, 10);
      const facts: MetricFact[] = [];
      if (possible > 0) {
        facts.push({
          employeeId,
          metricCode: 'QUALITY_SCORE',
          date: factDate,
          value: round2((numberValue(row.points_earned) / possible) * 100),
          source: 'quality',
          sourceSystem: 'db_audit.call_quality_assessment',
          numerator: numberValue(row.points_earned),
          denominator: possible,
          sourceRecordCount: audits,
        });
      }
      const scoredMonth = numberValue((row as { scored_audits?: unknown }).scored_audits);
      if (scoredMonth > 0) {
        facts.push({
          employeeId,
          metricCode: 'FATAL_RATE',
          date: factDate,
          value: round2((numberValue(row.fatal_audits) / scoredMonth) * 100),
          source: 'quality',
          sourceSystem: 'db_audit.call_quality_assessment',
          numerator: numberValue(row.fatal_audits),
          denominator: scoredMonth,
          // Lineage keeps the true audit count, so the gap between audits taken
          // and audits scored stays visible rather than being rounded away.
          sourceRecordCount: audits,
        });
      }
      return facts;
    }, {
      // Quality is where an unmapped agent hurts most: the feed stopped
      // populating Campaign in May 2026, so `User` is the only link between a
      // score and a person.
      sourceSystem: 'quality_audit',
      sourceEntity: 'db_audit.call_quality_assessment',
    });
  } catch (error) {
    return { synced: 0, skipped: 0, errors: [errorMessage(error)] };
  }
}

export async function syncConversionMetrics(date: string): Promise<SyncResult> {
  const { pool, errors } = await readSourcePool('outbound_calls');
  if (!pool) return { synced: 0, skipped: 0, errors };
  const sql = `
    SELECT
      UPPER(TRIM(AgentName)) AS agent_user,
      SUM(CASE WHEN SaleDone = 1 THEN 1 ELSE 0 END) AS converted_sales,
      COUNT(*) AS eligible_contacts,
      COUNT(*) AS source_records
    FROM CallDetails
    WHERE CallDate >= ? AND CallDate < ?
    GROUP BY UPPER(TRIM(AgentName))
  `;

  try {
    const [rows] = await pool.execute(sql, [date, nextDate(date)]);
    return writeFacts(rows as SourceAggregate[], ['CONVERSION_RATE'], (row, employeeId) => {
      const eligibleContacts = numberValue(row.eligible_contacts);
      if (eligibleContacts <= 0) return [];
      return [{
        employeeId,
        metricCode: 'CONVERSION_RATE',
        date,
        value: round2((numberValue(row.converted_sales) / eligibleContacts) * 100),
        source: 'calculated',
        sourceSystem: 'db_external.CallDetails',
        numerator: numberValue(row.converted_sales),
        denominator: eligibleContacts,
        sourceRecordCount: numberValue(row.source_records),
      }];
    });
  } catch (error) {
    return { synced: 0, skipped: 0, errors: [errorMessage(error)] };
  }
}

export async function syncSalesBrandMisMetrics(date: string): Promise<SyncResult> {
  const { pool, errors } = await readSourcePool('sales_brand_mis');
  if (!pool) return { synced: 0, skipped: 0, errors };

  const sql = `
    SELECT
      UPPER(TRIM(agent_user)) AS agent_user,
      SUM(total_calls) AS total_calls,
      0 AS converted_sales,
      SUM(total_aht) AS total_aht,
      SUM(total_talk) AS total_talk,
      SUM(total_dispo) AS total_dispo,
      0 AS quality_points,
      0 AS quality_denominator,
      SUM(source_records) AS source_records
    FROM (
      SELECT
        CONVERT(COALESCE(NULLIF(noiid, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
        COALESCE(num_calls_chat, unique_count, 0) AS total_calls,
        COALESCE(acht, 0) * COALESCE(num_calls_chat, unique_count, 0) AS total_aht,
        CASE WHEN talk_time LIKE '%:%:%' THEN
          CAST(SUBSTRING_INDEX(talk_time, ':', 1) AS UNSIGNED) * 3600
          + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(talk_time, ':', 2), ':', -1) AS UNSIGNED) * 60
          + CAST(SUBSTRING_INDEX(talk_time, ':', -1) AS UNSIGNED)
        ELSE 0 END AS total_talk,
        CASE WHEN dispo_time LIKE '%:%:%' THEN
          CAST(SUBSTRING_INDEX(dispo_time, ':', 1) AS UNSIGNED) * 3600
          + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(dispo_time, ':', 2), ':', -1) AS UNSIGNED) * 60
          + CAST(SUBSTRING_INDEX(dispo_time, ':', -1) AS UNSIGNED)
        ELSE 0 END AS total_dispo,
        1 AS source_records
      FROM db_masmis.bb_apr
      WHERE report_date = ?

      UNION ALL

      SELECT
        CONVERT(COALESCE(NULLIF(emp_id, ''), user_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
        COALESCE(calls, 0) AS total_calls,
        COALESCE(acht, 0) * COALESCE(calls, 0) AS total_aht,
        CASE WHEN talk_time LIKE '%:%:%' THEN
          CAST(SUBSTRING_INDEX(talk_time, ':', 1) AS UNSIGNED) * 3600
          + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(talk_time, ':', 2), ':', -1) AS UNSIGNED) * 60
          + CAST(SUBSTRING_INDEX(talk_time, ':', -1) AS UNSIGNED)
        ELSE 0 END AS total_talk,
        CASE WHEN dispo_time LIKE '%:%:%' THEN
          CAST(SUBSTRING_INDEX(dispo_time, ':', 1) AS UNSIGNED) * 3600
          + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(dispo_time, ':', 2), ':', -1) AS UNSIGNED) * 60
          + CAST(SUBSTRING_INDEX(dispo_time, ':', -1) AS UNSIGNED)
        ELSE 0 END AS total_dispo,
        1 AS source_records
      FROM db_masmis.gnc_apr
      WHERE report_date = ?

      UNION ALL

      SELECT
        CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
        COALESCE(calls, 0) AS total_calls,
        COALESCE(acht, 0) * COALESCE(calls, 0) AS total_aht,
        CASE WHEN talk LIKE '%:%:%' THEN
          CAST(SUBSTRING_INDEX(talk, ':', 1) AS UNSIGNED) * 3600
          + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(talk, ':', 2), ':', -1) AS UNSIGNED) * 60
          + CAST(SUBSTRING_INDEX(talk, ':', -1) AS UNSIGNED)
        ELSE 0 END AS total_talk,
        CASE WHEN dispo LIKE '%:%:%' THEN
          CAST(SUBSTRING_INDEX(dispo, ':', 1) AS UNSIGNED) * 3600
          + CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(dispo, ':', 2), ':', -1) AS UNSIGNED) * 60
          + CAST(SUBSTRING_INDEX(dispo, ':', -1) AS UNSIGNED)
        ELSE 0 END AS total_dispo,
        1 AS source_records
      FROM db_masmis.neemans_apr
      WHERE STR_TO_DATE(\`date\`, '%d-%b-%Y') = ?
    ) brand_apr
    GROUP BY UPPER(TRIM(agent_user))
  `;

  try {
    const [rows] = await pool.execute(sql, [date, date, date]);
    return writeFacts(rows as SourceAggregate[], ['DIALS', 'AHT', 'TALK_TIME', 'ACW'], (row, employeeId) => {
      const totalCalls = numberValue(row.total_calls);
      const sourceRecords = numberValue(row.source_records);
      const facts: MetricFact[] = [];
      if (totalCalls > 0) {
        facts.push(
          {
            employeeId,
            metricCode: 'DIALS',
            date,
            value: totalCalls,
            source: 'apr',
            sourceSystem: 'db_masmis.brand_apr',
            numerator: totalCalls,
            sourceRecordCount: sourceRecords,
          },
          {
            employeeId,
            metricCode: 'AHT',
            date,
            value: round1(numberValue(row.total_aht) / totalCalls),
            source: 'apr',
            sourceSystem: 'db_masmis.brand_apr',
            numerator: numberValue(row.total_aht),
            denominator: totalCalls,
            sourceRecordCount: sourceRecords,
          },
          {
            employeeId,
            metricCode: 'TALK_TIME',
            date,
            value: round1(numberValue(row.total_talk) / totalCalls),
            source: 'apr',
            sourceSystem: 'db_masmis.brand_apr',
            numerator: numberValue(row.total_talk),
            denominator: totalCalls,
            sourceRecordCount: sourceRecords,
          },
          {
            employeeId,
            metricCode: 'ACW',
            date,
            value: round2(numberValue(row.total_dispo) / totalCalls),
            source: 'apr',
            sourceSystem: 'db_masmis.brand_apr',
            numerator: numberValue(row.total_dispo),
            denominator: totalCalls,
            sourceRecordCount: sourceRecords,
          },
        );
      }
      return facts;
    });
  } catch (error) {
    return { synced: 0, skipped: 0, errors: [errorMessage(error)] };
  }
}

export async function syncSalesOrderMetrics(date: string): Promise<SyncResult> {
  const { pool, errors } = await readSourcePool('sales_brand_mis');
  if (!pool) return { synced: 0, skipped: 0, errors };

  const sql = `
    SELECT
      UPPER(TRIM(agent_user)) AS agent_user,
      SUM(converted_sales) AS converted_sales,
      SUM(revenue) AS revenue,
      SUM(cod_orders) AS cod_orders,
      SUM(rto_orders) AS rto_orders,
      SUM(source_records) AS source_records
    FROM (
      SELECT
        CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
        SUM(COALESCE(sale_count, 1)) AS converted_sales,
        SUM(COALESCE(amount, 0)) AS revenue,
        SUM(CASE WHEN UPPER(TRIM(payment_status)) = 'COD' THEN 1 ELSE 0 END) AS cod_orders,
        SUM(CASE
              WHEN UPPER(CONCAT_WS(' ', current_status, final_status, rto_status)) LIKE '%RTO%' THEN 1
              ELSE 0
            END) AS rto_orders,
        COUNT(*) AS source_records
      FROM db_masmis.bb_sale
      WHERE \`Date\` = ? OR \`Order Date\` = ? OR DATE(Order_DateTime) = ?
      GROUP BY CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci

      UNION ALL

      SELECT
        CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
        SUM(COALESCE(sale_count, 1)) AS converted_sales,
        SUM(COALESCE(sum_before_gst, gross_amount, 0)) AS revenue,
        SUM(CASE WHEN UPPER(TRIM(payment_status)) = 'COD' THEN 1 ELSE 0 END) AS cod_orders,
        SUM(CASE WHEN UPPER(TRIM(status)) = 'RTO' THEN 1 ELSE 0 END) AS rto_orders,
        COUNT(*) AS source_records
      FROM db_masmis.gnc_sale
      WHERE sale_date = ?
      GROUP BY CONVERT(COALESCE(NULLIF(emp_id, ''), emp_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci

      UNION ALL

      SELECT
        CONVERT(COALESCE(NULLIF(emp_id, ''), name) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS agent_user,
        SUM(COALESCE(\`count\`, 1)) AS converted_sales,
        SUM(COALESCE(amount, 0)) AS revenue,
        SUM(CASE WHEN UPPER(TRIM(payment_status)) = 'COD' THEN 1 ELSE 0 END) AS cod_orders,
        SUM(CASE
              WHEN UPPER(CONCAT_WS(' ', status, current_status, final_status)) LIKE '%RTO%' THEN 1
              ELSE 0
            END) AS rto_orders,
        COUNT(*) AS source_records
      FROM db_masmis.neemans_sale_raw
      WHERE DATE_ADD('1899-12-30', INTERVAL CAST(\`date\` AS UNSIGNED) DAY) = ?
      GROUP BY CONVERT(COALESCE(NULLIF(emp_id, ''), name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
    ) brand_sales
    GROUP BY UPPER(TRIM(agent_user))
  `;

  try {
    const [rows] = await pool.execute(sql, [date, date, date, date, date]);
    return writeFacts(rows as SourceAggregate[], ['SALES_COUNT', 'REVENUE', 'AOV', 'COD_SHARE', 'RTO_RATE'], (row, employeeId) => {
      const sales = numberValue(row.converted_sales);
      const revenue = numberValue(row.revenue);
      const sourceRecords = numberValue(row.source_records);
      if (sales <= 0) return [];
      return [
        {
          employeeId,
          metricCode: 'SALES_COUNT',
          date,
          value: sales,
          source: 'calculated',
          sourceSystem: 'db_masmis.brand_sales',
          numerator: sales,
          sourceRecordCount: sourceRecords,
        },
        {
          employeeId,
          metricCode: 'REVENUE',
          date,
          value: round2(revenue),
          source: 'calculated',
          sourceSystem: 'db_masmis.brand_sales',
          numerator: revenue,
          sourceRecordCount: sourceRecords,
        },
        {
          employeeId,
          metricCode: 'AOV',
          date,
          value: round2(revenue / sales),
          source: 'calculated',
          sourceSystem: 'db_masmis.brand_sales',
          numerator: revenue,
          denominator: sales,
          sourceRecordCount: sourceRecords,
        },
        {
          employeeId,
          metricCode: 'COD_SHARE',
          date,
          value: round2((numberValue(row.cod_orders) / sales) * 100),
          source: 'calculated',
          sourceSystem: 'db_masmis.brand_sales',
          numerator: numberValue(row.cod_orders),
          denominator: sales,
          sourceRecordCount: sourceRecords,
        },
        {
          employeeId,
          metricCode: 'RTO_RATE',
          date,
          value: round2((numberValue(row.rto_orders) / sales) * 100),
          source: 'calculated',
          sourceSystem: 'db_masmis.brand_sales',
          numerator: numberValue(row.rto_orders),
          denominator: sales,
          sourceRecordCount: sourceRecords,
        },
      ];
    });
  } catch (error) {
    return { synced: 0, skipped: 0, errors: [errorMessage(error)] };
  }
}
