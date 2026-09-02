/**
 * KPI Studio — configuration service.
 *
 * Owns the tables added by migration 1644/1645 and turns them into the answer to one question:
 * "for THIS employee, on THIS date, which KPIs apply, what is each one's target, and how is each
 * one calculated?"
 *
 * The existing resolver (resolveEmployeeKpis in kpi-master.service.ts) answers a narrower
 * version of that from kpi_master_config alone, across four org-unit tiers, and cannot express
 * a formula or a per-employee override at all. This service adds both without replacing it:
 * Studio definitions win where they exist, kpi_master_config continues to answer everywhere
 * else, so 372 existing configured targets keep working untouched.
 *
 * EVERYTHING HERE DEGRADES. Production runs SKIP_MIGRATIONS=true, so this code can be deployed
 * before 1644/1645 are applied. Every read probes for the tables first and returns "not
 * installed" rather than throwing ER_NO_SUCH_TABLE, and every write refuses with a clear message
 * instead of a 500. The same guard pattern effectiveDatingPredicate() and getLineageColumns()
 * already use, for the same reason: an unconditional query against a table that does not exist
 * took reimbursements down on the day it shipped.
 */

import { db } from '../../db/mysql.js';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { validateFormula, listFormulaFunctions } from './kpi-formula.engine.js';
import { validateSheetCsvUrl } from './kpi-studio.gsheet.js';

// ─── Types ───────────────────────────────────────────────────────────────────────────────────

export type StudioSourceType =
  | 'local_query'
  | 'integration_connector'
  | 'upload'
  | 'manual'
  /** A Google Sheet published to the web as CSV. Live, and needs no stored credential. */
  | 'google_sheet_csv';

export type AggregationMethod = 'average' | 'sum' | 'last' | 'min' | 'max';

export const AGGREGATION_METHODS: readonly AggregationMethod[] = ['average', 'sum', 'last', 'min', 'max'];

/**
 * Scope of a definition. Every non-null field must match the employee for the definition to
 * apply; how many are set decides which definition wins.
 */
export interface StudioScope {
  branch_id?: string | null;
  process_id?: string | null;
  designation_id?: string | null;
  employee_id?: string | null;
}

export interface StudioDefinitionInput extends StudioScope {
  id?: string;
  metric_id: string;
  data_source_id?: string | null;
  /**
   * Extra sources this KPI's formula may read, beyond data_source_id.
   *
   * Present because one metric legitimately spans systems: PCT(audited_passed, total_calls) where
   * the numerator is kept in a QA Google Sheet and the denominator lives in the dialer database.
   * data_source_id remains the primary source so every definition written before this existed keeps
   * resolving unchanged.
   */
  extra_source_ids?: string[] | null;
  formula_expression?: string | null;
  aggregation_method?: string | null;
  scoring_type?: string | null;
  target_value?: number | null;
  min_threshold?: number | null;
  max_achievement?: number | null;
  weightage?: number | null;
  target_source?: string | null;
  effective_from?: string | null;
  notes?: string | null;
}

export interface ResolvedStudioKpi {
  definition_id: string;
  metric_id: string;
  data_source_id: string | null;
  formula_expression: string | null;
  aggregation_method: string | null;
  scoring_type: string | null;
  target_value: number | null;
  min_threshold: number | null;
  max_achievement: number;
  weightage: number;
  /** Which precedence tier won, in words, for display beside the number. */
  resolved_scope: string;
  tier: number;
}

// ─── Scope precedence ────────────────────────────────────────────────────────────────────────

/**
 * Precedence, most specific first. Deliberately computed here and NOT stored on the row:
 * a stored tier is a second copy of this rule that drifts the first time somebody adds a scope
 * dimension and updates one of the two places.
 *
 * The ordering answers a real question about how these organisations work. An employee-specific
 * definition beats everything, because a target agreed with one person during a PIP must not be
 * silently overwritten by a process-wide change. Below that, process beats designation: the same
 * designation on two processes is measured differently (a TEAM LEADER on a voice process and on
 * a back-office process share a job title and share almost no metrics), whereas the same process
 * across designations at least shares a metric set. Branch refines rather than overrides, so it
 * only ever breaks ties between otherwise equally specific rows.
 */
const SCOPE_TIERS: ReadonlyArray<{
  tier: number;
  label: string;
  needs: ReadonlyArray<keyof StudioScope>;
}> = [
  { tier: 0, label: 'employee', needs: ['employee_id'] },
  { tier: 1, label: 'branch+process+designation', needs: ['branch_id', 'process_id', 'designation_id'] },
  { tier: 2, label: 'process+designation', needs: ['process_id', 'designation_id'] },
  { tier: 3, label: 'branch+process', needs: ['branch_id', 'process_id'] },
  { tier: 4, label: 'process', needs: ['process_id'] },
  { tier: 5, label: 'branch+designation', needs: ['branch_id', 'designation_id'] },
  { tier: 6, label: 'designation', needs: ['designation_id'] },
  { tier: 7, label: 'branch', needs: ['branch_id'] },
];

/**
 * Classifies a scope into its precedence tier, or null when nothing is set.
 *
 * An employee-scoped row is tier 0 regardless of what else it carries: "this person" is already
 * maximally specific, and a row naming both an employee and a process is not more specific than
 * one naming the employee — it is the same single person, with a redundant process that would
 * only cause the row to stop applying if they transferred. Which is exactly the surprise this
 * avoids.
 */
export function classifyScope(scope: StudioScope): { tier: number; label: string } | null {
  if (scope.employee_id) return { tier: 0, label: 'employee' };

  const set = (key: keyof StudioScope) => Boolean(scope[key]);
  for (const candidate of SCOPE_TIERS) {
    if (candidate.tier === 0) continue;
    const exactMatch =
      candidate.needs.every(set) &&
      (['branch_id', 'process_id', 'designation_id'] as Array<keyof StudioScope>).every(
        (key) => candidate.needs.includes(key) === set(key),
      );
    if (exactMatch) return { tier: candidate.tier, label: candidate.label };
  }
  return null;
}

