/**
 * KPI Studio — computation.
 *
 * Takes the definitions authored in the Studio, reads their sources, evaluates their formulas, and
 * writes the results into kpi_daily_actual — the same table every existing sync worker writes to,
 * so a Studio-built KPI appears on /my-kpi, the leaderboard and the scorecard with no further
 * wiring.
 *
 * ── The one rule that matters most ──────────────────────────────────────────────────────────
 * A null result is NEVER written as a zero, and never written at all.
 *
 * This is not a stylistic preference. syncAttendanceMetrics carries an explicit fix for scoring
 * WEEK_OFF and LEAVE days as 0% attendance; syncQualityMetrics carries one for dividing FATAL_RATE
 * by total rather than scored audits. Both were the same bug: absent data recorded as a real
 * measurement of zero, which then dragged real people's ratings down. The formula engine returns
 * null with a reason for exactly these cases, and this module's job is to respect that — the row
 * is skipped and the reason is logged, so "no data" stays visibly different from "zero".
 *
 * ── Why every evaluation is logged ─────────────────────────────────────────────────────────
 * kpi_studio_computation_log records the inputs each formula received and, when nothing came out,
 * which input was missing. Without it the three explanations a manager most needs told apart —
 * "the source is down", "the column is mapped wrong", "they genuinely took no calls" — are all
 * rendered identically as an empty cell, and a mis-mapped field can hide as an empty KPI for
 * months. This log is what the drill-down reads.
 */

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { evaluateFormula } from './kpi-formula.engine.js';
import {
  getStudioCapability,
  getDefinitionSourceIds,
  pickWinningDefinitions,
  type EmployeeOrgContext,
} from './kpi-studio.service.js';
import {
  readMergedSourceValues,
  readSourceValues,
  type DataSourceConfig,
  type SourceField,
  type DailyFieldValues,
} from './kpi-studio.sources.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ComputeOptions {
  /** Single day to compute. */
  date: string;
  /** Restrict to one process, one branch, or an explicit employee list. */
  processId?: string;
  branchId?: string;
  employeeIds?: readonly string[];
  /** Evaluate and report without writing anything. */
  dryRun?: boolean;
  /** Cap on employees per run, so a mistaken call cannot walk the whole company. */
  limit?: number;
}

export interface ComputeOutcome {
  date: string;
  definitions_considered: number;
  employees_considered: number;
  written: number;
  /** Evaluated correctly but produced no value — the honest "no data" count. */
  no_data: number;
  /** Formula or wiring errors. Distinct from no_data on purpose. */
  errors: number;
  /** Sources that could not be read at all, with the reason. */
  source_failures: Array<{ source_code: string; error: string }>;
  /** A readable sample, so a caller can see what happened without querying the log. */
  sample: Array<{
    employee_code: string;
    metric_code: string;
    value: number | null;
    status: string;
    reason?: string;
  }>;
}

interface DefinitionRow {
  id: string;
  metric_id: string;
  metric_code: string;
  branch_id: string | null;
  process_id: string | null;
  designation_id: string | null;
  employee_id: string | null;
  data_source_id: string | null;
  formula_expression: string | null;
  effective_from: string;
}

/**
 * Every employee a set of definitions could apply to, with the org context needed to decide which
 * definition wins for each of them.
 */
async function loadCandidateEmployees(options: ComputeOptions): Promise<
  Array<EmployeeOrgContext & { employee_code: string }>
> {
  const where: string[] = ['e.active_status = 1'];
  const params: unknown[] = [];

  if (options.employeeIds?.length) {
    where.push(`e.id IN (${options.employeeIds.map(() => '?').join(',')})`);
    params.push(...options.employeeIds);
  }
  if (options.processId) { where.push('e.process_id = ?'); params.push(options.processId); }
  if (options.branchId) { where.push('e.branch_id = ?'); params.push(options.branchId); }

  // Synthetic test employees would otherwise receive computed KPIs and appear on leaderboards.
  // The same exclusion getLiveKpiPerformance's peer query already applies.
  where.push(`e.employee_code NOT LIKE 'CODEX\\_E2E%'`);

  const limit = Math.min(Math.max(options.limit ?? 2000, 1), 5000);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.branch_id, e.process_id, e.designation_id
       FROM employees e
      WHERE ${where.join(' AND ')}
      ORDER BY e.employee_code
      LIMIT ${limit}`,
    params,
  );
  return rows as any[];
}

async function loadFormulaDefinitions(date: string): Promise<DefinitionRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.metric_id, m.metric_code, d.branch_id, d.process_id, d.designation_id,
            d.employee_id, d.data_source_id, d.formula_expression, d.effective_from
       FROM kpi_studio_definition d
       JOIN kpi_metric_master m ON m.id = d.metric_id AND m.active_status = 1
      WHERE d.active_status = 1
        AND d.formula_expression IS NOT NULL
        AND d.data_source_id IS NOT NULL
        AND d.effective_from <= ?
        AND (d.effective_to IS NULL OR d.effective_to >= ?)`,
    [date, date],
  );
  return rows as any[];
}

