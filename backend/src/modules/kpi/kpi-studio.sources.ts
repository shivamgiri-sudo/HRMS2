/**
 * KPI Studio — data source readers.
 *
 * Turns a configured data source plus a list of named fields into actual numbers per employee per
 * day, which is what kpi-formula.engine.ts then evaluates. Three routes, because three are what
 * the business actually has:
 *
 *   local_query           — a table inside mas_hrms (attendance_daily_record, apr, ...)
 *   integration_connector — an external MySQL/SQL Server already configured in integration_config,
 *                           reached through external-db.service.ts so credentials stay
 *                           AES-256-GCM encrypted there and are never copied into Studio config
 *   manual / upload       — figures typed in or loaded from a spreadsheet, stored in
 *                           kpi_studio_manual_value
 *
 * There is deliberately no Google Sheets route. connectGoogleSheet() in
 * quality-aggregator.service.ts is a stub that always returns "not implemented", the googleapis
 * package is not installed, and the existing UI collects a service-account JSON that goes
 * nowhere. A Sheet is exported to CSV and ingested through the upload route, which works today.
 * Shipping a Sheets option that silently fails would be worse than not offering one.
 *
 * ── SQL injection surface, and how it is closed ─────────────────────────────────────────────
 * Table and column names cannot be bound parameters, so a configurable source unavoidably
 * interpolates identifiers into SQL. Every one of them goes through assertSafeIdentifier (the
 * same guard databaseAdapter.ts uses), and field expressions are BUILT server-side in
 * saveSourceField from a validated column plus a whitelisted aggregate — the client never
 * supplies a SQL fragment. Values are always bound.
 *
 * ── Reads are read-only ────────────────────────────────────────────────────────────────────
 * External sources are other teams' production databases. Every statement this module issues is
 * a SELECT, and connector queries additionally inherit the read-only enforcement in
 * external-db.service.ts's pools. Nothing here writes to a source.
 */

import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { Pool as MysqlPool } from 'mysql2/promise';
import { assertSafeIdentifier } from '../integration-hub/adapters/databaseAdapter.js';
import { getPoolForKey } from '../external-db/external-db.service.js';
import { fetchSheetCsv, parseSheetDate, parseSheetNumber } from './kpi-studio.gsheet.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SourceField {
  field_name: string;
  source_column?: string | null;
  aggregate_fn?: string | null;
  source_expression?: string | null;
}

export interface DataSourceConfig {
  id: string;
  source_code: string;
  source_name: string;
  source_type: string;
  integration_key?: string | null;
  source_object?: string | null;
  employee_key_column?: string | null;
  employee_key_kind?: string | null;
  date_column?: string | null;
  /**
   * Non-secret connection extras. For a google_sheet_csv source this carries `csv_url` (the
   * published link) and optionally `tab`. mysql2 returns a JSON column already parsed, but a string
   * arrives on older drivers, so callers normalise via readConfigJson().
   */
  config_json?: Record<string, unknown> | string | null;
}

/** JSON columns arrive parsed or as text depending on driver version. Normalise once, here. */
export function readConfigJson(source: DataSourceConfig): Record<string, unknown> {
  const raw = source.config_json;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

/**
 * field values for one employee on one date. A field present with a null value means the source
 * was read and had nothing; a field ABSENT means it was never fetched. The formula engine treats
 * those two differently on purpose, so this distinction is preserved all the way down.
 */
export type DailyFieldValues = Map<string, Map<string, number | null>>;

export interface SourceReadResult {
  /** Keyed by `${employeeId}|${YYYY-MM-DD}`. */
  values: DailyFieldValues;
  rowsRead: number;
  /** Populated when the source could not be read at all. Never silently swallowed. */
  error?: string;
}

const dayKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return raw.getTime();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateString(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  }
  const text = String(raw);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Builds the SELECT list from configured fields.
 *
 * source_expression is preferred when present (it was built server-side by saveSourceField), and
 * a bare column is re-validated before falling back — belt and braces, because a row could have
 * been written by an older version of that function or edited directly in the database.
 */
function buildFieldSelect(fields: readonly SourceField[]): { sql: string; names: string[] } {
  const parts: string[] = [];
  const names: string[] = [];

  for (const field of fields) {
    const alias = assertSafeIdentifier(field.field_name, 'field name');
    let expression = field.source_expression?.trim();

    if (!expression) {
      if (!field.source_column) continue;
      const column = assertSafeIdentifier(field.source_column, 'source column');
      const aggregate = String(field.aggregate_fn ?? 'SUM').toUpperCase();
      const allowed = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'NONE'];
      if (!allowed.includes(aggregate)) {
        throw new Error(`Unsupported aggregate "${aggregate}" on field ${alias}`);
      }
      expression = aggregate === 'NONE' ? `\`${column}\`` : `${aggregate}(\`${column}\`)`;
    } else {
      // An expression from the database is trusted only as far as its shape: aggregate over a
      // single backticked or bare identifier. Anything else is rejected rather than executed.
      const shape = /^(?:(SUM|AVG|COUNT|MIN|MAX)\s*\(\s*`?[A-Za-z_][A-Za-z0-9_]*`?\s*\)|`?[A-Za-z_][A-Za-z0-9_]*`?)$/i;
      if (!shape.test(expression)) {
        throw new Error(`Field ${alias} has an unsupported source expression`);
      }
    }

    parts.push(`${expression} AS \`${alias}\``);
    names.push(alias);
  }

  if (!parts.length) throw new Error('This data source has no usable fields configured yet');
  return { sql: parts.join(', '), names };
}

