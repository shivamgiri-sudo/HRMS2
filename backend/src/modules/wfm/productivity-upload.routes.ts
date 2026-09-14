//
// The WFM manual upload endpoint (requirements.md Requirement 17). Two steps, both stateless
// (no server-side pending-batch storage): POST /preview parses and validates a file without
// writing anything; POST /commit re-parses the same file and actually writes. Modelled on
// attendance-apr-bulk.routes.ts's proven multer/rejection-handling pattern.

import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { resolveUserBusinessScope, type UserBusinessScope } from '../../shared/enterpriseScope.js';
import { buildUploadPreview, type UploadPreviewResult } from './productivity-upload-preview.service.js';
import { commitUploadBatch, DuplicateUploadBatchError } from './productivity-upload-commit.service.js';
import type { UploadTargetField } from './productivity-upload-parser.js';

const router = Router();
router.use(requireAuth);

const MAX_UPLOAD_MB = 2;

// A 2 MB CSV can hold roughly 50,000 rows, and buildUploadPreview() costs DB round trips per
// distinct (employee_code) and per row, so an unbounded file can hold a pooled connection for
// minutes on a pool 45 workers share (a documented incident class in this repo). Capped
// explicitly rather than left implicit at whatever the byte limit happens to allow.
const MAX_DATA_ROWS = 20000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error(
        'This upload reads CSV files only. In Excel choose File > Save As > CSV (Comma delimited) (*.csv) and upload that file.',
      ));
    }
  },
});

/**
 * Same rationale as attendance-apr-bulk.routes.ts's acceptCsvUpload(): multer raises rejections
 * as plain, statusless Errors, which the global error handler masks as an opaque 500. Answering
 * here, with a real status, keeps the actual reason visible to the uploader.
 */
function acceptCsvUpload(req: any, res: any, next: any) {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string })?.code;
    const message =
      code === 'LIMIT_FILE_SIZE'
        ? `The file is larger than ${MAX_UPLOAD_MB} MB. Split it into smaller files and upload them one at a time.`
        : code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Attach the CSV as a single file named "file".'
          : err instanceof Error && err.message
            ? err.message
            : 'The uploaded file could not be read.';
    return res.status(400).json({ success: false, message });
  });
}

/**
 * Express 4 (this backend runs 4.21) does NOT forward a rejected promise from an async route
 * handler to the error-handling middleware — that arrived in Express 5. With no
 * `express-async-errors` patch and no process-level `unhandledRejection` handler anywhere in
 * backend/src, an escaping rejection is an unhandled rejection, which on Node's default
 * `--unhandled-rejections=throw` takes the whole backend process down and drops every other
 * in-flight request. The sibling proven route (attendance-apr-bulk.routes.ts) avoids this by
 * try/catching every await individually; this wrapper does the same thing once, for the whole
 * handler, so no future edit inside a handler can reintroduce the hole by forgetting a catch.
 */
function asyncRoute(
  handler: (req: any, res: any) => Promise<unknown>,
): (req: any, res: any, next: any) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((err: unknown) => {
      if (res.headersSent) return next(err);
      console.error('[productivity-upload] unhandled error', err);
      return res.status(500).json({
        success: false,
        message: 'The upload could not be processed because of a server error. Nothing was saved for this request unless a partial-save warning was returned. Please retry, and quote the time of this attempt if it keeps failing.',
      });
    });
  };
}

/**
 * Branch scope.
 *
 * `assignment.branchId === null` does NOT mean org-wide. resolveUserBusinessScope() sets branchId
 * to null for EVERY assignment whose branch_id column is null — which is every scope_type that is
 * not branch-based: process, lob, department, manager, client, self (enterpriseScope.ts's own
 * mapper). Treating null as a wildcard, as an earlier draft did, silently granted cross-branch
 * write access to any user holding a process- or department-scoped assignment. The codebase's
 * canonical org-wide marker is scopeType === 'all' (see addAssignmentPredicates, which pushes
 * `1=1` for exactly that case and otherwise SKIPS a null branchId rather than wildcarding it).
 */