async function loadSourcesWithFields(
  sourceIds: readonly string[],
): Promise<Map<string, { source: DataSourceConfig; fields: SourceField[] }>> {
  const result = new Map<string, { source: DataSourceConfig; fields: SourceField[] }>();
  if (!sourceIds.length) return result;

  const [sourceRows] = await db.execute<RowDataPacket[]>(
    // config_json is required, not optional: it carries the published CSV link for a Google Sheet
    // source, so omitting it makes every sheet-backed KPI fail with "no published link".
    `SELECT id, source_code, source_name, source_type, integration_key, source_object,
            employee_key_column, employee_key_kind, date_column, config_json
       FROM kpi_studio_data_source
      WHERE id IN (${sourceIds.map(() => '?').join(',')}) AND active_status = 1`,
    [...sourceIds],
  );
  const [fieldRows] = await db.execute<RowDataPacket[]>(
    `SELECT data_source_id, field_name, source_column, aggregate_fn, source_expression
       FROM kpi_studio_source_field
      WHERE data_source_id IN (${sourceIds.map(() => '?').join(',')}) AND active_status = 1`,
    [...sourceIds],
  );

  for (const source of sourceRows as any[]) {
    result.set(String(source.id), { source, fields: [] });
  }
  for (const field of fieldRows as any[]) {
    result.get(String(field.data_source_id))?.fields.push(field);
  }
  return result;
}

/**
 * Computes one day for one scope.
 *
 * Sources are read ONCE per source for all employees, not once per employee per metric. A month of
 * dialer data for 300 agents across four metrics is one query rather than 1,200 — the difference
 * between a nightly job and a job that never finishes.
 */
export async function computeStudioKpis(options: ComputeOptions): Promise<ComputeOutcome> {
  if (!ISO_DATE.test(options.date)) throw new Error('Date must be YYYY-MM-DD');

  const capability = await getStudioCapability();
  const empty: ComputeOutcome = {
    date: options.date,
    definitions_considered: 0,
    employees_considered: 0,
    written: 0,
    no_data: 0,
    errors: 0,
    source_failures: [],
    sample: [],
  };
  if (!capability.tables) return empty;

  const definitions = await loadFormulaDefinitions(options.date);
  if (!definitions.length) return empty;

  const employees = await loadCandidateEmployees(options);
  if (!employees.length) return { ...empty, definitions_considered: definitions.length };

  // Which definition wins for whom. Reuses the same pure function the resolver uses, so a
  // computed value can never be produced by a definition that would not have been resolved.
  //
  // Grouped by DEFINITION, not by source: a definition may read several sources (a QA sheet plus the
  // dialer database), so the unit of work is "this definition's whole source set for these
  // employees", and the reads are merged before the formula sees them.
  const assignments = new Map<string, Array<{ definition: DefinitionRow; employee: EmployeeOrgContext & { employee_code: string } }>>();
  for (const employee of employees) {
    for (const { definition } of pickWinningDefinitions(definitions, employee)) {
      if (!definition.data_source_id) continue;
      if (!assignments.has(definition.id)) assignments.set(definition.id, []);
      assignments.get(definition.id)!.push({ definition, employee });
    }
  }

  const activeDefinitions = definitions.filter((definition) => assignments.has(definition.id));
  const sourceIdsByDefinition = await getDefinitionSourceIds(activeDefinitions);
  const allSourceIds = [...new Set([...sourceIdsByDefinition.values()].flat())];
  const sources = await loadSourcesWithFields(allSourceIds);

  const outcome: ComputeOutcome = {
    ...empty,
    definitions_considered: definitions.length,
    employees_considered: employees.length,
  };

  // One source can back many definitions, so a failure is reported once rather than once per
  // definition that happened to reference it.
  const reportedFailures = new Set<string>();
  const noteFailure = (sourceCode: string, error: string) => {
    const key = `${sourceCode}|${error}`;
    if (reportedFailures.has(key)) return;
    reportedFailures.add(key);
    outcome.source_failures.push({ source_code: sourceCode, error });
  };

  for (const [definitionId, pairs] of assignments) {
    const sourceIds = sourceIdsByDefinition.get(definitionId) ?? [];
    const entries = sourceIds
      .map((sourceId) => ({ sourceId, entry: sources.get(sourceId) }))
      .filter((candidate): candidate is { sourceId: string; entry: NonNullable<typeof candidate.entry> } => Boolean(candidate.entry));

    if (!entries.length) {
      noteFailure(sourceIds[0] ?? definitionId, 'Data source is missing or inactive');
      continue;
    }

    const employeeIds = [...new Set(pairs.map((pair) => pair.employee.id))];

    const merged = await readMergedSourceValues(
      entries.map((candidate) => candidate.entry),
      employeeIds,
      options.date,
      options.date,
    );

    for (const failure of merged.failures) {
      noteFailure(failure.source_code, failure.error);
    }

    // Deliberately NOT skipped when a source failed. With several sources, one being unreachable
    // still leaves the others' values usable, and the formula's own null handling decides whether a
    // result is possible — which is a more honest answer than discarding everything. A
    // single-source definition whose only source failed produces no values anyway, because its
    // fields all read null.
    const fieldNames = (
      await Promise.all(entries.map((candidate) => fieldNamesFor(candidate.sourceId)))
    ).flat();

    await evaluateAndWrite(pairs, merged.values, [...new Set(fieldNames)], options, outcome);
  }

  return outcome;
}