/**
 * Maps employee codes back to ids.
 *
 * Needed because operational systems key on an agent code, not on this system's UUID. Done as one
 * batched lookup rather than per row: a month of dialer data for 300 agents is ~9,000 rows and a
 * per-row lookup would be 9,000 queries.
 */
async function buildEmployeeCodeMap(codes: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map((code) => String(code).trim()).filter(Boolean))];
  if (!unique.length) return new Map();

  const map = new Map<string, string>();
  const CHUNK = 500;
  for (let index = 0; index < unique.length; index += CHUNK) {
    const chunk = unique.slice(index, index + CHUNK);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code FROM employees WHERE employee_code IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    for (const row of rows as any[]) {
      // Upper-cased so 'mas60618' from a spreadsheet matches 'MAS60618' in this system. Agent
      // codes are typed by humans into other teams' tools; case is not signal.
      map.set(String(row.employee_code).toUpperCase(), String(row.id));
    }
  }
  return map;
}

// ─── Manual / uploaded values ────────────────────────────────────────────────────────────────

async function readManualValues(
  fields: readonly SourceField[],
  employeeIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): Promise<SourceReadResult> {
  const fieldNames = fields.map((field) => field.field_name);
  if (!fieldNames.length || !employeeIds.length) return { values: new Map(), rowsRead: 0 };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, field_name, value_date, field_value
       FROM kpi_studio_manual_value
      WHERE employee_id IN (${employeeIds.map(() => '?').join(',')})
        AND field_name IN (${fieldNames.map(() => '?').join(',')})
        AND value_date BETWEEN ? AND ?
        AND superseded_by_batch_id IS NULL`,
    [...employeeIds, ...fieldNames, dateFrom, dateTo],
  );

  const values: DailyFieldValues = new Map();
  for (const row of rows as any[]) {
    const date = toDateString(row.value_date);
    if (!date) continue;
    const key = dayKey(String(row.employee_id), date);
    if (!values.has(key)) values.set(key, new Map());
    values.get(key)!.set(String(row.field_name), toNumberOrNull(row.field_value));
  }

  return { values, rowsRead: (rows as any[]).length };
}

// ─── Query-backed sources ────────────────────────────────────────────────────────────────────

interface QueryPlan {
  sql: string;
  params: unknown[];
  fieldNames: string[];
  keyKind: string;
}

function buildQueryPlan(
  source: DataSourceConfig,
  fields: readonly SourceField[],
  keys: readonly string[],
  dateFrom: string,
  dateTo: string,
): QueryPlan {
  if (!source.source_object) throw new Error(`Data source ${source.source_code} has no table configured`);
  if (!source.employee_key_column) throw new Error(`Data source ${source.source_code} has no employee column configured`);
  if (!source.date_column) throw new Error(`Data source ${source.source_code} has no date column configured`);

  const table = assertSafeIdentifier(source.source_object, 'source table');
  const keyColumn = assertSafeIdentifier(source.employee_key_column, 'employee column');
  const dateColumn = assertSafeIdentifier(source.date_column, 'date column');
  const { sql: fieldSelect, names } = buildFieldSelect(fields);

  // Backtick each dotted part separately: a schema-qualified `db.table` must become
  // `` `db`.`table` ``, not `` `db.table` `` which MySQL reads as one table with a dot in its name.
  const quotedTable = table.split('.').map((part) => `\`${part}\``).join('.');

  // GROUP BY employee and day so an aggregate is per employee per day regardless of how many
  // source rows underlie it — the grain every KPI in this system is stored at.
  const sql = `
    SELECT \`${keyColumn}\` AS __employee_key,
           DATE(\`${dateColumn}\`) AS __score_date,
           ${fieldSelect}
      FROM ${quotedTable}
     WHERE \`${dateColumn}\` >= ? AND \`${dateColumn}\` < DATE_ADD(?, INTERVAL 1 DAY)
       AND \`${keyColumn}\` IN (${keys.map(() => '?').join(',')})
     GROUP BY \`${keyColumn}\`, DATE(\`${dateColumn}\`)
  `;

  return {
    sql,
    params: [dateFrom, dateTo, ...keys],
    fieldNames: names,
    keyKind: source.employee_key_kind ?? 'employee_code',
  };
}