function isBranchInUploaderScope(scope: UserBusinessScope, branchId: string): boolean {
  if (scope.isSuperAdmin || scope.isAdmin) return true;
  // Truthiness, not `!== null`: a partially-built scope object can carry undefined rather than
  // null, and an empty-string id must never match either.
  return scope.assignments.some((a) => a.scopeType === 'all' || (!!a.branchId && a.branchId === branchId));
}

/**
 * Process scope. processId is stored on every productivity_upload_batch row and on every
 * apr_manual_upload row, so an unchecked processId lets a uploader legitimately scoped to branch A
 * attribute a whole batch to another branch's or another client's process. A branch-scoped
 * assignment (branch matches, no process named) legitimately covers every process in that branch,
 * which is why the branch-only assignment case is accepted here.
 */
function isProcessInUploaderScope(
  scope: UserBusinessScope,
  branchId: string,
  processId: string,
): boolean {
  if (scope.isSuperAdmin || scope.isAdmin) return true;
  return scope.assignments.some((a) => {
    if (a.scopeType === 'all') return true;
    if (a.processId) return a.processId === processId;
    return !!a.branchId && a.branchId === branchId;
  });
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict YYYY-MM-DD validation, built on UTC parts rather than a local Date. This repo has a
 * documented bug class where a local Date read back as UTC shifts the day; using Date.UTC on both
 * sides keeps the round-trip exact and rejects impossible calendar dates (2026-02-31) that the
 * regex alone accepts.
 */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

interface CsvParseOutcome {
  error?: string;
  rows: Array<{ rowNumber: number; data: Record<string, string> }>;
}

/**
 * RFC-4180-shaped CSV reader. A naive `content.split('\n')` + `line.split(',')` was rejected here
 * for four concrete reasons, each of which corrupts real Excel output:
 *  - Excel's "CSV (Comma delimited)" writes a UTF-8 BOM, which sticks to the first header
 *    ("\uFEFFEmp Code"), so the declared Column_Mapping matches nothing and EVERY row is rejected
 *    as blank — while the route's own error text tells the uploader to produce exactly that file.
 *  - A quoted field containing a comma ("Smith, John") shifts every later column by one, silently
 *    mis-assigning report_date and login_minutes rather than failing.
 *  - Filtering blank lines out BEFORE indexing makes every reported row number wrong after the
 *    first blank line, so productivity_upload_rejection.source_row_number (criterion 17.2) points
 *    a human at the wrong line.
 *  - A duplicate or blank header silently drops a column instead of saying so.
 */
function parseCsvContent(content: string): CsvParseOutcome {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;

  const endRecord = () => {
    fields.push(current);
    records.push({ line: recordStartLine, fields });
    fields = [];
    current = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        current += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { fields.push(current); current = ''; continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRecord(); line++; recordStartLine = line; continue; }
    if (ch === '\n') { endRecord(); line++; recordStartLine = line; continue; }
    current += ch;
  }
  if (inQuotes) return { error: 'The CSV has an unterminated quoted field.', rows: [] };
  if (current !== '' || fields.length > 0) endRecord();

  const isBlankRecord = (r: { fields: string[] }) => r.fields.every((f) => f.trim() === '');
  const meaningful = records.filter((r) => !isBlankRecord(r));
  if (meaningful.length === 0) return { error: 'The CSV is empty.', rows: [] };

  const headers = meaningful[0]!.fields.map((h) => h.trim());
  if (headers.some((h) => h === '')) {
    return { error: 'The CSV has a blank column header. Name every column, then upload again.', rows: [] };
  }
  const duplicates = headers.filter((h, i) => headers.indexOf(h) !== i);
  if (duplicates.length > 0) {
    return {
      error: `The CSV repeats the column header(s): ${[...new Set(duplicates)].join(', ')}. Column headers must be unique.`,
      rows: [],
    };
  }

  const rows = meaningful.slice(1).map((rec) => {
    const data: Record<string, string> = {};
    headers.forEach((h, idx) => { data[h] = (rec.fields[idx] ?? '').trim(); });
    return { rowNumber: rec.line, data };
  });
  return { rows };
}

interface UploadRequestFields {
  diallerSourceId: string;
  branchId: string;
  processId: string;
  dateFrom: string;
  dateTo: string;
  columnMappings: Record<string, string>;
}

// The full UploadTargetField set, as runtime values. The parser exports the union as a TYPE and
// only the mandatory subset as a value, and this file deliberately does not edit the parser (a
// Phase 3 file already merged to main). The assertion below is a compile-time proof that this
// list covers every union member: if the parser ever adds a target field and this list is not
// updated, `_assertAllTargetFieldsCovered` stops typechecking — rather than the new field being
// silently rejected as "unknown" at runtime.
const UPLOAD_TARGET_FIELDS = [
  'employee_code', 'report_date', 'login_minutes', 'calls_handled', 'aht_seconds',
  'bio_minutes', 'lunch_minutes', 'qa_minutes', 'training_minutes',
] as const satisfies readonly UploadTargetField[];
type _UncoveredTargetField = Exclude<UploadTargetField, (typeof UPLOAD_TARGET_FIELDS)[number]>;
const _assertAllTargetFieldsCovered: [_UncoveredTargetField] extends [never] ? true : never = true;
void _assertAllTargetFieldsCovered;

const VALID_TARGET_FIELDS = new Set<string>(UPLOAD_TARGET_FIELDS);

function readRequestFields(body: any): UploadRequestFields | { error: string } {
  const { diallerSourceId, branchId, processId, dateFrom, dateTo, columnMappings } = body;
  if (!diallerSourceId || !branchId || !processId || !dateFrom || !dateTo || !columnMappings) {
    return { error: 'diallerSourceId, branchId, processId, dateFrom, dateTo and columnMappings are all required' };
  }
  let parsedMappings: unknown;
  try {
    parsedMappings = typeof columnMappings === 'string' ? JSON.parse(columnMappings) : columnMappings;
  } catch {
    return { error: 'columnMappings must be valid JSON' };
  }
  // JSON.parse('null') is null, JSON.parse('123') is a number, and both are truthy as the raw
  // form string that reached the guard above — so without this check they flow straight into
  // checkMappingCoversMandatoryFields(), whose first statement is Object.values(mappings) and
  // throws a TypeError on null. That made a one-line curl a remote crash of the whole process.
  if (
    parsedMappings === null ||
    typeof parsedMappings !== 'object' ||
    Array.isArray(parsedMappings)
  ) {
    return { error: 'columnMappings must be a JSON object of {"csv header": "target field"}' };
  }
  const mappings: Record<string, string> = {};
  for (const [header, target] of Object.entries(parsedMappings as Record<string, unknown>)) {
    if (typeof target !== 'string' || !VALID_TARGET_FIELDS.has(target)) {
      return {
        error: `columnMappings maps "${header}" to an unknown target field. Valid target fields: ${UPLOAD_TARGET_FIELDS.join(', ')}`,
      };
    }
    mappings[header] = target;
  }

  if (!isValidIsoDate(String(dateFrom)) || !isValidIsoDate(String(dateTo))) {
    return { error: 'dateFrom and dateTo must be real calendar dates in YYYY-MM-DD format' };
  }
  if (String(dateFrom) > String(dateTo)) {
    return { error: 'dateFrom must not be after dateTo' };
  }

  return {
    diallerSourceId: String(diallerSourceId),
    branchId: String(branchId),
    processId: String(processId),
    dateFrom: String(dateFrom),
    dateTo: String(dateTo),
    columnMappings: mappings,
  };
}

/**
 * Moves any accepted row whose report_date is not a real YYYY-MM-DD date, or falls outside the
 * declared [dateFrom, dateTo] window, into the rejected list.
 *
 * Two separate defects close here. First, an unvalidated report_date reaches a strict-mode DATE
 * column, where one "15/07/2026" cell raises ER_TRUNCATED_WRONG_VALUE that fails the whole
 * 300-row chunk — 299 good rows discarded for one bad cell. Second, the declared window was
 * previously never checked against the rows themselves, so a file could be committed under any
 * window at all. Applied identically on /preview and /commit so the preview a human approves is
 * the same set the commit writes.
 */
function applyDateWindow(
  preview: UploadPreviewResult,
  dateFrom: string,
  dateTo: string,
): UploadPreviewResult {
  const accepted: typeof preview.accepted = [];
  const rejected = [...preview.rejected];
  for (const row of preview.accepted) {
    if (!isValidIsoDate(row.reportDate)) {
      rejected.push({
        rowNumber: row.rowNumber,
        employeeCode: row.employeeCode,
        reason: `report_date "${row.reportDate}" is not a real date in YYYY-MM-DD format`,
      });
      continue;
    }
    if (row.reportDate < dateFrom || row.reportDate > dateTo) {
      rejected.push({
        rowNumber: row.rowNumber,
        employeeCode: row.employeeCode,
        reason: `report_date ${row.reportDate} falls outside the declared upload window ${dateFrom} to ${dateTo}`,
      });
      continue;
    }
    accepted.push(row);
  }
  rejected.sort((a, b) => a.rowNumber - b.rowNumber);
  return { accepted, rejected };
}

type PreparedRequest =
  | { ok: false; status: number; message: string }
  | { ok: true; fields: UploadRequestFields; preview: UploadPreviewResult };

/**
 * Everything /preview and /commit do identically, in one place, so the two endpoints cannot
 * validate differently — a divergence would mean a human approves one row set and a different one
 * is written.
 */
async function prepareUpload(req: any): Promise<PreparedRequest> {
  if (!req.file) return { ok: false, status: 400, message: 'No CSV file uploaded' };

  const fields = readRequestFields(req.body);
  if ('error' in fields) return { ok: false, status: 400, message: fields.error };

  const scope = await resolveUserBusinessScope(req.authUser);
  if (!isBranchInUploaderScope(scope, fields.branchId)) {
    return { ok: false, status: 403, message: 'This branch is outside your resolved scope' };
  }
  if (!isProcessInUploaderScope(scope, fields.branchId, fields.processId)) {
    return { ok: false, status: 403, message: 'This process is outside your resolved scope' };
  }

  const parsed = parseCsvContent(req.file.buffer.toString('utf-8'));
  if (parsed.error) return { ok: false, status: 400, message: parsed.error };
  if (parsed.rows.length === 0) {
    return { ok: false, status: 400, message: 'The CSV has a header row but no data rows.' };
  }
  if (parsed.rows.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      status: 400,
      message: `The CSV holds ${parsed.rows.length} data rows; the limit is ${MAX_DATA_ROWS}. Split it and upload the parts separately.`,
    };
  }

  const rawPreview = await buildUploadPreview(parsed.rows, fields.columnMappings, fields.diallerSourceId);
  if (rawPreview.mappingError) {
    return {
      ok: false,
      status: 400,
      message: `Column mapping is missing required field(s): ${rawPreview.mappingError.missingFields.join(', ')}`,
    };
  }

  return { ok: true, fields, preview: applyDateWindow(rawPreview, fields.dateFrom, fields.dateTo) };
}