export interface EmployeeOrgContext {
  id: string;
  branch_id: string | null;
  process_id: string | null;
  designation_id: string | null;
}

/**
 * A definition applies to an employee only when every scope dimension it names matches.
 *
 * Note the asymmetry that makes this correct: a definition scoped to a process applies to an
 * employee on that process regardless of their branch, but a definition scoped to a branch AND a
 * process applies only if BOTH match. Absent means "any", never "none" — the opposite reading
 * would make a process-wide target apply to nobody.
 */
export function scopeMatchesEmployee(scope: StudioScope, employee: EmployeeOrgContext): boolean {
  if (scope.employee_id) return scope.employee_id === employee.id;
  if (scope.branch_id && scope.branch_id !== employee.branch_id) return false;
  if (scope.process_id && scope.process_id !== employee.process_id) return false;
  if (scope.designation_id && scope.designation_id !== employee.designation_id) return false;
  // All-null was rejected at write time; reaching here with nothing set would mean a row that
  // applies to the whole company, so refuse it defensively too.
  return Boolean(scope.branch_id || scope.process_id || scope.designation_id);
}

/**
 * Picks the winning definition per metric for one employee. Pure, so the precedence rule can be
 * tested exhaustively without a database.
 *
 * Ties on tier are broken by the later effective_from: two rows at the same specificity for the
 * same metric can only differ by when they start, and the more recent decision is the current
 * one. The unique index on (metric_id, scope_key, effective_from) makes a true tie impossible.
 */
export function pickWinningDefinitions<T extends StudioScope & { metric_id: string; effective_from?: string | Date | null }>(
  definitions: readonly T[],
  employee: EmployeeOrgContext,
): Array<{ definition: T; tier: number; label: string }> {
  const best = new Map<string, { definition: T; tier: number; label: string }>();

  for (const definition of definitions) {
    if (!scopeMatchesEmployee(definition, employee)) continue;
    const classified = classifyScope(definition);
    if (!classified) continue;

    const existing = best.get(definition.metric_id);
    if (!existing) {
      best.set(definition.metric_id, { definition, tier: classified.tier, label: classified.label });
      continue;
    }
    if (classified.tier < existing.tier) {
      best.set(definition.metric_id, { definition, tier: classified.tier, label: classified.label });
      continue;
    }
    if (classified.tier === existing.tier) {
      const incoming = String(definition.effective_from ?? '');
      const current = String(existing.definition.effective_from ?? '');
      if (incoming > current) {
        best.set(definition.metric_id, { definition, tier: classified.tier, label: classified.label });
      }
    }
  }

  return [...best.values()];
}

// ─── Validation ──────────────────────────────────────────────────────────────────────────────