async function evaluateAndWrite(
  pairs: ReadonlyArray<{ definition: DefinitionRow; employee: EmployeeOrgContext & { employee_code: string } }>,
  values: DailyFieldValues,
  /**
   * Every field name the definition's sources declare, across all of them. Passed in rather than
   * re-derived per employee: the formula engine needs each field present as a key even when the
   * source had no value, so it can tell "no data" apart from "not wired up".
   */
  fieldNames: readonly string[],
  options: ComputeOptions,
  outcome: ComputeOutcome,
): Promise<void> {
  const writes: Array<{
    employeeId: string;
    metricId: string;
    value: number;
  }> = [];
  const logs: Array<{
    definitionId: string;
    metricId: string;
    employeeId: string;
    formula: string;
    inputs: Record<string, number | null>;
    value: number | null;
    status: string;
    nullReason: string | null;
    error: string | null;
  }> = [];

  for (const { definition, employee } of pairs) {
    const formula = definition.formula_expression;
    if (!formula) continue;

    const bucket = values.get(`${employee.id}|${options.date}`);

    // Every field the sources declare is passed, including the ones that had no value. Passing only
    // what was found would make a missing field an "unwired field" error instead of a "no data"
    // fact — the engine distinguishes those, and the distinction is the whole point.
    const inputs: Record<string, number | null> = {};
    for (const field of fieldNames) {
      inputs[field] = bucket?.get(field) ?? null;
    }

    const evaluated = evaluateFormula(formula, inputs);

    if (evaluated.error) {
      outcome.errors += 1;
      logs.push({
        definitionId: definition.id,
        metricId: definition.metric_id,
        employeeId: employee.id,
        formula,
        inputs,
        value: null,
        status: 'error',
        nullReason: null,
        error: evaluated.error,
      });
      if (outcome.sample.length < 20) {
        outcome.sample.push({
          employee_code: employee.employee_code,
          metric_code: definition.metric_code,
          value: null,
          status: 'error',
          reason: evaluated.error,
        });
      }
      continue;
    }

    if (evaluated.value === null) {
      outcome.no_data += 1;
      logs.push({
        definitionId: definition.id,
        metricId: definition.metric_id,
        employeeId: employee.id,
        formula,
        inputs,
        value: null,
        status: 'no_data',
        nullReason: evaluated.nullReason ?? 'No value for this period',
        error: null,
      });
      if (outcome.sample.length < 20) {
        outcome.sample.push({
          employee_code: employee.employee_code,
          metric_code: definition.metric_code,
          value: null,
          status: 'no_data',
          reason: evaluated.nullReason,
        });
      }
      // NO kpi_daily_actual row. This is the false-zero guard: writing 0 here is what made
      // week-off days score as 0% attendance.
      continue;
    }

    writes.push({ employeeId: employee.id, metricId: definition.metric_id, value: evaluated.value });
    logs.push({
      definitionId: definition.id,
      metricId: definition.metric_id,
      employeeId: employee.id,
      formula,
      inputs,
      value: evaluated.value,
      status: 'computed',
      nullReason: null,
      error: null,
    });
    if (outcome.sample.length < 20) {
      outcome.sample.push({
        employee_code: employee.employee_code,
        metric_code: definition.metric_code,
        value: evaluated.value,
        status: 'computed',
      });
    }
  }

  if (options.dryRun) {
    outcome.written += writes.length;
    return;
  }

  // ── Write actuals ──
  // source='calculated' distinguishes a Studio-computed figure from one an existing sync wrote, so
  // the two can never be confused when reconciling a number with its origin.
  const CHUNK = 200;
  for (let index = 0; index < writes.length; index += CHUNK) {
    const chunk = writes.slice(index, index + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const write of chunk) {
      params.push(write.employeeId, write.metricId, options.date, write.value, 'calculated');
    }
    await db.execute(
      `INSERT INTO kpi_daily_actual (employee_id, metric_id, score_date, actual_value, source)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE actual_value = VALUES(actual_value), source = VALUES(source)`,
      params,
    );
    outcome.written += chunk.length;
  }

  // ── Write the log ──
  for (let index = 0; index < logs.length; index += CHUNK) {
    const chunk = logs.slice(index, index + CHUNK);
    const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const log of chunk) {
      params.push(
        log.definitionId,
        log.metricId,
        log.employeeId,
        options.date,
        log.formula,
        JSON.stringify(log.inputs),
        log.value,
        log.status,
        log.nullReason,
        log.error,
      );
    }
    await db.execute(
      `INSERT INTO kpi_studio_computation_log
         (id, definition_id, metric_id, employee_id, score_date, formula_expression,
          inputs_json, computed_value, status, null_reason, error_message)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         definition_id      = VALUES(definition_id),
         formula_expression = VALUES(formula_expression),
         inputs_json        = VALUES(inputs_json),
         computed_value     = VALUES(computed_value),
         status             = VALUES(status),
         null_reason        = VALUES(null_reason),
         error_message      = VALUES(error_message),
         computed_at        = CURRENT_TIMESTAMP`,
      params,
    );
  }
}

