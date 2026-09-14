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
import { sqlLimitOffset } from '../../db/pagination.js';
import { withEmployeeRosterLock, validateMinimumRest, applyRestDecision, isRestPolicyFeatureActive } from './rest-policy.service.js';
import { checkEmployeeDateNotLocked } from '../roster/roster-lock-guard.js';
import { parseShiftString } from './shift-parser.service.js';

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

/**
 * Which (employee code, date) pairs have an approved leave request, for the whole batch at once.
 *
 * The previous version was wrong three ways and, because it swallowed its own error and returned
 * "permissive", none of them was visible:
 *   1. It queried `leave_request.leave_date`, which does not exist. Leave is stored as a RANGE
 *      (from_date / to_date). Every call threw ER_BAD_FIELD_ERROR — verified live 2026-08-20.
 *   2. It matched `leave_request.employee_id` against the spreadsheet's employee CODE. That column
 *      holds the employees.id UUID, so even with the right date column it could never match.
 *   3. It ran one query PER LEAVE CELL. On a real roster that is hundreds of round trips, and over
 *      the public database address it was slow enough to stall the import outright.
 *
 * Net effect: the "roster says LEAVE but no approved leave exists" warning could never fire, on a
 * table holding 29,265 approved requests.
 *
 * One query now covers the batch, bounded to the roster's own date window, and the ranges are
 * expanded into a lookup set. Still permissive on failure — a broken cross-check must not block an
 * import — but it now logs, because silence is what hid this for so long.
 */