// Kept as one list used by both endpoints so /preview and /commit cannot drift apart, and so the
// set this route enforces can be compared directly against migration 1639's role_page_access
// grants (they must agree — a role that can POST but holds no grant is invisible on the access
// screen while being fully able to write attendance-feeding rows). NOTE requireRole() expands
// ROLE_ALIASES, so 'wfm' here also admits 'wfm_analyst'; 1639 grants that role explicitly for
// exactly that reason.
const UPLOAD_ROLES: string[] = ['wfm', 'branch_head', 'hr', 'payroll_head', 'super_admin', 'admin'];

// migration 1636's own vocabulary: dialler_source.ingestion_mode is
// ENUM('integrated_pull','manual_upload'), and only the manual_upload half can be uploaded to by
// hand. An integrated_pull source is served by Phase 3's ingestion job, so offering one in this
// picker would let a human submit a file against a source whose rows arrive by API — two writers
// for the same (source, employee, date) with no reconciliation between them.
const MANUAL_UPLOAD_MODE = 'manual_upload';

interface DiallerSourceListRow extends RowDataPacket {
  id: string;
  source_key: string;
  display_name: string;
  ingestion_mode: 'integrated_pull' | 'manual_upload';
  // dialler_source_column_mapping.column_mappings is a JSON column. mysql2 hands a JSON column
  // back already parsed as an object, but the driver returns a string when the column is served
  // through anything that types it as text, so both shapes are handled. NULL when the LEFT JOIN
  // found no mapping row.
  column_mappings: string | Record<string, unknown> | null;
  mapping_version: number | null;
}

