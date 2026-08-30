//
// Column-mapping-driven parser for a WFM manual productivity upload row (requirements.md
// Requirement 17, criteria 17.4, 17.14, 17.15; the Column_Mapping mechanism itself is Phase 2's
// criteria 16.12-16.14). Pure function, no DB access -- the mapping is passed in already
// resolved (Phase 4's route loads it from `dialler_source_column_mapping` via Phase 2's
// registry), and this function only applies it to one raw row at a time.
//
// The live `apr_manual_upload` table (verified 2026-08-31: 15 columns, 0 rows) is the write
// target this parser's output feeds -- its column set is exactly the optional-field list below.

export type UploadTargetField =
  | 'employee_code'
  | 'report_date'
  | 'login_minutes'
  | 'calls_handled'
  | 'aht_seconds'
  | 'bio_minutes'
  | 'lunch_minutes'
  | 'qa_minutes'
  | 'training_minutes';

// criterion 17.4: "an accepted row to supply, at minimum, an employee code, a report date and
// login minutes" -- everything else apr_manual_upload can hold is optional.
export const MANDATORY_UPLOAD_FIELDS: readonly UploadTargetField[] = [
  'employee_code',
  'report_date',
  'login_minutes',
];

const NUMERIC_FIELDS: readonly UploadTargetField[] = [
  'login_minutes',
  'calls_handled',
  'aht_seconds',
  'bio_minutes',
  'lunch_minutes',
  'qa_minutes',
  'training_minutes',
];

export interface ParsedRow {
  employee_code: string;
  report_date: string;
  login_minutes: number;
  calls_handled?: number;
  aht_seconds?: number;
  bio_minutes?: number;
  lunch_minutes?: number;
  qa_minutes?: number;
  training_minutes?: number;
}

export type ParseResult = { ok: true; row: ParsedRow } | { ok: false; reason: string };

/**
 * Checks a Dialler_Source's declared Column_Mapping covers every mandatory Upload field
 * (criterion 17.15) before any row is parsed against it. Names every field missing, not just
 * the first.
 */
export function checkMappingCoversMandatoryFields(
  columnMappings: Record<string, string>,
): { ok: true } | { ok: false; missingFields: UploadTargetField[] } {
  const mappedTargets = new Set(Object.values(columnMappings));
  const missingFields = MANDATORY_UPLOAD_FIELDS.filter((f) => !mappedTargets.has(f));
  return missingFields.length === 0 ? { ok: true } : { ok: false, missingFields };
}

/**
 * Applies a Column_Mapping to one raw row (a header->value object, as a CSV parser would
 * produce) and returns a normalized ParsedRow, or a rejection reason naming the offending field.
 */
export function parseUploadRow(
  rawRow: Record<string, string>,
  columnMappings: Record<string, string>,
): ParseResult {
  // If two source headers map to the same target field, the later entry in columnMappings wins
  // (Object.entries iterates in insertion order, so this is deterministic, not undefined
  // behavior -- but it's worth this comment since a hand-edited mapping JSON could rely on it
  // by accident).
  const values: Partial<Record<UploadTargetField, string>> = {};
  for (const [sourceHeader, targetField] of Object.entries(columnMappings)) {
    const raw = rawRow[sourceHeader];
    // Trimmed before the blank check: an Excel cell containing only spaces must be treated as
    // blank, not as a present value -- for a numeric field, Number('   ') === 0 in JS, so
    // without this trim a visually-empty cell would silently pass as a valid login_minutes: 0
    // instead of being rejected as blank.
    const trimmed = raw?.trim();
    if (trimmed !== undefined && trimmed !== '') {
      values[targetField as UploadTargetField] = trimmed;
    }
  }

  for (const field of MANDATORY_UPLOAD_FIELDS) {
    if (values[field] === undefined) {
      return { ok: false, reason: `${field} is required but blank` };
    }
  }

  const parsedNumbers: Partial<Record<UploadTargetField, number>> = {};
  for (const field of NUMERIC_FIELDS) {
    const raw = values[field];
    if (raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { ok: false, reason: `${field} is not a valid number: "${raw}"` };
    }
    if (n < 0) {
      return { ok: false, reason: `${field} must not be negative: ${n}` };
    }
    parsedNumbers[field] = n;
  }

  const row: ParsedRow = {
    employee_code: values.employee_code!,
    report_date: values.report_date!,
    login_minutes: parsedNumbers.login_minutes!,
  };
  if (parsedNumbers.calls_handled !== undefined) row.calls_handled = parsedNumbers.calls_handled;
  if (parsedNumbers.aht_seconds !== undefined) row.aht_seconds = parsedNumbers.aht_seconds;
  if (parsedNumbers.bio_minutes !== undefined) row.bio_minutes = parsedNumbers.bio_minutes;
  if (parsedNumbers.lunch_minutes !== undefined) row.lunch_minutes = parsedNumbers.lunch_minutes;
  if (parsedNumbers.qa_minutes !== undefined) row.qa_minutes = parsedNumbers.qa_minutes;
  if (parsedNumbers.training_minutes !== undefined) row.training_minutes = parsedNumbers.training_minutes;

  return { ok: true, row };
}
