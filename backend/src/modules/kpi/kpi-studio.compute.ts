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
// Already matches both 1213 (deadlock) and 1205 (lock wait). This module simply
// was not using it.
import { withDeadlockRetry } from '../../shared/deadlockRetry.js';
import {
  getStudioCapability,
  getDefinitionSourceIds,
  pickWinningDefinitions,
  type EmployeeOrgContext,
} from './kpi-studio.service.js';
import {
  readMergedSourceValues,
  readSourceValues,
  readProcessGrainValues,
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
            d.employee_id, d.data_source_id, d.formula_expression, d.effective_from,
            COALESCE(d.grain, 'employee') AS grain
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

  // Ask before selecting. This branch is shared and a migration may not have
  // reached a given database yet; selecting a column that is not there turns a
  // working query into a 400, which is precisely what adding these unconditionally
  // did once. Same rule this module header states for the 1644/1645 tables.
  const cap = await getStudioCapability();
  const processCols = cap.processGrain
    ? ", process_key_kind, process_key_column, process_key_value, process_id"
    : "";
  const filterCol = cap.fieldFilters ? ", filter_json" : "";

  const [sourceRows] = await db.execute<RowDataPacket[]>(
    // config_json is required, not optional: it carries the published CSV link for a Google Sheet
    // source, so omitting it makes every sheet-backed KPI fail with "no published link".
    // date_format has to be selected too, not just date_column. Without it every
    // source object reaches buildProcessQueryPlan with date_format undefined, so
    // dateExpression falls through to the bare column and a text date is compared
    // as a STRING -- which is the precise failure its own comment warns about, and
    // it returns a confident wrong row set rather than an error. An excel_serial
    // source returns zero rows; a '%d-%m-%Y' source silently returns the wrong month.
    `SELECT id, source_code, source_name, source_type, integration_key, source_object,
            employee_key_column, employee_key_kind, date_column, date_format, config_json${processCols}
       FROM kpi_studio_data_source
      WHERE id IN (${sourceIds.map(() => '?').join(',')}) AND active_status = 1`,
    [...sourceIds],
  );
  const [fieldRows] = await db.execute<RowDataPacket[]>(
    `SELECT data_source_id, field_name, source_column, aggregate_fn, source_expression${filterCol}
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

  const allDefinitions = await loadFormulaDefinitions(options.date);
  if (!allDefinitions.length) return empty;

  // Process-grain definitions are computed first and entirely separately: they
  // have no employee dimension at all (a client's own database has no MAS
  // employee IDs), so they must not be filtered by the employee candidate list
  // and must survive the "no employees" early return below.
  const processDefinitions = allDefinitions.filter((d) => String((d as any).grain) === 'process');
  const definitions = allDefinitions.filter((d) => String((d as any).grain) !== 'process');

  const processOutcome = processDefinitions.length
    ? await computeProcessGrainDefinitions(processDefinitions, options)
    : { written: 0, no_data: 0, errors: 0, source_failures: [] as ComputeOutcome['source_failures'], sample: [] as ComputeOutcome['sample'] };

  const withProcess = (o: ComputeOutcome): ComputeOutcome => ({
    ...o,
    definitions_considered: allDefinitions.length,
    written: o.written + processOutcome.written,
    no_data: o.no_data + processOutcome.no_data,
    errors: o.errors + processOutcome.errors,
    source_failures: [...o.source_failures, ...processOutcome.source_failures],
    sample: [...processOutcome.sample, ...o.sample].slice(0, 20),
  });

  if (!definitions.length) return withProcess(empty);

  const employees = await loadCandidateEmployees(options);
  if (!employees.length) return withProcess({ ...empty, definitions_considered: definitions.length });

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

  return withProcess(outcome);
}

/**
 * Process-grain computation.
 *
 * One value per process per day, written to process_metric_actual rather than
 * kpi_daily_actual. The aggregation happens inside the source query (see
 * buildProcessQueryPlan), so the formula's inputs are already process totals —
 * which is the whole reason this path exists. Rolling up the employee-grain
 * output instead would average per-employee ratios and produce a different,
 * wrong number whenever agents carry uneven volume.
 *
 * Values are keyed by the metric's metric_code. The dashboard's registry binds
 * to that through processSource.metricCode, so a metric reads the same whether
 * the number was typed in by hand or computed here.
 */
/**
 * The two numbers a plain ratio was built from, ready to be summed over a period.
 *
 * A stored daily rate is a completed division, and the parts are gone. Averaging
 * those rates over a month is not the month's rate whenever daily volumes differ
 * — the same "mean of ratios is not the ratio of sums" error process grain
 * exists to avoid a level down. Keeping the parts lets a reader compute
 * SUM(numerator)/SUM(denominator) and get the real figure.
 *
 * Returned ALREADY SCALED into the metric's own unit, so a reader divides one by
 * the other and needs to know nothing about which function produced them:
 * PCT(a, b) yields a*100 and b, SAFE_DIV(a, b) yields a and b.
 *
 * Deliberately narrow. Only a formula that is nothing but one ratio call over two
 * bare field names qualifies; a banded IF or a CLAMP has no numerator to speak of,
 * and guessing one would produce a period figure that looks exact and is not.
 * Anything else returns null, which is the signal that the average is the best
 * available answer and should be labelled as such.
 */
/**
 * Whether 1685 has landed. Cached like the other capability probes, and for the
 * same reason: this file ships before its migration is guaranteed to be applied,
 * and naming a column that does not exist turns a working compute into a crash.
 */
let rollupColumnsPresent: boolean | null = null;
async function processMetricRollupSupported(): Promise<boolean> {
  if (rollupColumnsPresent !== null) return rollupColumnsPresent;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_metric_actual'
          AND COLUMN_NAME IN ('rollup_numerator', 'rollup_denominator')`,
    );
    rollupColumnsPresent = Number((rows as any[])[0]?.n ?? 0) === 2;
  } catch {
    rollupColumnsPresent = false;
  }
  return rollupColumnsPresent;
}