export interface ValidationOutcome {
  ok: boolean;
  message?: string;
  /** Fields the formula reads, echoed back so the UI can show what needs mapping. */
  variables?: string[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates a definition before it is saved. Pure, and deliberately strict about the two
 * mistakes that produce a KPI which looks configured but can never score anybody.
 */
export function validateDefinition(
  input: StudioDefinitionInput,
  context: {
    /** Field names the chosen data source exposes. Empty when no source is chosen. */
    availableFields?: readonly string[];
    /** From kpi_metric_master, so a percentage target above 100 can be caught. */
    metric?: { unit?: string | null; direction?: string | null } | null;
  } = {},
): ValidationOutcome {
  if (!input.metric_id || typeof input.metric_id !== 'string') {
    return { ok: false, message: 'Choose which KPI this applies to' };
  }

  const classified = classifyScope(input);
  if (!classified) {
    // Rejecting this is not pedantry. A definition with no scope applies to every employee in
    // the company, which nobody configuring a KPI for a process has ever meant, and it would
    // outrank nothing while being outranked by nothing.
    return {
      ok: false,
      message: 'Choose at least a branch, process, designation or employee — a KPI with no scope would apply to everyone',
    };
  }

  if (input.effective_from && !ISO_DATE.test(input.effective_from)) {
    return { ok: false, message: 'Start date must be YYYY-MM-DD' };
  }

  // ── Formula ──
  let variables: string[] = [];
  if (input.formula_expression && input.formula_expression.trim()) {
    const validated = validateFormula(input.formula_expression, context.availableFields);
    if (!validated.ok) return { ok: false, message: validated.error, variables: validated.variables };
    variables = validated.variables;

    // A formula with no source is a formula whose inputs can never be fetched. It would
    // validate, save, and then produce null for every employee for ever — indistinguishable
    // from a source outage.
    if (!input.data_source_id) {
      return {
        ok: false,
        message: 'A calculation needs a data source, otherwise its inputs can never be read',
        variables,
      };
    }
  }

  // ── Target ──
  // A target is optional: a KPI can be tracked before anyone agrees what good looks like, and
  // forcing a placeholder produces a fake target that scores people. But a supplied one must
  // make sense.
  if (input.target_value !== null && input.target_value !== undefined) {
    if (!Number.isFinite(Number(input.target_value))) {
      return { ok: false, message: 'Target must be a number' };
    }
    if (Number(input.target_value) < 0) {
      return { ok: false, message: 'Target cannot be negative' };
    }
    if (context.metric?.unit === 'percent' && Number(input.target_value) > 100) {
      return { ok: false, message: `Target ${input.target_value} is above 100 for a percentage KPI` };
    }
  }

  // ── Threshold direction ──
  // The threshold is the unacceptable bound, so it always sits on the WORSE side of the target:
  // below it when higher is better (a ₹30,000 floor under a ₹50,000 goal), above it when lower
  // is better (a 360s ceiling under a 240s goal). Reversed, the floor gate fires on the wrong
  // side and zeroes everyone who is performing well.
  if (
    input.min_threshold !== null && input.min_threshold !== undefined &&
    input.target_value !== null && input.target_value !== undefined
  ) {
    const threshold = Number(input.min_threshold);
    const target = Number(input.target_value);
    if (!Number.isFinite(threshold)) {
      return { ok: false, message: 'Threshold must be a number or left blank' };
    }
    const lowerIsBetter = context.metric?.direction === 'lower_is_better';
    if (lowerIsBetter && threshold < target) {
      return { ok: false, message: `Threshold ${threshold} must be above the target ${target} when lower is better` };
    }
    if (!lowerIsBetter && context.metric?.direction && threshold > target) {
      return { ok: false, message: `Threshold ${threshold} must be below the target ${target} when higher is better` };
    }
  }

  if (input.weightage !== null && input.weightage !== undefined) {
    const weight = Number(input.weightage);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      return { ok: false, message: 'Weight must be between 0 and 100' };
    }
  }

  if (input.aggregation_method && !AGGREGATION_METHODS.includes(input.aggregation_method as AggregationMethod)) {
    return { ok: false, message: `Roll-up must be one of: ${AGGREGATION_METHODS.join(', ')}` };
  }

  return { ok: true, variables };
}

// ─── Capability probe ────────────────────────────────────────────────────────────────────────

export interface StudioCapability {
  /** The 1644 tables exist. */
  tables: boolean;
  /** The 1645 columns exist on kpi_employee_resolved. */
  resolution: boolean;
}

let capabilityCache: StudioCapability | null = null;

/**
 * Whether the Studio schema is present.
 *
 * Two flags rather than one because the halves fail differently and usefully: with `tables` but
 * not `resolution`, definitions can be authored and previewed but cannot yet drive live scores,
 * which is a reasonable state to deploy into and worth telling the user about rather than
 * silently doing nothing.
 */
export async function getStudioCapability(): Promise<StudioCapability> {
  if (capabilityCache) return capabilityCache;

  try {
    const [tableRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('kpi_studio_data_source','kpi_studio_source_field','kpi_studio_definition',
                             'kpi_studio_upload_batch','kpi_studio_manual_value','kpi_studio_computation_log')`,
    );
    const [columnRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'kpi_employee_resolved'
          AND COLUMN_NAME IN ('studio_definition_id','formula_expression','data_source_id',
                              'aggregation_method','scoring_type','resolved_scope')`,
    );
    capabilityCache = {
      tables: Number((tableRows as any[])[0]?.n ?? 0) === 6,
      resolution: Number((columnRows as any[])[0]?.n ?? 0) === 6,
    };
  } catch {
    // A failed probe is not a reason to take the KPI pages down. Treat it as "not installed".
    capabilityCache = { tables: false, resolution: false };
  }

  return capabilityCache;
}

/** Exposed so a test, or a process that has just run the migration, can re-check. */
export function resetStudioCapability(): void {
  capabilityCache = null;
}

export class StudioNotInstalledError extends Error {
  readonly statusCode = 503;
  constructor() {
    super(
      'KPI Studio schema is not installed on this database. Apply migrations ' +
        '1644_kpi_studio_foundation.sql and 1645_kpi_studio_resolution.sql.',
    );
    this.name = 'StudioNotInstalledError';
  }
}

async function requireStudioTables(): Promise<void> {
  const capability = await getStudioCapability();
  if (!capability.tables) throw new StudioNotInstalledError();
}

// ─── Data sources ────────────────────────────────────────────────────────────────────────────

export async function listDataSources(): Promise<RowDataPacket[]> {
  if (!(await getStudioCapability()).tables) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT s.id, s.source_code, s.source_name, s.source_type, s.integration_key, s.source_object,
            s.employee_key_column, s.employee_key_kind, s.date_column, s.description, s.active_status,
            s.config_json,
            COUNT(f.id) AS field_count
       FROM kpi_studio_data_source s
       LEFT JOIN kpi_studio_source_field f ON f.data_source_id = s.id AND f.active_status = 1
      WHERE s.active_status = 1
      GROUP BY s.id
      ORDER BY s.source_name`,
  );
  return rows;
}

export async function getDataSourceWithFields(id: string) {
  if (!(await getStudioCapability()).tables) return null;
  const [sourceRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM kpi_studio_data_source WHERE id = ? LIMIT 1`,
    [id],
  );
  const source = (sourceRows as any[])[0];
  if (!source) return null;

