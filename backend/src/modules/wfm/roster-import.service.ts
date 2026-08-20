/**
 * Task 5: Roster Import Service — Upload & Preview
 * Parses a roster spreadsheet, runs validation, inserts preview rows.
 * No roster assignments are committed here.
 */

import * as XLSX from 'xlsx';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { analyzeHeaders } from './header-alias.service.js';
import { normalizeAssignment, NormalizerConfig } from './assignment-normalizer.service.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface BatchSummary {
  totalEmployees: number;
  totalAssignments: number;
  valid: number;
  warnings: number;
  errors: number;
  needsMapping: number;
  unassigned: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
}

// ── Internal types ───────────────────────────────────────────────────────────

interface RowEntry {
  rowNumber: number;
  employeeIdRaw: string;
  employeeNameRaw: string;
  rosterDate: string;        // YYYY-MM-DD
  rawValue: string;
  normalizedType: string;
  validationState: 'VALID' | 'WARNING' | 'ERROR';
  messages: string[];
  extraMetadata: Record<string, string>;
  /** Internal: duplicate key → index into rowEntries array */
  dupKey: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function hasApprovedLeave(employeeIdRaw: string, rosterDate: string): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM leave_request
       WHERE employee_id = ? AND status = 'approved' AND leave_date = ?
       LIMIT 1`,
      [employeeIdRaw, rosterDate]
    );
    return rows.length > 0;
  } catch {
    // If table absent or error, be permissive (no false warning)
    return true;
  }
}

// ── Main service functions ───────────────────────────────────────────────────

export async function createImportBatch(params: {
  processId: string;
  cycleId?: string;
  importMode: 'NEW' | 'UPDATE';
  fileBuffer: Buffer;
  fileName: string;
  createdBy: string;
}): Promise<{ batchId: number; summary: BatchSummary }> {
  const { processId, cycleId, importMode, fileBuffer, fileName, createdBy } = params;

  // ── Step 1: Parse file ───────────────────────────────────────────────────
  // sheets: [0] — only the first sheet is ever used, two lines down, so parsing the other
  // eleven was waste. Measured on a real 7.6 MB weekly WFM workbook (12 sheets): 2,936 ms to
  // read all sheets vs 1,154 ms for the first alone, with the same first sheet in both.
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', sheets: [0] });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  // unknown[][], not string[][]: a real spreadsheet returns numbers and Dates in these cells
  // (date headers come back as Excel serials), and the old string[][] cast made
  // header-alias.service.ts throw 'trim is not a function' on the first real file. Every read
  // below already coerces with String(...).
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];

  // ── Step 2: Detect header row ────────────────────────────────────────────
  const headerResult = analyzeHeaders(rows);
  if (headerResult.headerRowIndex === -1) {
    // statusCode 400, and the sheet is named: this is the ordinary "wrong file / wrong tab"
    // case, not a server fault. A real weekly WFM workbook was uploaded whose first tab is a
    // capacity grid with no date columns; without a statusCode the message is replaced by a
    // generic 500 in production and the uploader is told nothing they can act on.
    throw Object.assign(
      new Error(
        `Could not detect header row in sheet '${sheetName}' — the importer reads the FIRST sheet, ` +
        `and it must have a row with at least 2 date columns.`
      ),
      { statusCode: 400, code: 'ROSTER_IMPORT_NO_HEADER_ROW' }
    );
  }

  const { headerRowIndex, dateColumns, identityColumns } = headerResult;

  // ── Step 3: Insert batch record (PARSING) ────────────────────────────────
  const [batchInsert] = await db.execute<ResultSetHeader>(
    `INSERT INTO wfm_roster_import_batch
       (process_id, cycle_id, import_mode, file_name, status, created_by)
     VALUES (?, ?, ?, ?, 'PARSING', ?)`,
    [processId, cycleId ?? null, importMode, fileName, createdBy]
  );
  const batchId = batchInsert.insertId;

  // ── Step 4: Build normalizer config ─────────────────────────────────────
  const normConfig: NormalizerConfig = {
    importMode,
    hdMapsTo: 'NEEDS_MAPPING',
  };

  // ── Step 5: Process data rows ────────────────────────────────────────────
  const rowEntries: RowEntry[] = [];
  // Duplicate tracker: key = `${empIdRaw}|${rosterDate}` → first entry index
  const dupMap = new Map<string, number>();

  const dataRows = rows.slice(headerRowIndex + 1);

  for (let ri = 0; ri < dataRows.length; ri++) {
    const dataRow = dataRows[ri];
    const absoluteRowNumber = headerRowIndex + 2 + ri; // 1-based spreadsheet row

    // Extract identity field values
    let employeeIdRaw = '';
    let employeeNameRaw = '';
    const extraMetadata: Record<string, string> = {};

    for (const idCol of identityColumns) {
      const val = String(dataRow[idCol.index] ?? '').trim();
      const canonical = idCol.mapping.mappedTo;
      if (canonical === 'employeeId') {
        employeeIdRaw = val;
      } else if (canonical === 'employeeName') {
        employeeNameRaw = val;
      } else if (canonical !== null) {
        extraMetadata[canonical] = val;
      } else {
        // unmapped column — store under source header
        extraMetadata[idCol.header] = val;
      }
    }

    // Skip entirely blank data rows
    const rowHasData = dataRow.some((c) => String(c ?? '').trim() !== '');
    if (!rowHasData) continue;

    // For each date column, create one row entry
    for (const dateCol of dateColumns) {
      const cellValue = String(dataRow[dateCol.index] ?? '').trim();
      const rosterDate = toYMD(dateCol.parsedDate);

      const normalized = normalizeAssignment(cellValue, normConfig);

      let validationState: 'VALID' | 'WARNING' | 'ERROR' = 'VALID';
      const messages: string[] = [];

      // ── Validation Rules ────────────────────────────────────────────────
      if (!employeeIdRaw) {
        validationState = 'ERROR';
        messages.push('Missing employee ID in row');
      } else if (normalized.type === 'HARD_ERROR') {
        validationState = 'ERROR';
        messages.push('Literal 0 is not a valid assignment');
      } else if (normalized.type === 'NEEDS_MAPPING') {
        validationState = 'ERROR';
        messages.push(`Shift/status '${cellValue}' not recognized — add to alias map`);
      } else if (normalized.type === 'UNASSIGNED') {
        validationState = 'WARNING';
        messages.push('Cell is blank — will be UNASSIGNED');
      }
      // LEAVE check will be done after initial pass (async DB check)

      const dupKey = `${employeeIdRaw}|${rosterDate}`;

      rowEntries.push({
        rowNumber: absoluteRowNumber,
        employeeIdRaw,
        employeeNameRaw,
        rosterDate,
        rawValue: cellValue,
        normalizedType: normalized.type,
        validationState,
        messages,
        extraMetadata,
        dupKey,
      });
    }
  }

  // ── Step 6: Duplicate detection ──────────────────────────────────────────
  for (let i = 0; i < rowEntries.length; i++) {
    const entry = rowEntries[i];
    const firstIdx = dupMap.get(entry.dupKey);
    if (firstIdx === undefined) {
      dupMap.set(entry.dupKey, i);
    } else {
      const first = rowEntries[firstIdx];
      if (first.normalizedType === entry.normalizedType) {
        // Same value: keep first, mark duplicate as WARNING
        if (entry.validationState !== 'ERROR') {
          entry.validationState = 'WARNING';
        }
        entry.messages.push('Duplicate assignment — deduplicated');
      } else {
        // Different value: both are ERROR
        first.validationState = 'ERROR';
        if (!first.messages.includes('Conflicting assignments for same employee+date')) {
          first.messages.push('Conflicting assignments for same employee+date');
        }
        entry.validationState = 'ERROR';
        entry.messages.push('Conflicting assignments for same employee+date');
      }
    }
  }

  // ── Step 7: Async LEAVE validation (DB check) ───────────────────────────
  for (const entry of rowEntries) {
    if (
      entry.normalizedType === 'LEAVE' &&
      entry.validationState !== 'ERROR' &&
      entry.employeeIdRaw
    ) {
      const approved = await hasApprovedLeave(entry.employeeIdRaw, entry.rosterDate);
      if (!approved) {
        entry.validationState = 'WARNING';
        entry.messages.push('Roster marks LEAVE but no approved leave request found');
      }
    }
  }

  // ── Step 8: Insert rows into DB ─────────────────────────────────────────
  for (const entry of rowEntries) {
    await db.execute(
      `INSERT INTO wfm_roster_import_row
         (batch_id, row_number, employee_id_raw, employee_name_raw,
          roster_date, raw_value, normalized_type,
          validation_state, validation_messages, extra_metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchId,
        entry.rowNumber,
        entry.employeeIdRaw || null,
        entry.employeeNameRaw || null,
        entry.rosterDate,
        entry.rawValue,
        entry.normalizedType,
        entry.validationState,
        JSON.stringify(entry.messages),
        Object.keys(entry.extraMetadata).length > 0
          ? JSON.stringify(entry.extraMetadata)
          : null,
      ]
    );
  }

  // ── Step 9: Build summary ────────────────────────────────────────────────
  const uniqueEmployees = new Set(rowEntries.map((r) => r.employeeIdRaw).filter(Boolean));
  const validCount = rowEntries.filter((r) => r.validationState === 'VALID').length;
  const warningCount = rowEntries.filter((r) => r.validationState === 'WARNING').length;
  const errorCount = rowEntries.filter((r) => r.validationState === 'ERROR').length;
  const needsMappingCount = rowEntries.filter((r) => r.normalizedType === 'NEEDS_MAPPING').length;
  const unassignedCount = rowEntries.filter((r) => r.normalizedType === 'UNASSIGNED').length;

  const allDates = rowEntries.map((r) => r.rosterDate).sort();
  const dateRangeStart = allDates.length > 0 ? allDates[0] : null;
  const dateRangeEnd = allDates.length > 0 ? allDates[allDates.length - 1] : null;

  const summary: BatchSummary = {
    totalEmployees: uniqueEmployees.size,
    totalAssignments: rowEntries.length,
    valid: validCount,
    warnings: warningCount,
    errors: errorCount,
    needsMapping: needsMappingCount,
    unassigned: unassignedCount,
    dateRangeStart,
    dateRangeEnd,
  };

  // ── Step 10: Update batch record to PREVIEW ──────────────────────────────
  await db.execute(
    `UPDATE wfm_roster_import_batch
     SET status = 'PREVIEW',
         total_rows = ?,
         valid_rows = ?,
         warning_rows = ?,
         error_rows = ?,
         needs_mapping_rows = ?,
         date_range_start = ?,
         date_range_end = ?,
         validation_summary_json = ?
     WHERE id = ?`,
    [
      rowEntries.length,
      validCount,
      warningCount,
      errorCount,
      needsMappingCount,
      dateRangeStart,
      dateRangeEnd,
      JSON.stringify(summary),
      batchId,
    ]
  );

  return { batchId, summary };
}