/** Exposed so a test, or a process that has just run 1685, can re-probe. */
export function resetProcessMetricRollupProbe(): void {
  rollupColumnsPresent = null;
}

export function ratioParts(
  formula: string,
  inputs: Record<string, number | null>,
): { numerator: number; denominator: number } | null {
  const text = String(formula ?? '').trim();
  const opened = /^(PCT|SAFE_DIV)\s*\(/i.exec(text);
  if (!opened || !text.endsWith(')')) return null;
  const fn = opened[1];

  // The two arguments of the top-level call, split at the comma that is not
  // inside a nested call. Anything richer than one ratio -- a CLAMP wrapped
  // around it, an IF choosing between two -- is refused below, because summing
  // the parts of those does not reconstruct the whole.
  const inner = text.slice(opened[0].length, -1);
  let depth = 0;
  let split = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      if (split !== -1) return null; // three arguments: not a ratio
      split = i;
    }
  }
  if (split === -1) return null;

  // Each side is evaluated as a formula in its own right, so a compound
  // numerator works: occupancy is PCT(talk + dispo, talk + dispo + wait), and
  // summing those two sides across days still gives the period's real ratio
  // because both are linear in the inputs. Restricted to + and the field names
  // themselves for exactly that reason -- an expression that is not additive
  // (a CLAMP, a threshold) would not survive being summed.
  const numeratorExpr = inner.slice(0, split);
  const denominatorExpr = inner.slice(split + 1);
  const additive = /^[\s()]*[A-Za-z_][A-Za-z0-9_]*(\s*\+\s*[A-Za-z_][A-Za-z0-9_]*)*[\s()]*$/;
  if (!additive.test(numeratorExpr) || !additive.test(denominatorExpr)) return null;

  const numeratorResult = evaluateFormula(numeratorExpr, inputs);
  const denominatorResult = evaluateFormula(denominatorExpr, inputs);
  if (numeratorResult.error || denominatorResult.error) return null;

  const numerator = numeratorResult.value;
  const denominator = denominatorResult.value;
  if (typeof numerator !== 'number' || typeof denominator !== 'number') return null;
  // A zero denominator has no ratio to contribute. Storing it would make a later
  // SUM/SUM correct anyway, but storing the pair for a day that produced no value
  // is misleading, and SAFE_DIV already resolved that day to null.
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;

  return {
    numerator: fn.toUpperCase() === 'PCT' ? numerator * 100 : numerator,
    denominator,
  };
}