  const [fieldRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, field_name, display_name, source_column, aggregate_fn, source_expression, unit, description
       FROM kpi_studio_source_field
      WHERE data_source_id = ? AND active_status = 1
      ORDER BY field_name`,
    [id],
  );
  return { ...source, fields: fieldRows };
}

export async function saveDataSource(
  input: {
    id?: string;
    source_code: string;
    source_name: string;
    source_type: string;
    integration_key?: string | null;
    source_object?: string | null;
    employee_key_column?: string | null;
    employee_key_kind?: string | null;
    date_column?: string | null;
    description?: string | null;
    /** google_sheet_csv only: the File → Share → Publish to web CSV link. */
    csv_url?: string | null;
    /** google_sheet_csv only: which tab, when the publish link covers the whole document. */
    sheet_tab?: string | null;
  },
  userId?: string,
) {
  await requireStudioTables();

  const code = String(input.source_code ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
    throw new Error('Source code must start with a letter and contain only letters, numbers and underscores');
  }
  if (!input.source_name?.trim()) throw new Error('Source needs a name');

  const validTypes: StudioSourceType[] = [
    'local_query',
    'integration_connector',
    'upload',
    'manual',
    'google_sheet_csv',
  ];
  if (!validTypes.includes(input.source_type as StudioSourceType)) {
    throw new Error(`Source type must be one of: ${validTypes.join(', ')}`);
  }
  if (input.source_type === 'integration_connector' && !input.integration_key?.trim()) {
    throw new Error('A connector source needs the integration key of a configured external system');
  }

  // A sheet's published link is validated HERE, on save, not at compute time. A source that only
  // reveals a bad URL when the nightly job runs is a source nobody can debug, and the URL rules
  // (https, Google host, actually published) are exactly the kind of mistake made once and then
  // never revisited.
  let configJson: string | null = null;
  if (input.source_type === 'google_sheet_csv') {
    const url = validateSheetCsvUrl(String(input.csv_url ?? ''));
    if (!input.employee_key_column?.trim()) {
      throw new Error('Say which column heading in the sheet holds the employee code');
    }
    if (!input.date_column?.trim()) {
      throw new Error('Say which column heading in the sheet holds the date');
    }
    configJson = JSON.stringify({ csv_url: url, tab: input.sheet_tab?.trim() || null });
  }

  if (input.id) {
    // COALESCE, not a plain overwrite: an edit that does not resend the sheet link must not wipe it,
    // which would silently detach a working source from its data.
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE kpi_studio_data_source
          SET source_name = ?, source_type = ?, integration_key = ?, source_object = ?,
              employee_key_column = ?, employee_key_kind = ?, date_column = ?, description = ?,
              config_json = COALESCE(?, config_json)
        WHERE id = ?`,
      [
        input.source_name.trim(),
        input.source_type,
        input.integration_key?.trim() || null,
        input.source_object?.trim() || null,
        input.employee_key_column?.trim() || null,
        input.employee_key_kind?.trim() || 'employee_code',
        input.date_column?.trim() || null,
        input.description?.trim() || null,
        configJson,
        input.id,
      ],
    );
    if (!result.affectedRows) throw new Error('Data source not found');
    return { id: input.id };
  }

  const [rows] = await db.execute<RowDataPacket[]>(`SELECT UUID() AS id`);
  const id = String((rows as any[])[0].id);
  await db.execute(
    `INSERT INTO kpi_studio_data_source
       (id, source_code, source_name, source_type, integration_key, source_object,
        employee_key_column, employee_key_kind, date_column, description, config_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      code,
      input.source_name.trim(),
      input.source_type,
      input.integration_key?.trim() || null,
      input.source_object?.trim() || null,
      input.employee_key_column?.trim() || null,
      input.employee_key_kind?.trim() || 'employee_code',
      input.date_column?.trim() || null,
      input.description?.trim() || null,
      configJson,
      userId ?? null,
    ],
  );
  return { id };
}

const AGGREGATE_FUNCTIONS = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'NONE'] as const;

export async function saveSourceField(input: {
  id?: string;
  data_source_id: string;
  field_name: string;
  display_name?: string | null;
  source_column?: string | null;
  aggregate_fn?: string | null;
  unit?: string | null;
  description?: string | null;
}) {
  await requireStudioTables();

  const fieldName = String(input.field_name ?? '').trim();
  // The field name becomes a formula variable, so it has to be a legal identifier. Allowing
  // "talk time (sec)" here would let somebody create a field no formula can ever reference.
  if (!IDENTIFIER.test(fieldName)) {
    throw new Error(
      'Field name must start with a letter or underscore and contain only letters, numbers and underscores, ' +
        'because it is what you type in a formula',
    );
  }

  const aggregate = String(input.aggregate_fn ?? 'SUM').toUpperCase();
  if (!AGGREGATE_FUNCTIONS.includes(aggregate as (typeof AGGREGATE_FUNCTIONS)[number])) {
    throw new Error(`Aggregate must be one of: ${AGGREGATE_FUNCTIONS.join(', ')}`);
  }

  // A column name cannot be a bound parameter, so it is identifier-validated instead. Same guard
  // databaseAdapter.ts applies before interpolating a configurable column into SQL.
  const column = input.source_column?.trim() || null;
  if (column && !IDENTIFIER.test(column)) {
    throw new Error(`"${column}" is not a valid column name`);
  }

  // Built here rather than accepted from the client: a client-supplied SQL fragment reaching a
  // query is an injection point no amount of downstream validation reliably closes.
  const expression = column
    ? aggregate === 'NONE'
      ? `\`${column}\``
      : `${aggregate}(\`${column}\`)`
    : null;

  if (input.id) {
    await db.execute(
      `UPDATE kpi_studio_source_field
          SET field_name = ?, display_name = ?, source_column = ?, aggregate_fn = ?,
              source_expression = ?, unit = ?, description = ?
        WHERE id = ?`,
      [
        fieldName,
        input.display_name?.trim() || null,
        column,
        aggregate,
        expression,
        input.unit?.trim() || null,
        input.description?.trim() || null,
        input.id,
      ],
    );
    return { id: input.id };
  }

  const [rows] = await db.execute<RowDataPacket[]>(`SELECT UUID() AS id`);
  const id = String((rows as any[])[0].id);
  await db.execute(
    `INSERT INTO kpi_studio_source_field
       (id, data_source_id, field_name, display_name, source_column, aggregate_fn,
        source_expression, unit, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name      = VALUES(display_name),
       source_column     = VALUES(source_column),
       aggregate_fn      = VALUES(aggregate_fn),
       source_expression = VALUES(source_expression),
       unit              = VALUES(unit),
       description       = VALUES(description),
       active_status     = 1`,
    [
      id,
      input.data_source_id,
      fieldName,
      input.display_name?.trim() || null,
      column,
      aggregate,
      expression,
      input.unit?.trim() || null,
      input.description?.trim() || null,
    ],
  );
  return { id };
}

export async function deleteSourceField(id: string) {
  await requireStudioTables();
  // Deactivated, not deleted: a formula may still reference this field, and a hard delete would
  // make the resulting validation error impossible to explain.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE kpi_studio_source_field SET active_status = 0 WHERE id = ?`,
    [id],
  );
  return { removed: result.affectedRows > 0 };
}

/**
 * Every field name available to a definition, across ALL the sources it reads.
 *
 * The union rather than one source's list, because a multi-source formula references fields from
 * several systems and validating it against only the primary source would reject a perfectly good
 * formula for using the sheet-side field.
 */