export async function getImportBatch(
  batchId: number
): Promise<{ batch: any; summary: BatchSummary }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_import_batch WHERE id = ?`,
    [batchId]
  );
  if (rows.length === 0) {
    throw Object.assign(new Error('Import batch not found'), { statusCode: 404 });
  }
  const batch = rows[0];
  const summary: BatchSummary = batch.validation_summary_json
    ? (typeof batch.validation_summary_json === 'string'
        ? JSON.parse(batch.validation_summary_json)
        : batch.validation_summary_json)
    : {
        totalEmployees: 0,
        totalAssignments: batch.total_rows ?? 0,
        valid: batch.valid_rows ?? 0,
        warnings: batch.warning_rows ?? 0,
        errors: batch.error_rows ?? 0,
        needsMapping: batch.needs_mapping_rows ?? 0,
        unassigned: 0,
        dateRangeStart: batch.date_range_start ?? null,
        dateRangeEnd: batch.date_range_end ?? null,
      };
  return { batch, summary };
}

// ── Commit types ─────────────────────────────────────────────────────────────

export interface CommitResult {
  assignmentsCreated: number;
  assignmentsUpdated: number;
  skipped: number;
}

// ── commitImportBatch ─────────────────────────────────────────────────────────

export async function commitImportBatch(
  batchId: number,
  committedBy: string,
  options: { overrideWarnings?: boolean }
): Promise<CommitResult> {
  // Step 1: Fetch batch
  const [batchRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_import_batch WHERE id = ?`,
    [batchId]
  );
  if ((batchRows as RowDataPacket[]).length === 0) {
    throw new Error('Import batch not found');
  }
  const batch = (batchRows as RowDataPacket[])[0];

  // Step 2: Check status
  if (batch.status !== 'PREVIEW' && batch.status !== 'READY') {
    throw new Error('Batch is not in a committable state');
  }

  // Step 3: Check for hard errors
  const [errorCountRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM wfm_roster_import_row
     WHERE batch_id = ? AND validation_state = 'ERROR'`,
    [batchId]
  );
  const errorCount = (errorCountRows as RowDataPacket[])[0].cnt as number;
  if (errorCount > 0 && !options.overrideWarnings) {
    throw new Error(`Batch has ${errorCount} errors — resolve or use overrideWarnings`);
  }

  // Step 4: Check warnings
  const [warnCountRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM wfm_roster_import_row
     WHERE batch_id = ? AND validation_state = 'WARNING'`,
    [batchId]
  );
  const warnCount = (warnCountRows as RowDataPacket[])[0].cnt as number;
  if (warnCount > 0 && !options.overrideWarnings) {
    throw new Error('Batch has warnings — pass overrideWarnings: true to proceed');
  }

  // Step 5: Maker-checker
  if (batch.created_by === committedBy) {
    throw new Error('Uploader cannot approve their own import (maker-checker policy)');
  }

  // Step 6: Fetch committable rows (exclude NO_CHANGE, NEEDS_MAPPING, ERROR when overrideWarnings)
  const [importRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_import_row
     WHERE batch_id = ?
       AND validation_state IN ('VALID', 'WARNING')
       AND normalized_type NOT IN ('NO_CHANGE', 'NEEDS_MAPPING', 'HARD_ERROR')`,
    [batchId]
  );
  const rows = importRows as RowDataPacket[];

  // Step 7: Begin transaction and insert/update assignments
  const conn = await (db as any).getConnection();
  await conn.beginTransaction();

  let assignmentsCreated = 0;
  let assignmentsUpdated = 0;
  let skipped = 0;

  try {
    for (const row of rows) {
      const importMode = batch.import_mode as 'NEW' | 'UPDATE';

      if (importMode === 'NEW') {
        // INSERT IGNORE — skip if already exists
        const [result] = await conn.execute(
          `INSERT IGNORE INTO wfm_roster_assignment
             (id, employee_id, roster_date, assignment_type, lifecycle_state, import_batch_id, created_at)
           VALUES (UUID(), ?, ?, ?, 'DRAFT', ?, NOW())`,
          [row.employee_id_raw, row.roster_date, row.normalized_type, batchId]
        );
        if ((result as ResultSetHeader).affectedRows > 0) {
          assignmentsCreated++;
        } else {
          skipped++;
        }
      } else {
        // UPDATE mode — ON DUPLICATE KEY UPDATE
        const [result] = await conn.execute(
          `INSERT INTO wfm_roster_assignment
             (id, employee_id, roster_date, assignment_type, lifecycle_state, import_batch_id, created_at)
           VALUES (UUID(), ?, ?, ?, 'DRAFT', ?, NOW())
           ON DUPLICATE KEY UPDATE
             assignment_type = VALUES(assignment_type),
             lifecycle_state = 'DRAFT',
             import_batch_id = VALUES(import_batch_id)`,
          [row.employee_id_raw, row.roster_date, row.normalized_type, batchId]
        );
        const header = result as ResultSetHeader;
        if (header.affectedRows === 1) {
          assignmentsCreated++;
        } else if (header.affectedRows === 2) {
          // MySQL returns 2 for ON DUPLICATE KEY UPDATE that changed a row
          assignmentsUpdated++;
        } else {
          // affectedRows === 0 means ON DUPLICATE KEY UPDATE but no change
          assignmentsUpdated++;
        }
      }
    }

    // Update batch status
    await conn.execute(
      `UPDATE wfm_roster_import_batch
       SET status = 'COMMITTED', committed_by = ?, committed_at = NOW()
       WHERE id = ?`,
      [committedBy, batchId]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { assignmentsCreated, assignmentsUpdated, skipped };
}

// ── getImportRows ─────────────────────────────────────────────────────────────

export async function getImportRows(
  batchId: number,
  options: {
    page: number;
    limit: number;
    state?: 'VALID' | 'WARNING' | 'ERROR';
  }
): Promise<{ rows: any[]; total: number }> {
  const { page, limit, state } = options;
  const offset = (page - 1) * limit;

  const stateClause = state ? ' AND validation_state = ?' : '';
  const stateParams = state ? [state] : [];

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM wfm_roster_import_row WHERE batch_id = ?${stateClause}`,
    [batchId, ...stateParams]
  );
  const total = (countRows[0] as any).cnt as number;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_import_row
     WHERE batch_id = ?${stateClause}
     ORDER BY row_number ASC, roster_date ASC
     LIMIT ? OFFSET ?`,
    [batchId, ...stateParams, limit, offset]
  );

  return { rows: rows as any[], total };
}

// ── updateImportRow ────────────────────────────────────────────────────────────
// Allows WFM to manually override a single cell's raw_value, re-normalizes it,
// re-validates, and saves the updated row back to DB.
export async function updateImportRow(
  batchId: number,
  rowId: number,
  newRawValue: string,
): Promise<{ row: any }> {
  // Verify row belongs to batch
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_import_row WHERE id = ? AND batch_id = ?`,
    [rowId, batchId]
  );
  if ((existing as RowDataPacket[]).length === 0) {
    throw Object.assign(new Error('Row not found in this batch'), { statusCode: 404 });
  }
  const prev = (existing as RowDataPacket[])[0];

  // Fetch batch import mode
  const [batchRows] = await db.execute<RowDataPacket[]>(
    `SELECT import_mode FROM wfm_roster_import_batch WHERE id = ?`,
    [batchId]
  );
  const importMode = ((batchRows as RowDataPacket[])[0]?.import_mode ?? 'NEW') as 'NEW' | 'UPDATE';

  // Re-normalize
  const normalized = normalizeAssignment(newRawValue, { importMode, hdMapsTo: 'NEEDS_MAPPING' });

  let newState: 'VALID' | 'WARNING' | 'ERROR' = 'VALID';
  const messages: string[] = [];
  if (!prev.employee_id_raw) {
    newState = 'ERROR'; messages.push('Missing employee ID');
  } else if (normalized.type === 'HARD_ERROR') {
    newState = 'ERROR'; messages.push('Literal 0 is not valid');
  } else if (normalized.type === 'NEEDS_MAPPING') {
    newState = 'ERROR'; messages.push(`Shift/status '${newRawValue}' not recognized`);
  } else if (normalized.type === 'UNASSIGNED') {
    newState = 'WARNING'; messages.push('Cell is blank — will be UNASSIGNED');
  }

  await db.execute(
    `UPDATE wfm_roster_import_row
     SET raw_value = ?, normalized_type = ?, validation_state = ?, validation_messages = ?
     WHERE id = ?`,
    [newRawValue, normalized.type, newState, JSON.stringify(messages), rowId]
  );

  // Recompute batch totals
  const [totals] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_rows,
       SUM(validation_state = 'VALID') AS valid_rows,
       SUM(validation_state = 'WARNING') AS warning_rows,
       SUM(validation_state = 'ERROR') AS error_rows,
       SUM(normalized_type = 'NEEDS_MAPPING') AS needs_mapping_rows
     FROM wfm_roster_import_row WHERE batch_id = ?`,
    [batchId]
  );
  const t = (totals as RowDataPacket[])[0];
  await db.execute(
    `UPDATE wfm_roster_import_batch
     SET total_rows=?, valid_rows=?, warning_rows=?, error_rows=?, needs_mapping_rows=?
     WHERE id=?`,
    [t.total_rows, t.valid_rows, t.warning_rows, t.error_rows, t.needs_mapping_rows, batchId]
  );

  const [updated] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_import_row WHERE id = ?`, [rowId]
  );
  return { row: (updated as RowDataPacket[])[0] };
}