/**
 * Turns a stored column_mappings blob into the flat {"csv header": "target field"} object the
 * frontend hands straight back to /preview and /commit, or null when the blob cannot be trusted.
 *
 * Defensive on purpose. The write path for these rows is a later admin screen, so nothing has
 * validated what is in this column yet, and a JSON column can legitimately hold `null`, a scalar
 * or an array — none of which are a mapping. A throw here would take out the whole picker
 * response for every other source because of one bad row, which is the opposite of useful: the
 * uploader could not even see which source is broken. A null mapping is a shape the frontend
 * already has to handle (a source with no mapping row yet), so a bad blob degrades into that
 * same case rather than into a 500.
 */
function readColumnMappings(raw: unknown): Record<string, string> | null {
  if (raw === null || raw === undefined) return null;

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const mappings: Record<string, string> = {};
  for (const [header, target] of Object.entries(parsed as Record<string, unknown>)) {
    // A non-string target is not a target field, and readRequestFields() below would reject it
    // anyway once the frontend echoed it back. Treated as a malformed blob rather than silently
    // dropped, so the caller sees "this source has no usable mapping" instead of a mapping that
    // quietly lost a column.
    if (typeof target !== 'string') return null;
    mappings[header] = target;
  }
  return mappings;
}

/**
 * Lists the registered Dialler_Sources a human may upload a report for, each with its current
 * Column_Mapping (criteria 16.12-16.14). Without this, /preview and /commit are undrivable from a
 * UI: both require a diallerSourceId and a full columnMappings object, and nothing else exposes
 * either over HTTP.
 *
 * Behind the same requireRole(...UPLOAD_ROLES) gate as /preview and /commit, deliberately: this
 * response names every source, its stable code and its mapping — the shape of the business's
 * productivity feeds — and the set of people who may see that is the set who may upload.
 *
 * Only active_status = 1 is filtered, NOT the effective-date window that
 * resolveActiveDiallerSource() applies. That helper answers "may this source contribute a row on
 * this date", which is a per-row question with a date to answer it against; this endpoint is
 * populating a picker before any date window is chosen, and a manual upload is routinely a
 * backfill for a past month. Hiding a source whose effective_to has passed would make those
 * backfills unsubmittable while showing one costs nothing.
 */