async function approvedLeaveLookup(
  targets: Array<{ employeeIdRaw: string; rosterDate: string }>
): Promise<{ keys: Set<string>; usable: boolean }> {
  if (targets.length === 0) return { keys: new Set(), usable: true };

  const codes = [...new Set(targets.map((t) => t.employeeIdRaw).filter(Boolean))];
  if (codes.length === 0) return { keys: new Set(), usable: true };

  const dates = targets.map((t) => t.rosterDate).filter(Boolean).sort();
  const windowStart = dates[0];
  const windowEnd = dates[dates.length - 1];

  try {
    const placeholders = codes.map(() => '?').join(', ');
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code AS code, lr.from_date AS fromDate, lr.to_date AS toDate
         FROM leave_request lr
         JOIN employees e ON e.id = lr.employee_id
        WHERE lr.status = 'approved'
          AND e.employee_code IN (${placeholders})
          AND lr.to_date   >= ?
          AND lr.from_date <= ?`,
      [...codes, windowStart, windowEnd]
    );

    const keys = new Set<string>();
    for (const r of rows as Array<{ code: string; fromDate: Date | string; toDate: Date | string }>) {
      const from = new Date(r.fromDate);
      const to = new Date(r.toDate);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        keys.add(`${r.code}|${toYMD(d)}`);
      }
    }
    return { keys, usable: true };
  } catch (err) {
    console.error('[roster-import] approved-leave cross-check unavailable', err);
    return { keys: new Set(), usable: false };
  }
}

// ── Main service functions ───────────────────────────────────────────────────

export async function createImportBatch(params: {
  /**
   * Optional. A roster file already identifies its people by employee code, and each employee
   * already carries their own process, branch and cost centre — so making the uploader pick a
   * process was asking for information the file implies. Omit it and each row is filed against
   * the employee's own process. 291 of 1,069 active employees have no process at all; their rows
   * still import, with process simply blank, rather than the upload being blocked.
   */
  processId?: string;
  /**
   * Optional alternative to processId. Files everything under a branch instead of a single
   * process — for a "whole branch, every process" upload where one sheet mixes employees from
   * several processes. Employee matching itself never used process_id (it's employee_code,
   * globally unique), so this only changes what the batch is filed under and what
   * getMissingEmployees checks the roster against. See migration 1536.
   */
  branchId?: string;
  cycleId?: string;
  importMode: 'NEW' | 'UPDATE';
  fileBuffer: Buffer;
  fileName: string;
  createdBy: string;
  /**
   * Which sheet to import. Omit to let the scan decide; it only errors as ambiguous when more
   * than one sheet in the workbook genuinely looks like a roster, which is when the upload page
   * shows a picker and sends the answer back here.
   */
  sheetName?: string;
}): Promise<{ batchId: number; summary: BatchSummary; sheetName: string }> {
  const { cycleId, importMode, fileBuffer, fileName, createdBy } = params;
  const processId = params.processId ?? null;
  const branchId = params.branchId ?? null;
  const requestedSheet = params.sheetName?.trim() || null;

  // ── Step 1: Parse file, and find the sheet the roster is actually on ─────
  //
  // This used to read `sheets: [0]` and use SheetNames[0] unconditionally. Real weekly WFM
  // workbooks are not shaped that way: the one that surfaced this has 12 tabs with the roster
  // well down the list and a 'Planning' grid first, so every upload was refused with "could not
  // detect header row" no matter how correct the roster tab was. The previous fix improved that
  // message but left the single-sheet limitation in place, so the file still could not be
  // imported.
  //
  // Fast path preserved: the first sheet is still read alone first, and if it has a header row
  // nothing else is parsed. That keeps the measured win on single-sheet files (1,154 ms vs
  // 2,936 ms to read all 12 tabs of a 7.6 MB workbook). Only when the first sheet does NOT look
  // like a roster do we pay to open the rest — the case that previously just failed.
  const readRows = (wb: XLSX.WorkBook, name: string): unknown[][] =>
    // unknown[][], not string[][]: a real spreadsheet returns numbers and Dates in these cells
    // (date headers come back as Excel serials), and the old string[][] cast made
    // header-alias.service.ts throw 'trim is not a function' on the first real file. Every read
    // below already coerces with String(...).
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) as unknown[][];

  //
  // "First sheet with a detectable header row" is NOT good enough, and shipping it would have
  // been worse than the original bug. Measured against the real 12-tab workbook: analyzeHeaders
  // ACCEPTS 'OT Planning', 'AHT Deficit', 'Summary' and 'Projection-II' — capacity and analytics
  // grids whose numeric column headers parse as dates. First-match would have silently imported
  // 'OT Planning' as if it were the roster.
  //
  // What actually separates a roster from an analytics grid is that a roster NAMES THE EMPLOYEE.
  // On that same workbook the identity mapping is decisive:
  //   Roster - Analyst   -> employeeName (+8 more)   roster
  //   Leadership Roster  -> employeeId, employeeName  roster
  //   OT Planning        -> amName, tlName only       manager columns, not the employee
  //   Summary            -> amName only               not a roster
  //   AHT Deficit        -> nothing                   not a roster
  // So a candidate must map employeeId or employeeName. Among those, prefer the one that
  // identifies people most strongly, then the one with the most dated columns, then the largest —
  // the main roster rather than a 31-row offcut.
  const scoreSheet = (h: ReturnType<typeof analyzeHeaders>, rowCount: number): number => {
    const mapped = new Set(
      (h.identityColumns ?? [])
        .map((c) => c.mapping?.mappedTo)
        .filter((m): m is string => Boolean(m))
    );
    if (!mapped.has('employeeId') && !mapped.has('employeeName')) return -1; // not a roster
    let score = 0;
    if (mapped.has('employeeId')) score += 1000;
    if (mapped.has('employeeName')) score += 1000;
    score += mapped.size * 10;
    score += (h.dateColumns?.length ?? 0) * 5;
    score += Math.min(rowCount, 5000) / 1000;
    return score;
  };

  const firstOnly = XLSX.read(fileBuffer, { type: 'buffer', sheets: [0] });
  let sheetName = firstOnly.SheetNames[0];
  let rows = readRows(firstOnly, sheetName);
  let headerResult = analyzeHeaders(rows);
  let allSheetNames = firstOnly.SheetNames;
  let rejectedSheets: string[] = [];
  const candidates: string[] = [];

  if (scoreSheet(headerResult, rows.length) < 0) {
    // sheetRows: 25 — detection only needs the header band, and reading all 12 tabs of a 7.6 MB
    // workbook in full exhausts Node's heap (verified: FATAL ERROR JavaScript heap out of memory).
    // Some tabs here are 291 rows x 765 columns. Detect cheaply, then re-read only the winner.
    const probe = XLSX.read(fileBuffer, { type: 'buffer', sheetRows: 25 });
    allSheetNames = probe.SheetNames;
    let best = { score: -1, name: '' };
    for (const candidate of probe.SheetNames) {
      const probeRows = readRows(probe, candidate);
      const probeHeader = analyzeHeaders(probeRows);
      const score = scoreSheet(probeHeader, probeRows.length);
      if (score < 0) { rejectedSheets.push(candidate); continue; }
      candidates.push(candidate);
      const wins = requestedSheet ? candidate === requestedSheet : score > best.score;
      if (wins) best = { score: requestedSheet ? Number.MAX_SAFE_INTEGER : score, name: candidate };
    }
    if (requestedSheet && best.name !== requestedSheet) {
      throw Object.assign(
        new Error(
          `Sheet '${requestedSheet}' is not a roster sheet in this file. ` +
          (candidates.length
            ? `Candidates: ${candidates.map((c) => `'${c}'`).join(', ')}.`
            : `No sheet in this file looks like a roster.`)
        ),
        { statusCode: 400, code: 'ROSTER_IMPORT_SHEET_NOT_FOUND', candidates }
      );
    }
    if (best.score >= 0 && !(!requestedSheet && candidates.length > 1)) {
      // Full read of the chosen sheet only.
      const chosen = XLSX.read(fileBuffer, { type: 'buffer', sheets: [best.name] });
      sheetName = best.name;
      rows = readRows(chosen, best.name);
      headerResult = analyzeHeaders(rows);
    }
    if (best.score < 0) headerResult = { ...headerResult, headerRowIndex: -1 };

    // More than one sheet can legitimately be a roster, and picking for the user would be a
    // guess with real consequences. The real 12-tab workbook contains THREE: 'Roster - Analyst'
    // (204 agents), 'Leadership Roster' (74 managers) and 'Sheet1' (31 rows). Scoring ranks
    // 'Leadership Roster' top because it carries an employee code as well as a name — which is
    // very probably NOT the sheet the uploader meant. Importing 74 managers instead of 204
    // agents, silently, is exactly the class of failure this module is full of.
    //
    // So when the choice is ambiguous, refuse and name the candidates. requestedSheet lets the
    // caller answer, which is what the sheet picker on the upload page sends back.
    if (!requestedSheet && candidates.length > 1) {
      throw Object.assign(
        new Error(
          `This file has ${candidates.length} sheets that could be the roster: ` +
          `${candidates.map((c) => `'${c}'`).join(', ')}. Choose which one to import.`
        ),
        { statusCode: 409, code: 'ROSTER_IMPORT_AMBIGUOUS_SHEET', candidates }
      );
    }
  }

  // ── Step 2: Detect header row ────────────────────────────────────────────
  if (headerResult.headerRowIndex === -1) {
    // statusCode 400: this is the ordinary "wrong file" case, not a server fault. Without a
    // statusCode the message is replaced by a generic 500 in production and the uploader is told
    // nothing they can act on. Now that every tab is checked, name them all — the useful question
    // is no longer "why not the first sheet" but "which of these was supposed to be the roster".
    const tabs = allSheetNames.map((n) => `'${n}'`).join(', ');
    throw Object.assign(
      new Error(
        `No sheet in this file looks like a roster. Checked ${allSheetNames.length} sheet(s): ${tabs}. ` +
        `A roster sheet needs a header row with at least 2 date columns AND a column identifying ` +
        `the employee (employee code or name).`
      ),
      { statusCode: 400, code: 'ROSTER_IMPORT_NO_HEADER_ROW' }
    );
  }

  const { headerRowIndex, dateColumns, identityColumns } = headerResult;

  // ── Step 3: Insert batch record (PARSING) ────────────────────────────────
  const [batchInsert] = await db.execute<ResultSetHeader>(
    `INSERT INTO wfm_roster_import_batch
       (process_id, branch_id, cycle_id, import_mode, file_name, status, created_by)
     VALUES (?, ?, ?, ?, ?, 'PARSING', ?)`,
    [processId, branchId, cycleId ?? null, importMode, fileName, createdBy]
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

  // ── Step 6b: roster-says-WORK vs approved leave ─────────────────────────
  // The check below (step 7) looks the other way round: roster says LEAVE, is there a request?
  // The direction that actually matters was missing — roster says WORK and the employee has
  // approved leave. Flagged as an ERROR at preview so it is seen before someone commits several
  // thousand rows, and refused again at commit.
  {
    const { loadApprovedLeave, checkLeaveConflict } = await import('./roster-leave-guard.service.js');
    const codes = [...new Set(rowEntries.map((e) => e.employeeIdRaw).filter(Boolean))];
    if (codes.length) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, employee_code FROM employees WHERE employee_code IN (${codes.map(() => '?').join(',')})`,
        codes
      );
      const codeToEmpId = new Map<string, string>();
      for (const e of empRows) codeToEmpId.set(String(e.employee_code), String(e.id));

      const dates = rowEntries.map((e) => e.rosterDate).filter(Boolean).sort();
      if (dates.length && codeToEmpId.size) {
        const leaveMap = await loadApprovedLeave(
          [...codeToEmpId.values()], dates[0], dates[dates.length - 1]);
        for (const entry of rowEntries) {
          const empId = codeToEmpId.get(entry.employeeIdRaw);
          if (!empId) continue;
          const v = checkLeaveConflict(leaveMap, empId, entry.rosterDate, {
            assignmentType: entry.normalizedType,
          });
          if (v.blocked) {
            entry.validationState = 'ERROR';
            entry.messages.push(v.reason ?? 'Blocked by approved leave');
          } else if (v.warning && entry.validationState === 'VALID') {
            entry.validationState = 'WARNING';
            entry.messages.push(v.reason ?? 'Half-day approved leave');
          }
        }
      }
    }
  }

  // ── Step 7: LEAVE cross-check (one query for the whole batch) ───────────
  const leaveTargets = rowEntries.filter(
    (e) => e.normalizedType === 'LEAVE' && e.validationState !== 'ERROR' && e.employeeIdRaw
  );
  const { keys: approvedLeave, usable: leaveCheckUsable } = await approvedLeaveLookup(leaveTargets);
  if (leaveCheckUsable) {
    for (const entry of leaveTargets) {
      if (!approvedLeave.has(`${entry.employeeIdRaw}|${entry.rosterDate}`)) {
        entry.validationState = 'WARNING';
        entry.messages.push('Roster marks LEAVE but no approved leave request found');
      }
    }
  }
  // When the cross-check could not run, no warning is raised rather than a false one on every
  // LEAVE cell — but it is logged above, not swallowed.

  // ── Step 8: Insert rows into DB ─────────────────────────────────────────
  //
  // Chunked multi-row INSERT, not one statement per cell. A real roster is employees x dates —
  // the reported 301-row workbook is ~4,200 cells — and a per-row INSERT is that many round
  // trips. On the production LAN that is merely slow; from off-LAN it stalls the import
  // outright, which is how it was noticed.
  //
  // `row_number` MUST stay escaped-backticked: ROW_NUMBER is a RESERVED WORD in MySQL 8, so the
  // unquoted column name made this INSERT fail with ER_PARSE_ERROR on EVERY import. The batch row
  // is written before this point, so the visible result was a batch stuck at PARSING with 0 rows
  // and a bare "Import failed". Verified live 2026-08-20 on MySQL 8.0.42: unquoted ->
  // ER_PARSE_ERROR, backticked -> accepted. Production held exactly one such batch,
  // 'Roster.xlsx', PARSING, total_rows 0. The backslashes are required — this is a template
  // literal, so an unescaped backtick would terminate the SQL string.
  //
  // 500 rows per statement keeps each packet well inside max_allowed_packet while cutting a
  // 4,200-cell import from 4,200 statements to 9.
  const INSERT_CHUNK = 500;
  for (let i = 0; i < rowEntries.length; i += INSERT_CHUNK) {
    const chunk = rowEntries.slice(i, i + INSERT_CHUNK);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const entry of chunk) {
      tuples.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
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
      );
    }
    await db.execute(
      `INSERT INTO wfm_roster_import_row
         (batch_id, \`row_number\`, employee_id_raw, employee_name_raw,
          roster_date, raw_value, normalized_type,
          validation_state, validation_messages, extra_metadata_json)
       VALUES ${tuples.join(', ')}`,
      values
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

  return { batchId, summary, sheetName };
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
  /** Rows whose employee code matched no employee — a data problem, not a duplicate. */
  unmatchedEmployees: number;
  /** Rows refused because the employee has approved leave that day. Never silently written. */
  blockedByLeave: number;
  /** Rows refused: shift too close to a neighboring shift for the minimum-rest policy to allow
   *  (BLOCK mode), or no rest policy resolves for the employee's scope at all. Bulk import has no
   *  UI to supply an emergency-override reason/approver, so unlike manual assignment this can
   *  never be overridden — it is always a hard skip. In the live WARN-mode policy (2026-08-16
   *  owner ruling) INSUFFICIENT_REST rows still commit, with a warning recorded instead. */
  blockedByRest: number;
  /** Rows refused because that employee/date's attendance is already locked for payroll. */
  blockedByLock: number;
  /** Distinct employees who got a "your roster was published" work-inbox item for this batch. */
  employeesNotified: number;
}