// ── getMissingEmployees ───────────────────────────────────────────────────────
// Returns active employees in the batch's process who do NOT appear
// in any import row for this batch (i.e. their roster wasn't uploaded).
export async function getMissingEmployees(
  batchId: number,
): Promise<{ employees: any[]; total: number }> {
  // Get process_id for this batch
  const [batchRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id FROM wfm_roster_import_batch WHERE id = ?`, [batchId]
  );
  if ((batchRows as RowDataPacket[]).length === 0) {
    throw Object.assign(new Error('Batch not found'), { statusCode: 404 });
  }
  const processId = (batchRows as RowDataPacket[])[0].process_id;

  // Get all employee_id_raw values already in this batch
  const [importedRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT employee_id_raw FROM wfm_roster_import_row WHERE batch_id = ? AND employee_id_raw IS NOT NULL`,
    [batchId]
  );
  const importedIds = new Set(
    (importedRows as RowDataPacket[]).map((r) => (r.employee_id_raw as string).toUpperCase())
  );

  // Get all active employees in the process
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name, designation
     FROM employees
     WHERE process_id = ? AND employment_status = 'active'
     ORDER BY full_name`,
    [processId]
  );

  const missing = (empRows as RowDataPacket[]).filter(
    (e) => !importedIds.has((e.employee_code as string ?? '').toUpperCase())
  );

  return { employees: missing, total: missing.length };
}