async function availableFieldsFor(dataSourceIds: ReadonlyArray<string | null | undefined>): Promise<string[]> {
  const ids = [...new Set(dataSourceIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT field_name FROM kpi_studio_source_field
      WHERE data_source_id IN (${ids.map(() => '?').join(',')}) AND active_status = 1`,
    ids,
  );
  return (rows as any[]).map((row) => String(row.field_name));
}

/**
 * Finds a field name supplied by more than one of a definition's sources.
 *
 * Two sources both offering `total_calls` makes the formula ambiguous, and resolving it silently —
 * by read order, say — means the number depends on configuration nobody looked at. Rejecting it on
 * save, naming both sources, costs the author one rename and removes the ambiguity permanently.
 * This is the reason the formula language needs no `source.field` qualification.
 */
async function findFieldCollisions(
  dataSourceIds: ReadonlyArray<string | null | undefined>,
): Promise<Array<{ field_name: string; sources: string[] }>> {
  const ids = [...new Set(dataSourceIds.filter((id): id is string => Boolean(id)))];
  if (ids.length < 2) return [];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT f.field_name, s.source_name
       FROM kpi_studio_source_field f
       JOIN kpi_studio_data_source s ON s.id = f.data_source_id
      WHERE f.data_source_id IN (${ids.map(() => '?').join(',')}) AND f.active_status = 1`,
    ids,
  );

  const byField = new Map<string, string[]>();
  for (const row of rows as any[]) {
    const field = String(row.field_name);
    if (!byField.has(field)) byField.set(field, []);
    byField.get(field)!.push(String(row.source_name));
  }

  return [...byField.entries()]
    .filter(([, sources]) => sources.length > 1)
    .map(([field_name, sources]) => ({ field_name, sources }));
}

/** All source ids a definition reads: its primary plus any extras. */
export function allSourceIdsFor(input: {
  data_source_id?: string | null;
  extra_source_ids?: string[] | null;
}): string[] {
  return [...new Set([input.data_source_id, ...(input.extra_source_ids ?? [])].filter((id): id is string => Boolean(id)))];
}

// ─── Definitions ─────────────────────────────────────────────────────────────────────────────

export interface DefinitionFilters {
  metric_id?: string;
  branch_id?: string;
  process_id?: string;
  designation_id?: string;
  employee_id?: string;
  /** Restrict to rows in force on this date. Omit to see history too. */
  as_of?: string;
  /** Extra scope predicate from buildScopeWhereClause, already parameterised. */
  scopeSql?: { sql: string; params: unknown[] };
}

export async function listDefinitions(filters: DefinitionFilters = {}) {
  if (!(await getStudioCapability()).tables) return [];

  const where: string[] = ['d.active_status = 1'];
  const params: unknown[] = [];

  if (filters.metric_id) { where.push('d.metric_id = ?'); params.push(filters.metric_id); }
  if (filters.branch_id) { where.push('d.branch_id = ?'); params.push(filters.branch_id); }
  if (filters.process_id) { where.push('d.process_id = ?'); params.push(filters.process_id); }
  if (filters.designation_id) { where.push('d.designation_id = ?'); params.push(filters.designation_id); }
  if (filters.employee_id) { where.push('d.employee_id = ?'); params.push(filters.employee_id); }
  if (filters.as_of) {
    // NULL on either bound means "no bound", not "excluded". Written the other way round, a
    // definition with no end date would vanish — the exact bug effectiveDatingPredicate()
    // documents having shipped once already.
    where.push('d.effective_from <= ? AND (d.effective_to IS NULL OR d.effective_to >= ?)');
    params.push(filters.as_of, filters.as_of);
  }
  if (filters.scopeSql && filters.scopeSql.sql !== '1=1') {
    where.push(`(${filters.scopeSql.sql})`);
    params.push(...filters.scopeSql.params);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       d.id, d.metric_id, m.metric_code, m.metric_name, m.unit, m.direction, m.category,
       d.branch_id, b.branch_name,
       d.process_id, p.process_name,
       d.designation_id, g.designation_name,
       d.employee_id, e.employee_code, e.full_name AS employee_name,
       d.data_source_id, s.source_name, s.source_type,
       d.formula_expression, d.aggregation_method, d.scoring_type,
       d.target_value, d.min_threshold, d.max_achievement, d.weightage, d.target_source,
       d.effective_from, d.effective_to, d.notes, d.created_at, d.updated_at
     FROM kpi_studio_definition d
     JOIN kpi_metric_master m ON m.id = d.metric_id
     LEFT JOIN branch_master b       ON b.id = d.branch_id
     LEFT JOIN process_master p      ON p.id = d.process_id
     LEFT JOIN designation_master g  ON g.id = d.designation_id
     LEFT JOIN employees e           ON e.id = d.employee_id
     LEFT JOIN kpi_studio_data_source s ON s.id = d.data_source_id
     WHERE ${where.join(' AND ')}
     ORDER BY m.metric_name, d.effective_from DESC`,
    params,
  );

  // Extra sources attached in one batched query rather than per row: the list view shows every
  // source a KPI reads, and a per-definition round trip would be one query per row.
  const extraByDefinition = new Map<string, Array<{ id: string; source_name: string; source_type: string }>>();
  if ((rows as any[]).length && (await multiSourceSupported())) {
    const definitionIds = (rows as any[]).map((row) => String(row.id));
    const [extraRows] = await db.execute<RowDataPacket[]>(
      `SELECT ds.definition_id, s.id, s.source_name, s.source_type
         FROM kpi_studio_definition_source ds
         JOIN kpi_studio_data_source s ON s.id = ds.data_source_id
        WHERE ds.definition_id IN (${definitionIds.map(() => '?').join(',')})
          AND ds.active_status = 1
        ORDER BY ds.read_order, ds.created_at`,
      definitionIds,
    );
    for (const row of extraRows as any[]) {
      const key = String(row.definition_id);
      if (!extraByDefinition.has(key)) extraByDefinition.set(key, []);
      extraByDefinition.get(key)!.push({
        id: String(row.id),
        source_name: String(row.source_name),
        source_type: String(row.source_type),
      });
    }
  }

  // The tier is attached on read rather than stored, so the list can show precedence without a
  // second copy of the rule in SQL.
  return (rows as any[]).map((row) => {
    const classified = classifyScope(row);
    return {
      ...row,
      scope_tier: classified?.tier ?? null,
      scope_label: classified?.label ?? null,
      extra_sources: extraByDefinition.get(String(row.id)) ?? [],
    };
  });
}

/**
 * Saves a definition.
 *
 * Never UPDATEs an existing row's formula or target. Editing in place is what makes
 * kpi_master_config unable to answer "what was this person actually measured against in June" —
 * a score computed against a target of 80 silently reports as measured against 95 after an edit,
 * and a performance conversation cannot separate "they got worse" from "we raised the bar".
 * A change closes the current row at the day before the new start date and inserts a new one.
 */
export async function saveDefinition(input: StudioDefinitionInput, userId?: string) {
  await requireStudioTables();

  const [metricRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, unit, direction FROM kpi_metric_master WHERE id = ? AND active_status = 1 LIMIT 1`,
    [input.metric_id],
  );
  const metric = (metricRows as any[])[0];
  if (!metric) throw new Error('That KPI does not exist or is inactive');

  const sourceIds = allSourceIdsFor(input);
  const availableFields = await availableFieldsFor(sourceIds);
  const validated = validateDefinition(input, { availableFields, metric });
  if (!validated.ok) throw new Error(validated.message ?? 'Definition is not valid');

  // Checked only when the formula actually spans sources. A collision between two sources whose
  // fields this formula never touches is not this definition's problem.
  if (sourceIds.length > 1) {
    const collisions = await findFieldCollisions(sourceIds);
    const referenced = new Set((validated.variables ?? []).map((name) => name.toLowerCase()));
    const blocking = collisions.filter((collision) => referenced.has(collision.field_name.toLowerCase()));
    if (blocking.length) {
      const first = blocking[0];
      throw new Error(
        `"${first.field_name}" is supplied by more than one of the chosen sources ` +
          `(${first.sources.join(' and ')}), so the calculation would be ambiguous. ` +
          `Rename it in one of them.`,
      );
    }
  }

  const effectiveFrom = input.effective_from || new Date().toISOString().slice(0, 10);

  const scope: StudioScope = {
    branch_id: input.employee_id ? null : input.branch_id || null,
    process_id: input.employee_id ? null : input.process_id || null,
    designation_id: input.employee_id ? null : input.designation_id || null,
    employee_id: input.employee_id || null,
  };

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Close any row currently in force for this exact scope. Guarded to rows that started
    // EARLIER: without that, re-saving the same start date would close the row being replaced
    // with an effective_to before its own effective_from.
    await connection.execute(
      `UPDATE kpi_studio_definition
          SET effective_to = DATE_SUB(?, INTERVAL 1 DAY), updated_at = CURRENT_TIMESTAMP
        WHERE metric_id = ?
          AND active_status = 1
          AND effective_to IS NULL
          AND effective_from < ?
          AND COALESCE(branch_id, '~')      = COALESCE(?, '~')
          AND COALESCE(process_id, '~')     = COALESCE(?, '~')
          AND COALESCE(designation_id, '~') = COALESCE(?, '~')
          AND COALESCE(employee_id, '~')    = COALESCE(?, '~')`,
      [
        effectiveFrom, input.metric_id, effectiveFrom,
        scope.branch_id, scope.process_id, scope.designation_id, scope.employee_id,
      ],
    );

    const [idRows] = await connection.execute<RowDataPacket[]>(`SELECT UUID() AS id`);
    const id = String((idRows as any[])[0].id);

    // ON DUPLICATE KEY covers re-saving the same scope on the same start date, which is an edit
    // made the same day and should replace rather than fail.
    await connection.execute(
      `INSERT INTO kpi_studio_definition
         (id, metric_id, branch_id, process_id, designation_id, employee_id,
          data_source_id, formula_expression, aggregation_method, scoring_type,
          target_value, min_threshold, max_achievement, weightage, target_source,
          effective_from, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         data_source_id     = VALUES(data_source_id),
         formula_expression = VALUES(formula_expression),
         aggregation_method = VALUES(aggregation_method),
         scoring_type       = VALUES(scoring_type),
         target_value       = VALUES(target_value),
         min_threshold      = VALUES(min_threshold),
         max_achievement    = VALUES(max_achievement),
         weightage          = VALUES(weightage),
         target_source      = VALUES(target_source),
         notes              = VALUES(notes),
         effective_to       = NULL,
         active_status      = 1,
         updated_at         = CURRENT_TIMESTAMP`,
      [
        id,
        input.metric_id,
        scope.branch_id,
        scope.process_id,
        scope.designation_id,
        scope.employee_id,
        input.data_source_id || null,
        input.formula_expression?.trim() || null,
        input.aggregation_method || 'average',
        input.scoring_type || null,
        input.target_value ?? null,
        input.min_threshold ?? null,
        input.max_achievement ?? 120,
        input.weightage ?? 100,
        input.target_source || 'manager',
        effectiveFrom,
        input.notes?.trim() || null,
        userId ?? null,
      ],
    );

    // ── Extra sources ──
    //
    // Written inside the same transaction as the definition: a definition whose formula reads a
    // sheet field, saved without the sheet attached, would evaluate to null for everybody and look
    // like the sheet was empty. The two have to land together or not at all.
    //
    // Only attempted when the table exists, so this file can ship before migration 1646 is applied
    // (production runs SKIP_MIGRATIONS=true) — matching how the rest of the Studio degrades.
    const extras = (input.extra_source_ids ?? []).filter(
      (sourceId) => sourceId && sourceId !== input.data_source_id,
    );
    if (await multiSourceSupported()) {
      // Cleared and rewritten rather than merged: the submitted list is the complete intent, and a
      // source the author removed must actually stop being read.
      await connection.execute(`DELETE FROM kpi_studio_definition_source WHERE definition_id = ?`, [id]);
      for (const [position, sourceId] of extras.entries()) {
        await connection.execute(
          `INSERT INTO kpi_studio_definition_source (id, definition_id, data_source_id, read_order)
           VALUES (UUID(), ?, ?, ?)
           ON DUPLICATE KEY UPDATE read_order = VALUES(read_order), active_status = 1`,
          [id, sourceId, (position + 1) * 10],
        );
      }
    } else if (extras.length) {
      throw new Error(
        'Reading more than one data source for a single KPI needs migration ' +
          '1646_kpi_studio_multi_source.sql to be applied first.',
      );
    }

    await connection.commit();
    return { id, effective_from: effectiveFrom, scope_label: classifyScope(scope)?.label ?? null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Whether migration 1646 has been applied. Cached like the other capability probes, and for the same
 * reason: an unconditional query against a table that does not exist takes the whole feature down on
 * a database where migrations are applied out of band.
 */
let multiSourceCache: boolean | null = null;

export async function multiSourceSupported(): Promise<boolean> {
  if (multiSourceCache !== null) return multiSourceCache;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition_source'`,
    );
    multiSourceCache = Number((rows as any[])[0]?.n ?? 0) === 1;
  } catch {
    multiSourceCache = false;
  }
  return multiSourceCache;
}

export function resetMultiSourceSupport(): void {
  multiSourceCache = null;
}

/**
 * The full source list for a set of definitions, primary plus extras, keyed by definition id.
 *
 * Batched rather than queried per definition: a computation run covers every definition in scope, and
 * a per-definition round trip is the difference between one query and forty.
 */
export async function getDefinitionSourceIds(
  definitions: ReadonlyArray<{ id: string; data_source_id?: string | null }>,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const definition of definitions) {
    result.set(definition.id, definition.data_source_id ? [definition.data_source_id] : []);
  }
  if (!definitions.length || !(await multiSourceSupported())) return result;

  const ids = definitions.map((definition) => definition.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT definition_id, data_source_id
       FROM kpi_studio_definition_source
      WHERE definition_id IN (${ids.map(() => '?').join(',')}) AND active_status = 1
      ORDER BY read_order, created_at`,
    ids,
  );
  for (const row of rows as any[]) {
    const list = result.get(String(row.definition_id));
    if (!list) continue;
    const sourceId = String(row.data_source_id);
    if (!list.includes(sourceId)) list.push(sourceId);
  }
  return result;
}

/**
 * Retires a definition from a date. Never a hard delete: the scores already computed under it
 * have to remain explainable, and a deleted definition makes its own past output unattributable.
 */
export async function retireDefinition(id: string, effectiveTo?: string) {
  await requireStudioTables();
  const endDate = effectiveTo || new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(endDate)) throw new Error('End date must be YYYY-MM-DD');

  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE kpi_studio_definition
        SET effective_to = ?, active_status = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [endDate, id],
  );
  if (!result.affectedRows) throw new Error('Definition not found');
  return { id, effective_to: endDate };
}

/**
 * How many employees a definition currently applies to.
 *
 * Shown before an edit is confirmed, because "change the AHT target on this process" and "change
 * the AHT target for 220 people" are the same action described two ways, and only the second one
 * tells the person clicking Save what they are about to do.
 */
export async function getDefinitionCoverage(id: string) {
  if (!(await getStudioCapability()).tables) return { employee_count: 0, sample: [] };

  const [defRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, designation_id, employee_id FROM kpi_studio_definition WHERE id = ? LIMIT 1`,
    [id],
  );
  const definition = (defRows as any[])[0];
  if (!definition) return { employee_count: 0, sample: [] };

  const where: string[] = ['e.active_status = 1'];
  const params: unknown[] = [];
  if (definition.employee_id) { where.push('e.id = ?'); params.push(definition.employee_id); }
  if (definition.branch_id) { where.push('e.branch_id = ?'); params.push(definition.branch_id); }
  if (definition.process_id) { where.push('e.process_id = ?'); params.push(definition.process_id); }
  if (definition.designation_id) { where.push('e.designation_id = ?'); params.push(definition.designation_id); }

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM employees e WHERE ${where.join(' AND ')}`,
    params,
  );
  const [sampleRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name
       FROM employees e WHERE ${where.join(' AND ')}
      ORDER BY e.employee_code LIMIT 10`,
    params,
  );

  return { employee_count: Number((countRows as any[])[0]?.n ?? 0), sample: sampleRows };
}