function collectQueryRows(
  rows: readonly Record<string, unknown>[],
  fieldNames: readonly string[],
  resolveEmployeeId: (key: string) => string | undefined,
): DailyFieldValues {
  const values: DailyFieldValues = new Map();

  for (const row of rows) {
    const rawKey = row.__employee_key;
    if (rawKey === null || rawKey === undefined) continue;
    const employeeId = resolveEmployeeId(String(rawKey));
    // A source row for somebody this system does not know is skipped, not guessed at. Attributing
    // it to the wrong person would be worse than losing it, and the count difference surfaces in
    // rowsRead versus the values actually mapped.
    if (!employeeId) continue;

    const date = toDateString(row.__score_date);
    if (!date) continue;

    const key = dayKey(employeeId, date);
    if (!values.has(key)) values.set(key, new Map());
    const bucket = values.get(key)!;
    for (const name of fieldNames) {
      bucket.set(name, toNumberOrNull(row[name]));
    }
  }

  return values;
}

async function readLocalQuery(
  source: DataSourceConfig,
  fields: readonly SourceField[],
  employeeIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): Promise<SourceReadResult> {
  const keyKind = source.employee_key_kind ?? 'employee_code';

  // The query is keyed on whatever the source table stores, so codes are resolved BEFORE the
  // query and mapped back after.
  let keys: string[];
  let codeToId: Map<string, string> | null = null;
  if (keyKind === 'employee_id') {
    keys = [...employeeIds];
  } else {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code FROM employees WHERE id IN (${employeeIds.map(() => '?').join(',')})`,
      [...employeeIds],
    );
    codeToId = new Map();
    keys = [];
    for (const row of rows as any[]) {
      keys.push(String(row.employee_code));
      codeToId.set(String(row.employee_code).toUpperCase(), String(row.id));
    }
  }

  if (!keys.length) return { values: new Map(), rowsRead: 0 };

  const plan = buildQueryPlan(source, fields, keys, dateFrom, dateTo);
  const [rows] = await db.execute<RowDataPacket[]>(plan.sql, plan.params);

  const values = collectQueryRows(
    rows as any[],
    plan.fieldNames,
    (key) => (keyKind === 'employee_id' ? key : codeToId?.get(key.toUpperCase())),
  );

  return { values, rowsRead: (rows as any[]).length };
}

async function readConnectorQuery(
  source: DataSourceConfig,
  fields: readonly SourceField[],
  employeeIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): Promise<SourceReadResult> {
  if (!source.integration_key) {
    return { values: new Map(), rowsRead: 0, error: `Data source ${source.source_code} has no integration key` };
  }

  // An external source almost always keys on an agent code, so resolve this system's ids to codes
  // before querying it.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code FROM employees WHERE id IN (${employeeIds.map(() => '?').join(',')})`,
    [...employeeIds],
  );
  const codeToId = new Map<string, string>();
  const keys: string[] = [];
  for (const row of empRows as any[]) {
    keys.push(String(row.employee_code));
    codeToId.set(String(row.employee_code).toUpperCase(), String(row.id));
  }
  if (!keys.length) return { values: new Map(), rowsRead: 0 };

  const plan = buildQueryPlan(source, fields, keys, dateFrom, dateTo);

  try {
    const pool = await getPoolForKey(source.integration_key);
    // Only MySQL-shaped connectors are supported here. The SQL built above uses backticks and
    // DATE_ADD, which SQL Server rejects; claiming to support MSSQL and then emitting MySQL syntax
    // would fail at query time with a confusing error instead of at configuration time with a
    // clear one.
    if (typeof (pool as MysqlPool).execute !== 'function') {
      return {
        values: new Map(),
        rowsRead: 0,
        error: `Connector ${source.integration_key} is not a MySQL source. Only MySQL connectors can back a KPI data source today.`,
      };
    }
    // Untyped execute: the pool is resolved at runtime from integration_config and mysql2's
    // generic overloads do not accept a RowDataPacket[] parameter on the union type getPoolForKey
    // returns. The rows are shaped by collectQueryRows immediately below, which validates each
    // field it reads, so the cast buys nothing that is not re-checked.
    const [rows] = await (pool as MysqlPool).query(plan.sql, plan.params);
    const rowArray = (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
    const values = collectQueryRows(rowArray, plan.fieldNames, (key) => codeToId.get(key.toUpperCase()));
    return { values, rowsRead: rowArray.length };
  } catch (error) {
    // Returned rather than thrown. One unreachable external system must not fail the whole
    // computation run for every other KPI, but it also must not look like "no data" — the caller
    // records this against the affected metrics.
    return {
      values: new Map(),
      rowsRead: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── Google Sheet (published CSV) ─────────────────────────────────────────────────────────────

/**
 * Reads a live published-CSV Google Sheet.
 *
 * Unlike a query-backed source, a sheet cannot be filtered server-side — the whole published range
 * arrives and is narrowed here. That is fine at the scale a hand-maintained sheet reaches, and it is
 * why the fetch is cached per run (see sheetCache) rather than repeated per employee.
 *
 * Aggregation is applied in TypeScript because a sheet may legitimately carry several rows for one
 * employee on one day — one row per audited call, say — and the field's aggregate_fn is what decides
 * whether that becomes a sum, an average or a count.
 */
async function readGoogleSheet(
  source: DataSourceConfig,
  fields: readonly SourceField[],
  employeeIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): Promise<SourceReadResult> {
  const config = readConfigJson(source);
  const csvUrl = typeof config.csv_url === 'string' ? config.csv_url : '';
  if (!csvUrl) {
    return { values: new Map(), rowsRead: 0, error: `Sheet source ${source.source_code} has no published CSV link` };
  }
  if (!source.employee_key_column) {
    return { values: new Map(), rowsRead: 0, error: `Sheet source ${source.source_code} does not say which column holds the employee code` };
  }
  if (!source.date_column) {
    return { values: new Map(), rowsRead: 0, error: `Sheet source ${source.source_code} does not say which column holds the date` };
  }

  const sheet = await fetchSheetCsv(csvUrl);
  if (sheet.error) return { values: new Map(), rowsRead: 0, error: sheet.error };

  // Header names in a sheet are typed by humans, so match them case- and spacing-insensitively.
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const headerByNormalised = new Map(sheet.headers.map((header) => [normalise(header), header]));
  const resolveHeader = (name: string) => headerByNormalised.get(normalise(name));

  const employeeHeader = resolveHeader(source.employee_key_column);
  const dateHeader = resolveHeader(source.date_column);
  if (!employeeHeader) {
    return { values: new Map(), rowsRead: 0, error: `The sheet has no column called "${source.employee_key_column}". It has: ${sheet.headers.join(', ')}` };
  }
  if (!dateHeader) {
    return { values: new Map(), rowsRead: 0, error: `The sheet has no column called "${source.date_column}". It has: ${sheet.headers.join(', ')}` };
  }

  // A field's sheet column is its source_column when set, otherwise its own name.
  const fieldHeaders = new Map<string, string>();
  const missingFields: string[] = [];
  for (const field of fields) {
    const header = resolveHeader(field.source_column || field.field_name);
    if (header) fieldHeaders.set(field.field_name, header);
    else missingFields.push(field.field_name);
  }
  if (!fieldHeaders.size) {
    return {
      values: new Map(),
      rowsRead: 0,
      error: `None of this source's fields (${fields.map((f) => f.field_name).join(', ')}) match a column in the sheet. It has: ${sheet.headers.join(', ')}`,
    };
  }

  // Employee codes are what a sheet holds; map to ids for the caller.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code FROM employees WHERE id IN (${employeeIds.map(() => '?').join(',')})`,
    [...employeeIds],
  );
  const idByCode = new Map<string, string>();
  for (const row of empRows as any[]) {
    idByCode.set(String(row.employee_code).toUpperCase(), String(row.id));
  }

  const aggregateByField = new Map(
    fields.map((field) => [field.field_name, String(field.aggregate_fn ?? 'SUM').toUpperCase()]),
  );

  // Collected first, aggregated after: a per-day bucket may receive many sheet rows.
  const collected = new Map<string, Map<string, number[]>>();
  let matchedRows = 0;

  for (const record of sheet.rows) {
    const code = record[employeeHeader];
    if (!code) continue;
    const employeeId = idByCode.get(code.trim().toUpperCase());
    // A sheet row for somebody outside the requested set, or unknown to this system, is skipped
    // rather than guessed at.
    if (!employeeId) continue;

    const date = parseSheetDate(record[dateHeader]);
    if (!date) continue;
    if (date < dateFrom || date > dateTo) continue;

    matchedRows += 1;
    const key = dayKey(employeeId, date);
    if (!collected.has(key)) collected.set(key, new Map());
    const bucket = collected.get(key)!;

    for (const [fieldName, header] of fieldHeaders) {
      const parsed = parseSheetNumber(record[header]);
      if (parsed === null) continue;
      if (!bucket.has(fieldName)) bucket.set(fieldName, []);
      bucket.get(fieldName)!.push(parsed);
    }
  }

  const values: DailyFieldValues = new Map();
  for (const [key, bucket] of collected) {
    const dayValues = new Map<string, number | null>();
    // Every declared field is present in the output, null where the sheet had nothing. Omitting it
    // would make a blank cell look like an unwired field to the formula engine, which treats those
    // differently on purpose.
    for (const field of fields) {
      const samples = bucket.get(field.field_name);
      if (!samples || !samples.length) {
        dayValues.set(field.field_name, null);
        continue;
      }
      const aggregate = aggregateByField.get(field.field_name) ?? 'SUM';
      dayValues.set(field.field_name, aggregateSamples(samples, aggregate));
    }
    values.set(key, dayValues);
  }

  return {
    values,
    rowsRead: matchedRows,
    // Not an error: the run continues. But a field whose column has vanished from the sheet is the
    // single most likely cause of a KPI silently going empty, so it is reported.
    error: missingFields.length
      ? `These fields have no matching column in the sheet and were skipped: ${missingFields.join(', ')}`
      : undefined,
  };
}

function aggregateSamples(samples: readonly number[], aggregate: string): number | null {
  if (!samples.length) return null;
  switch (aggregate) {
    case 'AVG':
      return samples.reduce((total, value) => total + value, 0) / samples.length;
    case 'COUNT':
      return samples.length;
    case 'MIN':
      return Math.min(...samples);
    case 'MAX':
      return Math.max(...samples);
    case 'NONE':
      // "As-is" means the value for the day, so the last row wins rather than being summed.
      return samples[samples.length - 1];
    default:
      return samples.reduce((total, value) => total + value, 0);
  }
}

/**
 * Reads one data source for a set of employees over a date range.
 */
export async function readSourceValues(
  source: DataSourceConfig,
  fields: readonly SourceField[],
  employeeIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): Promise<SourceReadResult> {
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo)) {
    throw new Error('Dates must be YYYY-MM-DD');
  }
  if (!employeeIds.length) return { values: new Map(), rowsRead: 0 };

  try {
    switch (source.source_type) {
      case 'manual':
      case 'upload':
        return await readManualValues(fields, employeeIds, dateFrom, dateTo);
      case 'local_query':
        return await readLocalQuery(source, fields, employeeIds, dateFrom, dateTo);
      case 'integration_connector':
        return await readConnectorQuery(source, fields, employeeIds, dateFrom, dateTo);
      case 'google_sheet_csv':
        return await readGoogleSheet(source, fields, employeeIds, dateFrom, dateTo);
      default:
        return { values: new Map(), rowsRead: 0, error: `Unknown source type "${source.source_type}"` };
    }
  } catch (error) {
    return { values: new Map(), rowsRead: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

// ─── Multi-source merge ──────────────────────────────────────────────────────────────────────

export interface MergedSourceRead {
  values: DailyFieldValues;
  rowsRead: number;
  /** One entry per source that could not be read. The run continues; these are reported. */
  failures: Array<{ source_code: string; error: string }>;
}

/**
 * Reads SEVERAL sources for the same employees and date range, and merges them into one field map
 * per employee per day.
 *
 * This is what lets a single KPI span systems — `PCT(audited_passed, total_calls)` where the
 * numerator is maintained in a QA Google Sheet and the denominator lives in the dialer database.
 * Each source is read independently and the per-day buckets are combined, so by the time the formula
 * runs it sees a flat set of named numbers and does not know or care that they came from three
 * places.
 *
 * Field names are required to be unique across a definition's sources, enforced when the definition
 * is saved. If a duplicate reaches here anyway, the FIRST source in read order wins and the loser is
 * reported — deterministic, and visible, rather than depending on which query returned first.
 */
export async function readMergedSourceValues(
  sources: ReadonlyArray<{ source: DataSourceConfig; fields: SourceField[] }>,
  employeeIds: readonly string[],
  dateFrom: string,
  dateTo: string,
): Promise<MergedSourceRead> {
  const values: DailyFieldValues = new Map();
  const failures: Array<{ source_code: string; error: string }> = [];
  let rowsRead = 0;
  const claimedBy = new Map<string, string>();

  for (const entry of sources) {
    if (!entry.fields.length) continue;

    const read = await readSourceValues(entry.source, entry.fields, employeeIds, dateFrom, dateTo);

    // A sheet read can return values AND a warning (a field whose column vanished), so the failure
    // is recorded without discarding what did come back.
    if (read.error) {
      failures.push({ source_code: entry.source.source_code, error: read.error });
    }
    rowsRead += read.rowsRead;

    for (const [dayIdentifier, fieldValues] of read.values) {
      if (!values.has(dayIdentifier)) values.set(dayIdentifier, new Map());
      const target = values.get(dayIdentifier)!;
      for (const [fieldName, value] of fieldValues) {
        const owner = claimedBy.get(fieldName);
        if (owner && owner !== entry.source.source_code) {
          // Reported once per colliding field, not once per employee per day.
          if (!failures.some((failure) => failure.error.includes(`"${fieldName}"`))) {
            failures.push({
              source_code: entry.source.source_code,
              error: `Field "${fieldName}" is also supplied by ${owner}; ${owner} was used. Rename one of them.`,
            });
          }
          continue;
        }
        claimedBy.set(fieldName, entry.source.source_code);
        target.set(fieldName, value);
      }
    }
  }

  return { values, rowsRead, failures };
}

/**
 * Lists the columns a source table actually has, so the field builder can offer them instead of
 * asking somebody to type a column name and find out later whether it was right.
 */
/**
 * A sheet's "columns" are its header row, which is only knowable by fetching it.
 *
 * Fetching doubles as a live connectivity check, so the field builder tells an administrator
 * immediately whether the published link works — rather than at 2am when the first computation runs.
 *
 * CSV carries no types, so numeric-ness is inferred from the data: a column is offered as a measure
 * when the MAJORITY of its non-blank cells parse as numbers. Majority rather than all, because one
 * stray "N/A" in six months of rows should not hide an otherwise usable column.
 */
async function introspectSheetColumns(
  source: DataSourceConfig,
): Promise<Array<{ column_name: string; data_type: string; is_numeric: boolean; is_date: boolean }>> {
  const config = readConfigJson(source);
  const csvUrl = typeof config.csv_url === 'string' ? config.csv_url : '';
  if (!csvUrl) return [];

  const sheet = await fetchSheetCsv(csvUrl);
  if (sheet.error || !sheet.headers.length) return [];

  return sheet.headers.map((header) => {
    const samples = sheet.rows
      .slice(0, 200)
      .map((row) => row[header])
      .filter((cell) => cell !== undefined && cell !== '');
    const numeric = samples.filter((cell) => parseSheetNumber(cell) !== null).length;
    const dates = samples.filter((cell) => parseSheetDate(cell) !== null).length;
    const majority = samples.length ? samples.length / 2 : 0;
    // Dates are checked first: an ISO date parses as neither a plain number nor a duration, but a
    // serial-number date would otherwise be offered as a measure.
    const isDate = samples.length > 0 && dates > majority;
    return {
      column_name: header,
      data_type: isDate ? 'date' : numeric > majority ? 'number' : 'text',
      is_numeric: samples.length > 0 && numeric > majority && !isDate,
      is_date: isDate,
    };
  });
}

export async function introspectSourceColumns(source: DataSourceConfig): Promise<
  Array<{ column_name: string; data_type: string; is_numeric: boolean; is_date: boolean }>
> {
  if (source.source_type === 'google_sheet_csv') return introspectSheetColumns(source);
  if (!source.source_object) return [];
  const table = assertSafeIdentifier(source.source_object, 'source table');
  const parts = table.split('.');
  const tableName = parts[parts.length - 1];
  const schemaName = parts.length > 1 ? parts[0] : null;

  const NUMERIC = ['int', 'bigint', 'smallint', 'tinyint', 'mediumint', 'decimal', 'float', 'double', 'numeric'];
  const DATE = ['date', 'datetime', 'timestamp'];

  const mapRows = (rows: readonly Record<string, unknown>[]) =>
    rows.map((row) => {
      const dataType = String(row.DATA_TYPE ?? row.data_type ?? '').toLowerCase();
      return {
        column_name: String(row.COLUMN_NAME ?? row.column_name ?? ''),
        data_type: dataType,
        is_numeric: NUMERIC.includes(dataType),
        is_date: DATE.includes(dataType),
      };
    });

  if (source.source_type === 'integration_connector' && source.integration_key) {
    try {
      const pool = await getPoolForKey(source.integration_key);
      if (typeof (pool as MysqlPool).execute !== 'function') return [];
      const [rows] = await (pool as MysqlPool).execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME, DATA_TYPE
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = ? ${schemaName ? 'AND TABLE_SCHEMA = ?' : ''}
          ORDER BY ORDINAL_POSITION`,
        schemaName ? [tableName, schemaName] : [tableName],
      );
      return mapRows(rows as any[]);
    } catch {
      // An unreachable connector yields an empty column list, and the UI says the source could
      // not be inspected. Better than a 500 on a page whose other sources are fine.
      return [];
    }
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ${schemaName ? '?' : 'DATABASE()'} AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    schemaName ? [schemaName, tableName] : [tableName],
  );
  return mapRows(rows as any[]);
}

// ─── Spreadsheet ingestion ───────────────────────────────────────────────────────────────────

export interface ParsedUpload {
  headers: string[];
  rows: Array<Record<string, unknown>>;
}

/**
 * Parses an uploaded CSV or XLSX buffer.
 *
 * Uses the xlsx package, already a backend dependency, rather than the hand-rolled
 * `split('\n').split(',')` in quality-aggregator.service.ts. That parser cannot handle a quoted
 * comma, which is guaranteed to appear the first time a process name contains one, and it rejects
 * .xlsx outright — telling users to re-save as CSV is a workaround for a library that is already
 * installed.
 */
export async function parseUploadBuffer(buffer: Buffer, fileName: string): Promise<ParsedUpload> {
  const xlsx = await import('xlsx');
  const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error(`${fileName} has no sheets`);

  const sheet = workbook.Sheets[sheetName];
  // defval null, not undefined: a blank cell must survive as an explicit "no value" so the
  // formula engine can tell it apart from a column that was never mapped.
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  const headerRow = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false })[0] ?? [];
  const headers = (headerRow as unknown[]).map((cell) => String(cell ?? '').trim()).filter(Boolean);

  return { headers, rows };
}

/**
 * Suggests which uploaded column feeds which configured field.
 *
 * Same normalise-then-match approach as quality-data-mapper.ts's detectColumnMappings — lowercase
 * and strip everything non-alphanumeric, so "Talk Time (sec)" matches a field named
 * talk_time_sec. That function is sound; it is only bound to a fixed set of quality columns, so
 * the technique is reused here against whatever fields the source declares.
 */
export function suggestColumnMapping(
  headers: readonly string[],
  fields: readonly { field_name: string; display_name?: string | null }[],
): Record<string, string | null> {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNormalised = new Map<string, string>();
  for (const header of headers) byNormalised.set(normalise(header), header);

  const mapping: Record<string, string | null> = {};
  for (const field of fields) {
    const candidates = [field.field_name, field.display_name ?? ''].filter(Boolean);
    let matched: string | null = null;
    for (const candidate of candidates) {
      const hit = byNormalised.get(normalise(candidate));
      if (hit) { matched = hit; break; }
    }
    mapping[field.field_name] = matched;
  }
  return mapping;
}

export interface UploadRowOutcome {
  rowNumber: number;
  employeeCode?: string;
  reason: string;
}

export interface CommitUploadResult {
  batch_id: string;
  total_rows: number;
  accepted_rows: number;
  rejected_rows: number;
  rejections: UploadRowOutcome[];
}

/**
 * Validates and stores uploaded rows.
 *
 * `dryRun` is the preview the UI shows before anything is written. The same code path produces the
 * preview and the commit, so what a user is shown is what they get — a separate validation path
 * would eventually disagree with the write path, and the disagreement would only appear on real
 * data.
 */
export async function commitUploadRows(options: {
  dataSourceId: string;
  fileName: string;
  employeeColumn: string;
  dateColumn: string;
  /** field_name -> uploaded column header */
  columnMapping: Record<string, string>;
  rows: ReadonlyArray<Record<string, unknown>>;
  uploadedBy?: string;
  dryRun?: boolean;
}): Promise<CommitUploadResult> {
  const { rows, columnMapping, employeeColumn, dateColumn } = options;
  const rejections: UploadRowOutcome[] = [];
  const accepted: Array<{ employeeId: string; date: string; field: string; value: number | null }> = [];

  const codes = rows
    .map((row) => (row[employeeColumn] === null || row[employeeColumn] === undefined ? '' : String(row[employeeColumn]).trim()))
    .filter(Boolean);
  const codeMap = await buildEmployeeCodeMap(codes);

  const mappedFields = Object.entries(columnMapping).filter(([, header]) => Boolean(header));
  if (!mappedFields.length) throw new Error('No columns are mapped to fields yet');

  rows.forEach((row, index) => {
    // +2 so the number matches what the user sees in their spreadsheet: row 1 is the header.
    const rowNumber = index + 2;

    const rawCode = row[employeeColumn];
    const code = rawCode === null || rawCode === undefined ? '' : String(rawCode).trim();
    if (!code) {
      rejections.push({ rowNumber, reason: 'No employee code' });
      return;
    }
    const employeeId = codeMap.get(code.toUpperCase());
    if (!employeeId) {
      rejections.push({ rowNumber, employeeCode: code, reason: `No employee with code ${code}` });
      return;
    }

    const date = toDateString(row[dateColumn]);
    if (!date) {
      rejections.push({ rowNumber, employeeCode: code, reason: `Could not read a date from "${String(row[dateColumn] ?? '')}"` });
      return;
    }
    // A future-dated figure is a typo often enough to be worth refusing, and a KPI cannot be
    // measured before it happens.
    if (date > new Date().toISOString().slice(0, 10)) {
      rejections.push({ rowNumber, employeeCode: code, reason: `Date ${date} is in the future` });
      return;
    }

    let usable = 0;
    for (const [fieldName, header] of mappedFields) {
      const raw = row[header as string];
      const value = toNumberOrNull(raw);
      // A blank cell is stored as null — a real "not measured" for that field on that day — but a
      // cell containing something non-numeric is a mistake worth reporting rather than quietly
      // discarding.
      if (value === null && raw !== null && raw !== undefined && String(raw).trim() !== '') {
        rejections.push({ rowNumber, employeeCode: code, reason: `"${String(raw)}" in ${header} is not a number` });
        continue;
      }
      accepted.push({ employeeId, date, field: fieldName, value });
      usable += 1;
    }
    if (!usable) {
      rejections.push({ rowNumber, employeeCode: code, reason: 'No usable values in this row' });
    }
  });

  const acceptedRowCount = new Set(accepted.map((entry) => `${entry.employeeId}|${entry.date}`)).size;

  if (options.dryRun) {
    return {
      batch_id: 'preview',
      total_rows: rows.length,
      accepted_rows: acceptedRowCount,
      rejected_rows: rejections.length,
      rejections: rejections.slice(0, 100),
    };
  }

  const [idRows] = await db.execute<RowDataPacket[]>(`SELECT UUID() AS id`);
  const batchId = String((idRows as any[])[0].id);

  const dates = accepted.map((entry) => entry.date).sort();

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO kpi_studio_upload_batch
         (id, data_source_id, file_name, status, period_start, period_end,
          total_rows, accepted_rows, rejected_rows, column_map_json, rejection_json, uploaded_by, committed_at)
       VALUES (?, ?, ?, 'committed', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        batchId,
        options.dataSourceId,
        options.fileName,
        dates[0] ?? null,
        dates[dates.length - 1] ?? null,
        rows.length,
        acceptedRowCount,
        rejections.length,
        JSON.stringify(columnMapping),
        JSON.stringify(rejections.slice(0, 500)),
        options.uploadedBy ?? null,
      ],
    );

    // ON DUPLICATE KEY on (employee_id, field_name, value_date): a corrected re-upload REPLACES
    // the figure it corrects. Inserting instead would double-count, which for a summed KPI
    // silently doubles somebody's score.
    const CHUNK = 200;
    for (let index = 0; index < accepted.length; index += CHUNK) {
      const chunk = accepted.slice(index, index + CHUNK);
      const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params: unknown[] = [];
      for (const entry of chunk) {
        params.push(options.dataSourceId, entry.employeeId, entry.field, entry.date, entry.value, 'upload', batchId);
      }
      await connection.execute(
        `INSERT INTO kpi_studio_manual_value
           (id, data_source_id, employee_id, field_name, value_date, field_value, entry_source, upload_batch_id)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           field_value          = VALUES(field_value),
           entry_source         = VALUES(entry_source),
           upload_batch_id      = VALUES(upload_batch_id),
           data_source_id       = VALUES(data_source_id),
           superseded_by_batch_id = NULL,
           updated_at           = CURRENT_TIMESTAMP`,
        params,
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return {
    batch_id: batchId,
    total_rows: rows.length,
    accepted_rows: acceptedRowCount,
    rejected_rows: rejections.length,
    rejections: rejections.slice(0, 100),
  };
}

/** Stores a single typed-in figure. */
export async function saveManualValue(input: {
  dataSourceId?: string | null;
  employeeId: string;
  fieldName: string;
  valueDate: string;
  value: number | null;
  note?: string | null;
  userId?: string;
}) {
  if (!ISO_DATE.test(input.valueDate)) throw new Error('Date must be YYYY-MM-DD');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.fieldName)) throw new Error('Invalid field name');

  await db.execute(
    `INSERT INTO kpi_studio_manual_value
       (id, data_source_id, employee_id, field_name, value_date, field_value, entry_source, note, created_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, 'manual', ?, ?)
     ON DUPLICATE KEY UPDATE
       field_value  = VALUES(field_value),
       entry_source = 'manual',
       note         = VALUES(note),
       created_by   = VALUES(created_by),
       superseded_by_batch_id = NULL,
       updated_at   = CURRENT_TIMESTAMP`,
    [
      input.dataSourceId ?? null,
      input.employeeId,
      input.fieldName,
      input.valueDate,
      input.value,
      input.note?.trim() || null,
      input.userId ?? null,
    ],
  );
  return { ok: true };
}