// ── notifyEmployeesForImportBatch ─────────────────────────────────────────────
//
// Same publish/notify mechanism as wfm.routes.ts's POST /roster/publish-to-employees, scoped by
// import_batch_id instead of cycle_id so a plain spreadsheet commit (no Roster Builder cycleId,
// cycle_id therefore NULL) reaches employees the same way a cycle-based publish does. Deliberately
// a separate function, not a call into that route's handler: this only ever touches rows this one
// batch just wrote (import_batch_id = ?), never re-scans a whole cycle, and it has no cycle-status
// state machine to respect (a spreadsheet-committed batch has no weekly_roster_cycle row at all
// unless it was linked to one via cycleId, in which case it already went through the real cycle
// publish flow instead — see the cycle_id check below).
async function notifyEmployeesForImportBatch(batchId: number): Promise<number> {
  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    // A batch committed WITH a cycleId is Roster Builder's bulk-upload deep link — those rows
    // already belong to a real weekly_roster_cycle and get published through the cycle flow
    // (publish-to-employees), which this function must not race or duplicate-notify against.
    const [batchRows] = await conn.execute(
      `SELECT cycle_id FROM wfm_roster_import_batch WHERE id = ? LIMIT 1`,
      [batchId]
    );
    if ((batchRows as RowDataPacket[])[0]?.cycle_id) {
      await conn.commit();
      return 0;
    }

    const [movedResult] = await conn.execute(
      `UPDATE wfm_roster_assignment
          SET final_roster_status = 'pending_employee_ack',
              employee_ack_status = 'pending',
              employee_ack_at = NULL,
              employee_rejection_reason = NULL
        WHERE import_batch_id = ?
          AND final_roster_status = 'generated'`,
      [batchId]
    );
    const moved = movedResult as ResultSetHeader;

    if (moved.affectedRows === 0) {
      await conn.commit();
      return 0;
    }

    const [notifiedResult] = await conn.execute(
      `INSERT INTO work_inbox_item
         (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
       SELECT UUID(), e.user_id, 'ROSTER_ACK_PENDING',
              'Acknowledge your roster',
              'Your roster has been uploaded and published. Please acknowledge or raise a concern.',
              'wfm_roster_import_batch', ?, '/my-roster', 'normal'
         FROM (SELECT DISTINCT employee_id FROM wfm_roster_assignment
                WHERE import_batch_id = ? AND final_roster_status = 'pending_employee_ack') a
         JOIN employees e ON e.id = a.employee_id
         JOIN auth_user au ON au.id = e.user_id
        WHERE NOT EXISTS (
              SELECT 1 FROM work_inbox_item w
               WHERE w.user_id = e.user_id
                 AND w.type = 'ROSTER_ACK_PENDING'
                 AND w.entity_id = ?
                 AND w.is_actioned = 0)`,
      [String(batchId), String(batchId), String(batchId)]
    );
    const notified = notifiedResult as ResultSetHeader;

    await conn.commit();
    return notified.affectedRows;
  } catch (err) {
    await conn.rollback();
    // A notification failure must not undo a roster that already committed successfully — the
    // assignments are real and correct either way. Logged, not swallowed silently: this is the
    // exact class of bug ("looked like it ran, didn't") that broke the cycle-based publish route
    // for weeks before it was caught.
    console.error('[roster-import] employee notification failed (roster commit itself already succeeded):', err);
    return 0;
  } finally {
    conn.release();
  }
}