/**
 * The winning Studio definitions for one employee, as of a date. This is what the resolver in
 * kpi-master.service.ts layers on top of its kpi_master_config result.
 *
 * Candidate rows are narrowed in SQL to those whose scope could possibly match (so a 40-process
 * organisation does not load every definition), then the precedence rule is applied in
 * TypeScript by pickWinningDefinitions, which is unit-tested exhaustively. Splitting it this way
 * keeps the rule readable and keeps it in one place.
 */
export async function resolveStudioForEmployee(
  employeeId: string,
  asOf?: string,
): Promise<ResolvedStudioKpi[]> {
  if (!(await getStudioCapability()).tables) return [];

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, process_id, designation_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const employee = (empRows as any[])[0] as EmployeeOrgContext | undefined;
  if (!employee) return [];

  const onDate = asOf && ISO_DATE.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, metric_id, branch_id, process_id, designation_id, employee_id,
            data_source_id, formula_expression, aggregation_method, scoring_type,
            target_value, min_threshold, max_achievement, weightage, effective_from
       FROM kpi_studio_definition
      WHERE active_status = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
        AND (employee_id = ?
             OR (employee_id IS NULL
                 AND (branch_id IS NULL      OR branch_id = ?)
                 AND (process_id IS NULL     OR process_id = ?)
                 AND (designation_id IS NULL OR designation_id = ?)))`,
    [
      onDate, onDate, employeeId,
      employee.branch_id, employee.process_id, employee.designation_id,
    ],
  );

  return pickWinningDefinitions(rows as any[], employee).map(({ definition, tier, label }) => ({
    definition_id: String(definition.id),
    metric_id: String(definition.metric_id),
    data_source_id: definition.data_source_id ?? null,
    formula_expression: definition.formula_expression ?? null,
    aggregation_method: definition.aggregation_method ?? null,
    scoring_type: definition.scoring_type ?? null,
    target_value: definition.target_value === null || definition.target_value === undefined
      ? null
      : Number(definition.target_value),
    min_threshold: definition.min_threshold === null || definition.min_threshold === undefined
      ? null
      : Number(definition.min_threshold),
    max_achievement: Number(definition.max_achievement ?? 120),
    weightage: Number(definition.weightage ?? 100),
    resolved_scope: label,
    tier,
  }));
}

// ─── Building a new KPI ──────────────────────────────────────────────────────────────────────

const METRIC_CATEGORIES = ['operations', 'quality', 'sales', 'hr', 'custom'] as const;
const METRIC_FAMILIES = ['operations', 'quality', 'performance', 'custom'] as const;

/**
 * Creates a KPI that does not exist yet — the "build a new KPI" half of the request.
 *
 * Writes to kpi_metric_master, the same catalogue every existing KPI lives in, so a
 * Studio-created KPI is not a second-class citizen: it appears in the leaderboard, the target
 * matrix and the metric pickers immediately, with no code change.
 */
export async function createMetric(
  input: {
    metric_code: string;
    metric_name: string;
    category?: string;
    family?: string;
    unit?: string;
    direction?: string;
    scoring_type?: string | null;
    aggregation_method?: string | null;
    description?: string | null;
  },
) {
  const code = String(input.metric_code ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(code)) {
    throw new Error('KPI code must start with a letter, be 2-50 characters, and use only letters, numbers and underscores');
  }
  if (!input.metric_name?.trim()) throw new Error('KPI needs a name');

  const category = input.category && METRIC_CATEGORIES.includes(input.category as any) ? input.category : 'custom';
  const family = input.family && METRIC_FAMILIES.includes(input.family as any) ? input.family : 'custom';
  const direction = input.direction === 'lower_is_better' ? 'lower_is_better' : 'higher_is_better';
  const unit = String(input.unit ?? 'count').trim() || 'count';

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, active_status FROM kpi_metric_master WHERE metric_code = ? LIMIT 1`,
    [code],
  );
  if ((existing as any[]).length) {
    const row = (existing as any[])[0];
    // Reactivating beats erroring: a code somebody retired last quarter and now wants back is a
    // reasonable request, and refusing it would push them into inventing AHT_2.
    if (!row.active_status) {
      await db.execute(
        `UPDATE kpi_metric_master
            SET active_status = 1, metric_name = ?, category = ?, family = ?, unit = ?, direction = ?
          WHERE id = ?`,
        [input.metric_name.trim(), category, family, unit, direction, row.id],
      );
      return { id: String(row.id), metric_code: code, reactivated: true };
    }
    throw new Error(`A KPI with the code ${code} already exists`);
  }

  const [idRows] = await db.execute<RowDataPacket[]>(`SELECT UUID() AS id`);
  const id = String((idRows as any[])[0].id);

  await db.execute(
    `INSERT INTO kpi_metric_master
       (id, metric_code, metric_name, family, category, unit, direction, scoring_type, aggregation_method, active_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      code,
      input.metric_name.trim(),
      family,
      category,
      unit,
      direction,
      input.scoring_type?.trim() || null,
      input.aggregation_method?.trim() || 'average',
    ],
  );

  return { id, metric_code: code, reactivated: false };
}

// ─── Pickers ─────────────────────────────────────────────────────────────────────────────────

/**
 * Everything the scope pickers need, in one round trip.
 *
 * Processes carry their branch_id so the UI can narrow the process list once a branch is chosen
 * without another request — the difference between a picker that feels instant and one that
 * spins on every selection.
 */
export async function getScopeOptions() {
  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name AS name, branch_code AS code
       FROM branch_master WHERE active_status = 1 ORDER BY branch_name`,
  );
  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_name AS name, process_code AS code, branch_id
       FROM process_master WHERE active_status = 1 ORDER BY process_name`,
  );
  const [designations] = await db.execute<RowDataPacket[]>(
    `SELECT id, designation_name AS name, designation_code AS code
       FROM designation_master WHERE active_status = 1 ORDER BY designation_name`,
  );
  return { branches, processes, designations };
}

/**
 * Employees matching a scope, for the employee picker.
 *
 * Requires a search term or a scope filter, and caps at 50. An unfiltered list of 1,121
 * employees is not a picker, it is a scroll, and it makes the page slow for no benefit.
 */
export async function findEmployeesForScope(filters: {
  search?: string;
  branch_id?: string;
  process_id?: string;
  designation_id?: string;
}) {
  const where: string[] = ['e.active_status = 1'];
  const params: unknown[] = [];

  if (filters.branch_id) { where.push('e.branch_id = ?'); params.push(filters.branch_id); }
  if (filters.process_id) { where.push('e.process_id = ?'); params.push(filters.process_id); }
  if (filters.designation_id) { where.push('e.designation_id = ?'); params.push(filters.designation_id); }

  const search = filters.search?.trim();
  if (search) {
    where.push('(e.employee_code LIKE ? OR e.full_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (!search && !filters.branch_id && !filters.process_id && !filters.designation_id) {
    return [];
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.branch_id, e.process_id, e.designation_id,
            p.process_name, g.designation_name
       FROM employees e
       LEFT JOIN process_master p     ON p.id = e.process_id
       LEFT JOIN designation_master g ON g.id = e.designation_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.employee_code
      LIMIT 50`,
    params,
  );
  return rows;
}

/** The function catalogue, straight from the engine so the two cannot disagree. */
export function getFormulaHelp() {
  return {
    functions: listFormulaFunctions(),
    aggregations: AGGREGATION_METHODS,
    notes: [
      'A field with no value for the day produces no result, rather than zero. Use COALESCE(field, 0) if a missing value really should count as zero.',
      'Division by zero produces no result rather than an error. SAFE_DIV(a, b) makes that intent explicit.',
      'Percentages are easiest with PCT(part, whole).',
    ],
  };
}