/**
 * Field names per source, memoised for the duration of a run.
 *
 * A run evaluates the same handful of sources thousands of times; without this the field list
 * would be re-queried once per employee per metric.
 */
const fieldNameCache = new Map<string, string[]>();

async function fieldNamesFor(dataSourceId: string): Promise<string[]> {
  const cached = fieldNameCache.get(dataSourceId);
  if (cached) return cached;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT field_name FROM kpi_studio_source_field WHERE data_source_id = ? AND active_status = 1`,
    [dataSourceId],
  );
  const names = (rows as any[]).map((row) => String(row.field_name));
  fieldNameCache.set(dataSourceId, names);
  return names;
}

/** Cleared between runs so a field added mid-session is picked up. */
export function resetFieldNameCache(): void {
  fieldNameCache.clear();
}

// ─── Preview ─────────────────────────────────────────────────────────────────────────────────

export interface PreviewResult {
  ok: boolean
  message?: string;
  formula: string;
  /** The real values read from the source, so a wrong result is explainable at a glance. */
  inputs: Record<string, number | null>;
  value: number | null;
  status: 'computed' | 'no_data' | 'error';
  reason?: string;
  employee?: { id: string; employee_code: string; full_name?: string | null };
  date: string;
  source_error?: string;
}

/**
 * Evaluates a formula against one real employee on one real date, WITHOUT saving anything.
 *
 * This is the builder's "test it" button, and it is the feature that makes the formula editor
 * usable by somebody who is not a developer: they see the actual numbers that were read and the
 * actual result, before committing a definition that would otherwise silently produce nulls for
 * 200 people.
 */
export async function previewFormula(input: {
  formula: string;
  dataSourceId: string;
  /** Extra sources, so a multi-source formula can be tested exactly as it will run. */
  extraSourceIds?: string[];
  employeeId: string;
  date: string;
}): Promise<PreviewResult> {
  const date = ISO_DATE.test(input.date) ? input.date : new Date().toISOString().slice(0, 10);

  const base: PreviewResult = {
    ok: false,
    formula: input.formula,
    inputs: {},
    value: null,
    status: 'error',
    date,
  };

  if (!(await getStudioCapability()).tables) {
    return { ...base, message: 'KPI Studio schema is not installed on this database' };
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name FROM employees WHERE id = ? LIMIT 1`,
    [input.employeeId],
  );
  const employee = (empRows as any[])[0];
  if (!employee) return { ...base, message: 'Employee not found' };

  const sourceIds = [...new Set([input.dataSourceId, ...(input.extraSourceIds ?? [])].filter(Boolean))];
  const sources = await loadSourcesWithFields(sourceIds);
  const entries = sourceIds
    .map((sourceId) => sources.get(sourceId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (!entries.length) return { ...base, message: 'Data source not found or inactive', employee };
  const allFields = entries.flatMap((entry) => entry.fields);
  if (!allFields.length) {
    return { ...base, message: 'This data source has no fields configured yet', employee };
  }

  // Read through the same merge path the real computation uses, so a preview cannot succeed on a
  // formula that then fails at compute time, or vice versa.
  const read = await readMergedSourceValues(entries, [employee.id], date, date);

  const inputs: Record<string, number | null> = {};
  const bucket = read.values.get(`${employee.id}|${date}`);
  for (const field of allFields) {
    inputs[field.field_name] = bucket?.get(field.field_name) ?? null;
  }

  // A failure is surfaced only when nothing came back at all. With several sources, one being
  // unreachable while the others answered still lets the author see real values and a real result,
  // which is more useful than an error — and the warning is carried alongside.
  const readError = read.failures.length
    ? read.failures.map((failure) => `${failure.source_code}: ${failure.error}`).join(' · ')
    : undefined;

  if (readError && !bucket) {
    return {
      ...base,
      employee,
      inputs,
      message: 'The data source could not be read',
      source_error: readError,
    };
  }

  const evaluated = evaluateFormula(input.formula, inputs);
  if (readError) base.source_error = readError;

  if (evaluated.error) {
    return { ...base, employee, inputs, status: 'error', message: evaluated.error };
  }
  if (evaluated.value === null) {
    return {
      ok: true,
      formula: input.formula,
      employee,
      inputs,
      value: null,
      status: 'no_data',
      reason: evaluated.nullReason,
      date,
      source_error: readError,
    };
  }
  return {
    ok: true,
    formula: input.formula,
    employee,
    inputs,
    value: evaluated.value,
    status: 'computed',
    date,
    source_error: readError,
  };
}

// ─── Root cause ──────────────────────────────────────────────────────────────────────────────

export interface MetricExplanation {
  metric_code: string;
  metric_name: string;
  days: Array<{
    date: string;
    value: number | null;
    status: string;
    reason: string | null;
    formula: string | null;
    inputs: Record<string, number | null> | null;
  }>;
  /** Distinct reasons across the window, most frequent first. */
  reason_summary: Array<{ reason: string; days: number }>;
}

/**
 * Why one employee's KPI reads what it reads, day by day, over a window.
 *
 * Backs the drill-down. Ordered most recent first because the question is nearly always about the
 * most recent days, and reason_summary exists because "9 of the last 14 days had no calls data" is
 * the sentence somebody needs, not fourteen rows they have to count themselves.
 */
export async function explainMetricForEmployee(
  employeeId: string,
  metricId: string,
  dateFrom: string,
  dateTo: string,
): Promise<MetricExplanation | null> {
  if (!(await getStudioCapability()).tables) return null;
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo)) throw new Error('Dates must be YYYY-MM-DD');

  const [metricRows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_code, metric_name FROM kpi_metric_master WHERE id = ? LIMIT 1`,
    [metricId],
  );
  const metric = (metricRows as any[])[0];
  if (!metric) return null;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT score_date, computed_value, status, null_reason, error_message, formula_expression, inputs_json
       FROM kpi_studio_computation_log
      WHERE employee_id = ? AND metric_id = ? AND score_date BETWEEN ? AND ?
      ORDER BY score_date DESC`,
    [employeeId, metricId, dateFrom, dateTo],
  );

  const reasonCounts = new Map<string, number>();
  const days = (rows as any[]).map((row) => {
    const reason = row.null_reason ?? row.error_message ?? null;
    if (reason) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);

    let inputs: Record<string, number | null> | null = null;
    if (row.inputs_json) {
      try {
        // mysql2 returns a JSON column already parsed; a string only appears on older drivers.
        inputs = typeof row.inputs_json === 'string' ? JSON.parse(row.inputs_json) : row.inputs_json;
      } catch {
        inputs = null;
      }
    }

    return {
      date: row.score_date instanceof Date
        ? row.score_date.toISOString().split('T')[0]
        : String(row.score_date).split('T')[0],
      value: row.computed_value === null ? null : Number(row.computed_value),
      status: String(row.status),
      reason,
      formula: row.formula_expression ?? null,
      inputs,
    };
  });

  return {
    metric_code: String(metric.metric_code),
    metric_name: String(metric.metric_name),
    days,
    reason_summary: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, days: count }))
      .sort((left, right) => right.days - left.days),
  };
}