async function computeProcessGrainDefinitions(
  definitions: DefinitionRow[],
  options: ComputeOptions,
): Promise<{
  written: number;
  no_data: number;
  errors: number;
  source_failures: ComputeOutcome['source_failures'];
  sample: ComputeOutcome['sample'];
}> {
  const result = {
    written: 0,
    no_data: 0,
    errors: 0,
    source_failures: [] as ComputeOutcome['source_failures'],
    sample: [] as ComputeOutcome['sample'],
  };

  const sourceIdsByDefinition = await getDefinitionSourceIds(definitions);
  const allSourceIds = [...new Set([...sourceIdsByDefinition.values()].flat())];
  const sources = await loadSourcesWithFields(allSourceIds);

  for (const definition of definitions) {
    const sourceIds = sourceIdsByDefinition.get(definition.id) ?? [];
    const entries = sourceIds
      .map((id) => sources.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (!entries.length) {
      result.source_failures.push({ source_code: definition.id, error: 'Data source is missing or inactive' });
      result.errors++;
      continue;
    }

    // A process-grain definition takes its process from the SOURCE's mapping,
    // not from the definition's scope: the scope says which people a definition
    // applies to, which is meaningless when there are no people involved.
    const merged = new Map<string, Map<string, number | null>>();
    const fieldNames: string[] = [];
    // Resolved BEFORE any source is read, so a run scoped to one process does not
    // pay to scan another's. A process-grain definition takes its process from the
    // source's mapping, not from its own scope, so this is the only place the
    // answer is known.
    // An employee-kind source describes a shape, not a client, so the definition's
    // own scope says which process it is being read for. Every other kind carries
    // the process on the source itself.
    let processId: string | null = null;
    for (const entry of entries) {
      const src = entry.source as { process_id?: string | null; process_key_kind?: string | null };
      const mapped = src.process_key_kind === 'employee'
        ? (definition.process_id ?? src.process_id ?? null)
        : (src.process_id ?? null);
      if (mapped) { processId = mapped; break; }
    }

    // Asking to compute one process must not silently recompute every other one.
    // Beyond the wasted scan, a targeted rerun would rewrite another client's
    // figures from whatever their source happens to return at that moment — so a
    // source that is briefly unreadable would replace good numbers with none.
    if (options.processId && processId && processId !== options.processId) continue;

    for (const entry of entries) {
      const source = entry.source as any;
      const read = await readProcessGrainValues(source, entry.fields, options.date, options.date, processId);
      if (read.error) {
        result.source_failures.push({ source_code: source.source_code, error: read.error });
        continue;
      }
      for (const [date, bucket] of read.values) {
        const target = merged.get(date) ?? new Map<string, number | null>();
        for (const [name, value] of bucket) target.set(name, value);
        merged.set(date, target);
      }
      for (const field of entry.fields) fieldNames.push(field.field_name);
    }

    if (!processId) {
      result.source_failures.push({
        source_code: definition.metric_code,
        error: 'No source for this definition is mapped to a process',
      });
      result.errors++;
      continue;
    }

    for (const [date, bucket] of merged) {
      const inputs: Record<string, number | null> = {};
      for (const name of [...new Set(fieldNames)]) inputs[name] = bucket.get(name) ?? null;

      const evaluated = evaluateFormula(definition.formula_expression as string, inputs);

      // A broken formula and a formula that legitimately has nothing to say are
      // different outcomes, counted separately — the same distinction the
      // employee path makes. Collapsing them would hide a typo inside a pile of
      // "no data".
      if (evaluated.error) {
        result.errors++;
        if (result.sample.length < 20) {
          result.sample.push({
            employee_code: `process:${processId.slice(0, 8)}`,
            metric_code: definition.metric_code,
            value: null,
            status: 'error',
            reason: evaluated.error,
          } as ComputeOutcome['sample'][number]);
        }
        continue;
      }

      if (evaluated.value === null || evaluated.value === undefined) {
        result.no_data++;

        // Recorded as NULL rather than skipped, so that "there is no longer a
        // reading here" actually reaches the table.
        //
        // Skipping left whatever was written before untouched, which meant a
        // correction never propagated: excluding implausible 24-hour shifts from
        // the biometric source turned several days into no_data, and those days
        // kept showing the very averages the exclusion was meant to remove — one
        // process still reporting a 19-hour mean shift after the fix.
        //
        // Safe because this branch is only reached when the source WAS read and
        // the formula legitimately produced nothing. A source that could not be
        // read at all fails earlier, is counted in source_failures, and never
        // arrives here, so an unreachable database still cannot erase good
        // numbers.
        if (!options.dryRun) {
          const nulls = (await processMetricRollupSupported())
            ? ', rollup_numerator = NULL, rollup_denominator = NULL'
            : '';
          await withDeadlockRetry(() =>
            db.execute(
              `UPDATE process_metric_actual
                  SET actual_value = NULL${nulls}, note = ?
                WHERE process_id = ? AND metric_key = ? AND score_date = ?`,
              [
                `KPI Studio definition ${definition.id} — no reading for this day`,
                processId,
                definition.metric_code,
                date,
              ],
            ),
          );
        }

        if (result.sample.length < 20) {
          result.sample.push({
            employee_code: `process:${processId.slice(0, 8)}`,
            metric_code: definition.metric_code,
            value: null,
            status: 'no_data',
            reason: evaluated.nullReason ?? 'formula produced no value for this period',
          } as ComputeOutcome['sample'][number]);
        }
        continue;
      }

      if (!options.dryRun) {
        // Written only where the schema carries the columns, so this runs
        // unchanged on a database that has not had 1685 applied — the same rule
        // every other capability-gated write in this module follows.
        const parts = (await processMetricRollupSupported())
          ? ratioParts(definition.formula_expression as string, inputs)
          : null;
        const rollupCols = (await processMetricRollupSupported())
          ? ', rollup_numerator, rollup_denominator'
          : '';
        const rollupValues = (await processMetricRollupSupported())
          ? ', ?, ?'
          : '';
        const rollupUpdate = (await processMetricRollupSupported())
          ? `
             rollup_numerator   = VALUES(rollup_numerator),
             rollup_denominator = VALUES(rollup_denominator),`
          : '';
        // Retried, because a bulk run contends with itself and with whatever else
        // is writing. A single lock-wait timeout was leaving one process-day with
        // no reading at all during a 52-process sweep — recorded in
        // source_failures, so visible, but a permanent gap for a condition that
        // resolves on its own in milliseconds.
        await withDeadlockRetry(
          () =>
            db.execute(
              `INSERT INTO process_metric_actual
                 (id, process_id, metric_key, score_date, actual_value, source, source_connector_key, note${rollupCols})
               VALUES (UUID(), ?, ?, ?, ?, 'connector', NULL, ?${rollupValues})
               ON DUPLICATE KEY UPDATE
                 actual_value = VALUES(actual_value),${rollupUpdate}
                 source       = 'connector',
                 note         = VALUES(note)`,
              [
                processId,
                definition.metric_code,
                date,
                evaluated.value,
                `KPI Studio definition ${definition.id}`,
                ...(rollupCols ? [parts?.numerator ?? null, parts?.denominator ?? null] : []),
              ],
            ),
          {
            onRetry: (attempt, error) =>
              console.warn(
                `[kpi-studio] ${definition.metric_code} ${date}: lock contention, attempt ${attempt} — ` +
                  `${(error as Error).message}`,
              ),
          },
        );
      }
      result.written++;
      if (result.sample.length < 20) {
        result.sample.push({
          employee_code: `process:${processId.slice(0, 8)}`,
          metric_code: definition.metric_code,
          value: evaluated.value,
          status: 'computed',
        } as ComputeOutcome['sample'][number]);
      }
    }
  }

  return result;
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
    processId: string | null;
    branchId: string | null;
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

    writes.push({
      employeeId: employee.id,
      metricId: definition.metric_id,
      value: evaluated.value,
      processId: employee.process_id ?? null,
      branchId: employee.branch_id ?? null,
    });
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
  //
  // process_id_at_event / branch_id_at_event are written from the employee's
  // CURRENT process and branch (both already selected by the employee query
  // above). Without them these rows are invisible to every process-scoped
  // dashboard -- the Process KPI Dashboard and process-performance both filter
  // on exactly these columns -- so a Studio figure computed successfully, landed
  // in the table, and then silently never appeared anywhere. The row was plainly
  // present; it just never matched. Same class of bug as
  // team_leader_id_at_event, which turned out never to be written at all.
  const CHUNK = 200;
  for (let index = 0; index < writes.length; index += CHUNK) {
    const chunk = writes.slice(index, index + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const write of chunk) {
      params.push(
        write.employeeId, write.metricId, options.date, write.value, 'calculated',
        write.processId, write.branchId,
      );
    }
    await db.execute(
      `INSERT INTO kpi_daily_actual
         (employee_id, metric_id, score_date, actual_value, source,
          process_id_at_event, branch_id_at_event)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         actual_value        = VALUES(actual_value),
         source              = VALUES(source),
         process_id_at_event = VALUES(process_id_at_event),
         branch_id_at_event  = VALUES(branch_id_at_event)`,
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

// ─── Process-grain preview ───────────────────────────────────────────────────────────────────

export interface ProcessPreviewDay {
  date: string;
  inputs: Record<string, number | null>;
  value: number | null;
  status: 'computed' | 'no_data' | 'error';
  reason?: string;
}

export interface ProcessPreviewResult {
  ok: boolean;
  message?: string;
  formula: string;
  from: string;
  to: string;
  process_id: string | null;
  days: ProcessPreviewDay[];
  /** The average of the days that produced a number. Null when none did. */
  value: number | null;
  rows_read: number;
  source_error?: string;
}

/**
 * The process-grain half of the "test it" button.
 *
 * previewFormula answers "what does this formula give for THIS PERSON today". A process
 * metric has no person — AL% for BLABLIBLU is one number for the whole process — so that
 * function cannot test one, and until this existed a process KPI could only be configured
 * blind: save it, wait for the nightly compute, and find out the next morning whether the
 * formula read anything at all.
 *
 * It runs over a date RANGE rather than a single day, because that is how a process metric
 * is read and because one day is a poor test: a formula can look fine on a day the source
 * happened to be quiet. Each day is reported separately, with the values that produced it.
 */
export async function previewProcessFormula(input: {
  formula: string;
  dataSourceId: string;
  extraSourceIds?: string[];
  from: string;
  to: string;
  /** Which client to test, for a source that finds its process via the employee. */
  processId?: string | null;
}): Promise<ProcessPreviewResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from = ISO_DATE.test(input.from) ? input.from : today;
  const to = ISO_DATE.test(input.to) ? input.to : from;

  const base: ProcessPreviewResult = {
    ok: false,
    formula: input.formula,
    from,
    to,
    process_id: null,
    days: [],
    value: null,
    rows_read: 0,
  };

  if (from > to) return { ...base, message: 'The start date is after the end date' };

  const capability = await getStudioCapability();
  if (!capability.tables) {
    return { ...base, message: 'KPI Studio schema is not installed on this database' };
  }
  // Without 1680 a source carries no process mapping, so there is nothing to read
  // a process metric from. Saying so beats returning an empty result that reads
  // as "your formula found nothing".
  if (!capability.processGrain) {
    return {
      ...base,
      message:
        'Process-level metrics need migration 1680_kpi_studio_process_grain.sql, which this ' +
        'database does not have yet. Until it is applied, a source cannot be mapped to a process.',
    };
  }

  const sourceIds = [...new Set([input.dataSourceId, ...(input.extraSourceIds ?? [])].filter(Boolean))];
  const sources = await loadSourcesWithFields(sourceIds);
  const entries = sourceIds
    .map((sourceId) => sources.get(sourceId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (!entries.length) return { ...base, message: 'Data source not found or inactive' };
  const allFields = entries.flatMap((entry) => entry.fields);
  if (!allFields.length) return { ...base, message: 'This data source has no fields configured yet' };

  // Merged exactly the way computeProcessGrainDefinitions merges, so a formula that
  // previews cannot then fail at compute time for a reason the preview never showed.
  const merged = new Map<string, Map<string, number | null>>();
  const failures: string[] = [];
  let processId: string | null = null;
  let rowsRead = 0;

  for (const entry of entries) {
    const source = entry.source as any;
    processId = processId
      ?? (source.process_key_kind === 'employee' ? (input.processId ?? source.process_id) : source.process_id)
      ?? null;
    const read = await readProcessGrainValues(source, entry.fields, from, to, processId);
    if (read.error) {
      failures.push(`${source.source_code}: ${read.error}`);
      continue;
    }
    rowsRead += read.rowsRead;
    for (const [date, bucket] of read.values) {
      const target = merged.get(date) ?? new Map<string, number | null>();
      for (const [name, value] of bucket) target.set(name, value);
      merged.set(date, target);
    }
  }

  const sourceError = failures.length ? failures.join(' · ') : undefined;

  if (!processId) {
    return {
      ...base,
      rows_read: rowsRead,
      source_error: sourceError,
      message:
        'None of these sources is mapped to a process. Set "This source belongs to" on the ' +
        'source before a process-level KPI can read it.',
    };
  }

  if (!merged.size) {
    return {
      ...base,
      process_id: processId,
      rows_read: rowsRead,
      source_error: sourceError,
      message: sourceError
        ? 'The data source could not be read'
        : 'The source returned no rows for these dates. Try a range the data actually covers.',
    };
  }

  const fieldNames = [...new Set(allFields.map((field) => field.field_name))];
  const days: ProcessPreviewDay[] = [];

  for (const date of [...merged.keys()].sort()) {
    const bucket = merged.get(date)!;
    const inputs: Record<string, number | null> = {};
    for (const name of fieldNames) inputs[name] = bucket.get(name) ?? null;

    const evaluated = evaluateFormula(input.formula, inputs);
    if (evaluated.error) {
      days.push({ date, inputs, value: null, status: 'error', reason: evaluated.error });
    } else if (evaluated.value === null || evaluated.value === undefined) {
      days.push({ date, inputs, value: null, status: 'no_data', reason: evaluated.nullReason });
    } else {
      days.push({ date, inputs, value: evaluated.value, status: 'computed' });
    }
  }

  // The headline is the mean of the days that produced a number — NOT of every day
  // in the range. A day the source was silent is absent, not a zero, and averaging
  // a zero in would quietly understate every metric this previews.
  const computed = days.filter((day) => day.status === 'computed' && day.value !== null);
  const value = computed.length
    ? computed.reduce((total, day) => total + (day.value as number), 0) / computed.length
    : null;

  return {
    ok: true,
    formula: input.formula,
    from,
    to,
    process_id: processId,
    days,
    value,
    rows_read: rowsRead,
    source_error: sourceError,
    message: computed.length ? undefined : 'No day in this range produced a number',
  };
}