// ── commitImportBatch ─────────────────────────────────────────────────────────

export async function commitImportBatch(
  batchId: number,
  committedBy: string,
  options: { overrideWarnings?: boolean; cycleId?: string | null; committerIsSuperAdmin?: boolean }
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

  // Step 5: Maker-checker. Owner ruling 2026-08-22: the rule protects against a plain WFM/team
  // leader uploader waving their own roster through unreviewed — it was never meant to stop a
  // super_admin, who has no separate WFM-head "checker" above them in this flow and is trusted to
  // upload and approve in one step.
  if (batch.created_by === committedBy && !options.committerIsSuperAdmin) {
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

  // Step 7: Insert/update assignments
  //
  // Not one big transaction on one connection anymore (2026-08-22 fix). This was the only one of
  // four real roster-write engines with no employee lock, no minimum-rest check and no
  // payroll/date-lock check at all — a spreadsheet could silently overwrite a locked, rest-violating
  // roster date that every other write path (manual assign, auto-roster generation, bulk upload,
  // shift swap) refuses to touch. Bringing it in line means going through withEmployeeRosterLock,
  // same as roster.service.ts::assignEmployee — and that function opens its own dedicated connection
  // per employee, which cannot be nested inside one already-open cross-employee transaction. So this
  // now matches the established pattern used everywhere else a batch of roster writes happens
  // (roster.service.ts::bulkAssign, the CSV-upload path): one lock scope per employee, each row's
  // write auto-commits on its own, failures are tallied rather than rolling back rows that already
  // succeeded. A single bad row no longer takes the rest of a 4,000-row file down with it.

  let assignmentsCreated = 0;
  let assignmentsUpdated = 0;
  let skipped = 0;
  let unmatchedEmployees = 0;
  let blockedByLeave = 0;
  let blockedByRest = 0;
  let blockedByLock = 0;

  // employee_id_raw holds the spreadsheet's employee CODE ('MAS56168'); wfm_roster_assignment
  // .employee_id is a char(36) UUID with a foreign key to employees.id. The code was being
  // inserted straight into that column, so the FK rejected every row — and because the statement
  // is INSERT IGNORE, the rejection was swallowed and simply counted as "skipped". A commit of
  // 4,186 rows reported created 0 / skipped 4,179 and wrote nothing. Verified live 2026-08-20.
  // Also carries process_id/branch_id now, so the rest-policy check below can resolve scope
  // without a per-employee query once inside the lock.
  const codes = [...new Set(rows.map((r) => String(r.employee_id_raw ?? '')).filter(Boolean))];
  const codeToId = new Map<string, string>();
  const codeToScope = new Map<string, { processId: string | null; branchId: string | null }>();
  if (codes.length) {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, process_id, branch_id FROM employees WHERE employee_code IN (${codes.map(() => '?').join(',')})`,
      codes
    );
    for (const e of empRows as RowDataPacket[]) {
      codeToId.set(String(e.employee_code), String(e.id));
      codeToScope.set(String(e.employee_code), {
        processId: e.process_id ? String(e.process_id) : null,
        branchId: e.branch_id ? String(e.branch_id) : null,
      });
    }
  }

  // Approved leave is a hard block (owner ruling 2026-08-21): a spreadsheet must not overwrite it.
  // This path had no leave check at all, which mattered more than the generators having one — the
  // spreadsheet is how rosters actually get built here. Loaded once for the batch rather than per
  // row. A night shift is judged by the day it ENDS as well as the day it starts.
  const { loadApprovedLeave, checkLeaveConflict } = await import('./roster-leave-guard.service.js');
  const rosterDates = rows.map((r) => String(r.roster_date).slice(0, 10)).filter(Boolean).sort();
  const leaveMap = rosterDates.length
    ? await loadApprovedLeave([...codeToId.values()], rosterDates[0], rosterDates[rosterDates.length - 1])
    : new Map();
  const nightTemplates = new Set<string>();
  {
    const [nightRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM wfm_shift_template WHERE end_time IS NOT NULL AND start_time IS NOT NULL AND end_time <= start_time`
    );
    for (const t of nightRows as RowDataPacket[]) nightTemplates.add(String(t.id));
  }
  const restFeatureActive = await isRestPolicyFeatureActive();

  const importMode = batch.import_mode as 'NEW' | 'UPDATE';

  // Group by employee so the lock is acquired once per employee, not once per row — a real file is
  // one employee across up to a whole month of dates, and a per-row GET_LOCK/RELEASE_LOCK round trip
  // each would be needlessly slow for no extra safety.
  const rowsByCode = new Map<string, RowDataPacket[]>();
  for (const row of rows) {
    const code = String(row.employee_id_raw ?? '');
    if (!code) continue;
    if (!rowsByCode.has(code)) rowsByCode.set(code, []);
    rowsByCode.get(code)!.push(row);
  }
  for (const code of [...new Set(rows.map((r) => String(r.employee_id_raw ?? '')).filter(Boolean))]) {
    if (!codeToId.has(code)) {
      // Counted separately from "skipped": a code with no matching employee is a data problem
      // the uploader can act on, not a duplicate row.
      unmatchedEmployees += (rowsByCode.get(code) ?? []).length;
    }
  }

  for (const [code, employeeRows] of rowsByCode) {
    const employeeId = codeToId.get(code);
    if (!employeeId) continue; // already tallied into unmatchedEmployees above

    const scope = codeToScope.get(code) ?? { processId: null, branchId: null };

    await withEmployeeRosterLock(employeeId, async (conn) => {
      for (const row of employeeRows) {
        const rosterDate = String(row.roster_date).slice(0, 10);

        const lockCheck = await checkEmployeeDateNotLocked(conn, employeeId, rosterDate);
        if (lockCheck.blocked) {
          blockedByLock++;
          continue;
        }

        // Only a SHIFT row has a time to validate rest against, persist, or judge night-shift-ness
        // from — everything else (WEEK_OFF/LEAVE/ABSENT/HOLIDAY/TRAINING/UNASSIGNED) has no
        // shift_start_time/end_time. Parsed fresh from raw_value rather than trusting a stored
        // parse: the preview step never persisted shiftParseResult, only normalized_type, so this
        // is the first point it exists. Parsed BEFORE the leave check (moved 2026-08-22, was after)
        // specifically so the leave check's isNightShift can use it — the previous isNightShift read
        // row.shift_template_id, a column that does not exist on wfm_roster_import_row (the real
        // column, resolved_shift_id, is never written by anything in this file either), so night-shift
        // leave protection silently degraded to day-only for every imported row.
        let shiftStartTime: string | null = null;
        let shiftEndTime: string | null = null;
        let isNightShift = false;
        if (row.normalized_type === 'SHIFT') {
          const parsed = parseShiftString(String(row.raw_value ?? ''));
          if (parsed.success && parsed.parsed?.startTime && parsed.parsed?.endTime) {
            shiftStartTime = parsed.parsed.startTime;
            shiftEndTime = parsed.parsed.endTime;
            isNightShift = parsed.parsed.isOvernight;
          }
        }

        const leaveVerdict = checkLeaveConflict(leaveMap, employeeId, rosterDate, {
          isNightShift,
          assignmentType: row.normalized_type,
        });
        if (leaveVerdict.blocked) {
          // Counted and reported, never written. The rest of the file still imports — one protected
          // day must not cost the planner the whole upload.
          blockedByLeave++;
          continue;
        }

        if (shiftStartTime && shiftEndTime && restFeatureActive) {
          const restCheck = await validateMinimumRest(
            { employeeId, processId: scope.processId, branchId: scope.branchId, forDate: rosterDate },
            { startTime: shiftStartTime, endTime: shiftEndTime },
            null,
            conn
          );
          if (!restCheck.ok) {
            // No emergency-override path here — bulk import has no UI to collect a reason +
            // approver for one cell in a 4,000-row file, unlike manual assignment. In the live
            // WARN-mode policy this still commits (applyRestDecision records a warning and
            // allows it through); only BLOCK mode or a genuinely unresolved policy refuses the
            // row outright.
            const decision = await applyRestDecision(restCheck, { employeeId, rosterDate }, conn);
            if (!decision.allowed) {
              blockedByRest++;
              continue;
            }
          }
        }

        /*
         * assignment_type carries the week-off, but `is_week_off` is the column 112 call sites
         * across this repo actually read — payroll's paid-day counting, the WFM compliance
         * engine's shift/violation split, week-off fairness, break management and the roster
         * reports all branch on the flag, not the type. Every INSERT below omitted it, so it
         * defaulted to 0 and a committed roster looked like nobody ever had a day off.
         * Measured on live data before this fix: 916 rows with assignment_type='WEEK_OFF' and
         * is_week_off=1 on exactly ZERO of them.
         */
        const isWeekOff = row.normalized_type === 'WEEK_OFF' ? 1 : 0;

        if (importMode === 'NEW') {
          // INSERT IGNORE — skip if already exists
          const [result] = options.cycleId
            ? await conn.execute(
                `INSERT IGNORE INTO wfm_roster_assignment
                   (id, employee_id, roster_date, assignment_type, is_week_off, shift_start_time, shift_end_time, lifecycle_state, import_batch_id, cycle_id, created_at)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, NOW())`,
                [employeeId, rosterDate, row.normalized_type, isWeekOff, shiftStartTime, shiftEndTime, batchId, options.cycleId]
              )
            : await conn.execute(
                `INSERT IGNORE INTO wfm_roster_assignment
                   (id, employee_id, roster_date, assignment_type, is_week_off, shift_start_time, shift_end_time, lifecycle_state, import_batch_id, created_at)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())`,
                [employeeId, rosterDate, row.normalized_type, isWeekOff, shiftStartTime, shiftEndTime, batchId]
              );
          if ((result as unknown as ResultSetHeader).affectedRows > 0) {
            assignmentsCreated++;
          } else {
            skipped++;
          }
        } else {
          // UPDATE mode — ON DUPLICATE KEY UPDATE
          const [result] = options.cycleId
            ? await conn.execute(
                `INSERT INTO wfm_roster_assignment
                   (id, employee_id, roster_date, assignment_type, is_week_off, shift_start_time, shift_end_time, lifecycle_state, import_batch_id, cycle_id, created_at)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                   assignment_type = VALUES(assignment_type),
                   is_week_off = VALUES(is_week_off),
                   shift_start_time = VALUES(shift_start_time),
                   shift_end_time = VALUES(shift_end_time),
                   lifecycle_state = 'DRAFT',
                   import_batch_id = VALUES(import_batch_id),
                   cycle_id = VALUES(cycle_id)`,
                [employeeId, rosterDate, row.normalized_type, isWeekOff, shiftStartTime, shiftEndTime, batchId, options.cycleId]
              )
            : await conn.execute(
                `INSERT INTO wfm_roster_assignment
                   (id, employee_id, roster_date, assignment_type, is_week_off, shift_start_time, shift_end_time, lifecycle_state, import_batch_id, created_at)
                 VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())
                 ON DUPLICATE KEY UPDATE
                   assignment_type = VALUES(assignment_type),
                   is_week_off = VALUES(is_week_off),
                   shift_start_time = VALUES(shift_start_time),
                   shift_end_time = VALUES(shift_end_time),
                   lifecycle_state = 'DRAFT',
                   import_batch_id = VALUES(import_batch_id)`,
                [employeeId, rosterDate, row.normalized_type, isWeekOff, shiftStartTime, shiftEndTime, batchId]
              );
          const header = result as unknown as ResultSetHeader;
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
    });
  }

  // Update batch status. Deliberately after every employee's lock scope has released, on the plain
  // pool — matches "partial success is still success" for the tallies above (unmatchedEmployees,
  // blockedByLeave, blockedByRest, blockedByLock never block the rest of the file, so they don't
  // block the batch reaching COMMITTED either).
  await db.execute(
    `UPDATE wfm_roster_import_batch
     SET status = 'COMMITTED', committed_by = ?, committed_at = NOW()
     WHERE id = ?`,
    [committedBy, batchId]
  );

  // Owner-reported gap (2026-08-22): a committed spreadsheet roster never told anyone. The
  // publish/acknowledge pipeline (wfm.routes.ts POST /roster/publish-to-employees) already exists
  // and works — it just only knows how to publish a weekly_roster_cycle, and a plain spreadsheet
  // commit (no Roster Builder cycleId) has cycle_id = NULL, so that route can never see these rows.
  // Same two writes, same 'generated' -> 'pending_employee_ack' transition, same one-work-item-per-
  // employee ROSTER_ACK_PENDING pattern — scoped by import_batch_id instead of cycle_id, so it
  // reaches a batch whether or not it came in through a cycle. Deliberately not folded into the
  // per-employee lock loop above: those locks protect the WRITE (concurrent conflicting
  // assignments); this is a separate, unconditional notify pass over whatever actually landed.
  const employeesNotified = await notifyEmployeesForImportBatch(batchId);

  return { assignmentsCreated, assignmentsUpdated, skipped, unmatchedEmployees, blockedByLeave, blockedByRest, blockedByLock, employeesNotified };
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

  // sqlLimitOffset, not a bound LIMIT ?/OFFSET ? — db.execute() prepares this statement, and on
  // mas_hrms (MySQL 8.0.42) a bound LIMIT/OFFSET fails every call with "Incorrect arguments to
  // mysqld_stmt_execute" regardless of the value's type. Same defect class already fixed in
  // cost-centre-management.service.ts, report-request.service.ts and reimbursements.routes.ts —
  // see src/db/pagination.ts. page/limit are already validated integers at the route.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM wfm_roster_import_row
     WHERE batch_id = ?${stateClause}
     ORDER BY \`row_number\` ASC, roster_date ASC
     ${sqlLimitOffset(limit, offset, { defaultLimit: 50, maxLimit: 5000 })}`,
    [batchId, ...stateParams]
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
// Returns active employees in the batch's scope (process, or whole branch when the batch was
// uploaded as a branch-wide import — see migration 1536) who do NOT appear in any import row
// for this batch (i.e. their roster wasn't uploaded).
export async function getMissingEmployees(
  batchId: number,
): Promise<{ employees: any[]; total: number }> {
  // Get process_id / branch_id for this batch
  const [batchRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, branch_id FROM wfm_roster_import_batch WHERE id = ?`, [batchId]
  );
  if ((batchRows as RowDataPacket[]).length === 0) {
    throw Object.assign(new Error('Batch not found'), { statusCode: 404 });
  }
  const { process_id: processId, branch_id: branchId } = (batchRows as RowDataPacket[])[0];

  // A process-scoped batch keeps checking against that one process. A branch-scoped batch
  // (process_id NULL, branch_id set) checks against every active employee in the branch,
  // regardless of process — that's the whole point of a whole-branch upload. If neither is
  // set there is nothing to compare against; return empty rather than matching everyone.
  const scopeColumn = processId ? 'process_id' : branchId ? 'branch_id' : null;
  const scopeValue = processId ?? branchId;
  if (!scopeColumn) {
    return { employees: [], total: 0 };
  }

  // Get all employee_id_raw values already in this batch
  const [importedRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT employee_id_raw FROM wfm_roster_import_row WHERE batch_id = ? AND employee_id_raw IS NOT NULL`,
    [batchId]
  );
  const importedIds = new Set(
    (importedRows as RowDataPacket[]).map((r) => (r.employee_id_raw as string).toUpperCase())
  );

  // Get all active employees in scope. `employees` has no `designation` column — it's
  // designation_id, a FK to designation_master — so this threw ER_BAD_FIELD_ERROR on every call
  // (verified live 2026-08-21, same phantom-column class as elsewhere in this codebase).
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, desig.designation_name AS designation
     FROM employees e
     LEFT JOIN designation_master desig ON desig.id = e.designation_id
     WHERE e.${scopeColumn} = ? AND e.employment_status = 'active'
     ORDER BY e.full_name`,
    [scopeValue]
  );

  const missing = (empRows as RowDataPacket[]).filter(
    (e) => !importedIds.has((e.employee_code as string ?? '').toUpperCase())
  );

  return { employees: missing, total: missing.length };
}