router.get(
  '/sources',
  requireRole(...UPLOAD_ROLES),
  asyncRoute(async (_req: any, res: any) => {
    let rows: DiallerSourceListRow[];
    try {
      // One row per source guaranteed by uq_dscm (dialler_source_id, mapping_version) in
      // migration 1636: the join pins mapping_version to the highest ACTIVE version, and that
      // pair is unique, so no source can be duplicated by a second mapping row. Amending a
      // mapping bumps mapping_version, so "highest active version" is the current mapping.
      const [result] = await db.execute<DiallerSourceListRow[]>(
        `SELECT s.id, s.source_key, s.display_name, s.ingestion_mode,
                m.column_mappings, m.mapping_version
           FROM dialler_source s
           LEFT JOIN dialler_source_column_mapping m
                  ON m.dialler_source_id = s.id
                 AND m.active_status = 1
                 AND m.mapping_version = (
                       SELECT MAX(m2.mapping_version)
                         FROM dialler_source_column_mapping m2
                        WHERE m2.dialler_source_id = s.id
                          AND m2.active_status = 1
                     )
          WHERE s.active_status = 1
            AND s.ingestion_mode = ?
          ORDER BY s.display_name ASC, s.source_key ASC`,
        [MANUAL_UPLOAD_MODE],
      );
      rows = result;
    } catch (err) {
      // Answered here rather than left to asyncRoute()'s catch only so the message fits a read:
      // asyncRoute's text talks about what was or was not saved, which is meaningless on a GET
      // and reads as though an upload had been attempted. Driver text is logged, never returned —
      // the same convention the rest of this file follows.
      console.error('[productivity-upload] /sources query failed', err);
      return res.status(500).json({
        success: false,
        message: 'The list of dialler sources could not be loaded because of a server error. Please retry.',
      });
    }

    const sources = rows.map((row) => {
      const columnMappings = readColumnMappings(row.column_mappings);
      const rawVersion = Number(row.mapping_version);
      return {
        diallerSourceId: row.id,
        sourceCode: row.source_key,
        displayName: row.display_name,
        sourceType: row.ingestion_mode,
        columnMappings,
        // Kept in lockstep with columnMappings: a version number alongside a null mapping would
        // invite the caller to POST /commit with mappingVersionUsed set for a mapping it never
        // received, mislabelling the batch's audit trail.
        mappingVersion: columnMappings === null || !Number.isFinite(rawVersion) ? null : rawVersion,
      };
    });

    return res.json({ success: true, sources });
  }),
);

router.post(
  '/preview',
  requireRole(...UPLOAD_ROLES),
  acceptCsvUpload,
  asyncRoute(async (req: any, res: any) => {
    const prepared = await prepareUpload(req);
    if (!prepared.ok) return res.status(prepared.status).json({ success: false, message: prepared.message });
    return res.json({ success: true, accepted: prepared.preview.accepted, rejected: prepared.preview.rejected });
  }),
);

router.post(
  '/commit',
  requireRole(...UPLOAD_ROLES),
  acceptCsvUpload,
  asyncRoute(async (req: any, res: any) => {
    const prepared = await prepareUpload(req);
    if (!prepared.ok) return res.status(prepared.status).json({ success: false, message: prepared.message });
    const { fields, preview } = prepared;

    const contentDigest = createHash('sha256').update(req.file.buffer).digest('hex');
    // productivity_upload_batch.mapping_version_used is SMALLINT UNSIGNED (migration 1638). An
    // out-of-range value (-5, 99999) raises error 1264 on the FINAL batch INSERT — after every
    // apr_manual_upload row has already landed — leaving orphan rows with no batch and no audit
    // trail. Clamped here rather than trusted.
    const rawVersion = Number(req.body.mappingVersionUsed);
    const mappingVersionUsed =
      Number.isFinite(rawVersion) && rawVersion >= 1 && rawVersion <= 65535
        ? Math.floor(rawVersion)
        : 1;
    const supersedesBatchId: string | undefined = req.body.supersedesBatchId
      ? String(req.body.supersedesBatchId)
      : undefined;

    // commitUploadBatch() throws DuplicateUploadBatchError, not a plain Error, when its
    // duplicate-submission guard fires (an identical file+scope was already committed and this
    // request did not declare itself a re-upload via supersedesBatchId). That is an expected,
    // actionable outcome — not a server fault — so it is caught here and turned into 409 with the
    // guard's own message (which already names the prior batch id the caller needs to pass back
    // as supersedesBatchId to force it through). Matched by `instanceof`, not by a message
    // substring: an earlier draft matched on message text, which coupled the route to a string
    // the service could reword without this file's own tests noticing, silently degrading a real
    // duplicate submission back into a masked 500 (caught in a round-4 review). Any other error
    // from commitUploadBatch is a genuine unexpected failure and is deliberately rethrown — now
    // to asyncRoute()'s catch, which answers 500, rather than to an Express 4 error handler that
    // would never have seen it.
    let result;
    try {
      result = await commitUploadBatch({
        diallerSourceId: fields.diallerSourceId,
        branchId: fields.branchId,
        processId: fields.processId,
        dateFrom: fields.dateFrom,
        dateTo: fields.dateTo,
        fileName: req.file.originalname,
        contentDigest,
        uploadedBy: req.authUser.id,
        mappingVersionUsed,
        supersedesBatchId,
        acceptedRows: preview.accepted,
        rejectedRows: preview.rejected,
      });
    } catch (err) {
      if (err instanceof DuplicateUploadBatchError) {
        return res.status(409).json({ success: false, message: err.message, priorBatchId: err.priorBatchId });
      }
      throw err;
    }

    // success must reflect whether every row that made it past the preview actually landed in
    // the database — NOT merely that commitUploadBatch() returned without throwing. A chunk
    // write failure (writeErrors non-empty) is a partial failure the caller must see and retry,
    // not a silent 200. A file whose every row was rejected is also not a success: nothing was
    // contributed, and reporting 200/true there tells an uploader their data is in when it is not.
    const partiallyFailed = result.writeErrors.length > 0;
    const nothingAccepted = result.acceptedCount === 0;
    return res.status(partiallyFailed ? 207 : 200).json({
      success: !partiallyFailed && !nothingAccepted,
      ...result,
    });
  }),
);

export { router as productivityUploadRouter };
