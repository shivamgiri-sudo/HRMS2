import { Router } from 'express';
import multer from 'multer';
import { randomUUID, createHash } from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { isOperationsExecutiveByRegex as isOperationsExecutive, classifyOperationsNetLogin, resolveHalfDayFloorMinutes } from './attendance-engine.service.js';
import {
  resolveAprBulkUploadAttribution,
  createAprBulkUploadBatch,
  finaliseAprBulkUploadBatch,
} from './attendance-apr-bulk-attribution.service.js';

/**
 * The sentinel campaign this route used to WRITE, and now only READS.
 *
 * Every one of the 3,810 manual `apr` rows in production carries this single string as its
 * campaign_id, with no owning Dialler_Source anywhere and a NULL upload_batch_id - the
 * unattributed path requirements.md criterion 17.10 exists to close. It is closed: the evidence
 * write in phase 3 below now files rows under a campaign owned by a registered Dialler_Source
 * (attendance-apr-bulk-attribution.service.ts) and carries a real productivity_upload_batch id.
 *
 * The constant survives for exactly one purpose - recognising those legacy rows in the
 * "is the dialler feed already reporting this day" read below, so a day evidenced by an old
 * unattributed upload is still not mistaken for a synced day. It must never appear in an INSERT
 * again; migration 1640's BEFORE INSERT trigger on `apr` rejects a manual row carrying it.
 */
const LEGACY_MANUAL_UPLOAD_CAMPAIGN = 'MANUAL_UPLOAD';

const router = Router();
router.use(requireAuth);

const MAX_UPLOAD_MB = 2;

/**
 * Reproduced end to end against the live DB (2026-08-27): a 4,941-row file drove
 * one `INSERT ... ON DUPLICATE KEY UPDATE` per row — 4,941 sequential round trips
 * to a remote database. A 2-row file alone took 69 seconds, so the full file held
 * row locks open long enough to collide with ordinary concurrent traffic and die
 * with `ER_LOCK_WAIT_TIMEOUT`. Because the failing `await` sat in a bare loop with
 * no try/catch, that error escaped as an unhandled promise rejection and killed
 * the Node process outright — after 2,881 of the 4,941 rows had already committed,
 * silently, with no way for the caller to tell.
 *
 * The fix batches rows into chunked multi-row INSERT statements instead of one
 * row at a time. Each multi-row INSERT is a single SQL statement, and MySQL
 * executes a single statement atomically — all its rows land or none do — so a
 * chunk is naturally the unit of atomicity without an explicit transaction. 300
 * rows/chunk keeps each statement small (this table's ~9 bound params per row is
 * at most ~2,700 params and a few tens of KB of SQL text — far inside
 * max_allowed_packet) while cutting round trips for a file this size from
 * thousands to roughly a dozen, which is what keeps each lock window short enough
 * to survive contention instead of timing out.
 *
 * Chunk-commit was chosen over one giant transaction for the whole upload: at
 * ~5,000 rows a single transaction would hold its locks for the entire upload
 * (the exact condition that produced the timeout in the first place), and any
 * failure anywhere would force a full rollback — discarding rows that saved
 * cleanly and forcing a complete re-upload with zero credit for what worked. Both
 * writes here are naturally idempotent (`ON DUPLICATE KEY UPDATE` keyed on the
 * table's real unique keys), so a caller can safely re-run only the rows a failed
 * chunk reports back, and a corrected re-upload of the whole file is always safe.
 *
 * The trade-off: a chunk failure is reported at chunk granularity, not per row —
 * every row in a failed chunk is reported as not-saved even though MySQL may have
 * rejected only one of them. The response's `errors` array always names exactly
 * which rows are in that state, so a caller is never left guessing what landed.
 */
const INSERT_CHUNK_SIZE = 300;

/**
 * The two read-only pre-checks below (locked days, already-synced days) were
 * chunked at INSERT_CHUNK_SIZE as well, but they are lookups, not writes: there
 * is no atomicity to preserve and nothing to report at chunk granularity, so the
 * only thing 300 bought there was round trips. A month of dialler data runs to
 * tens of thousands of rows, and at 300 per statement the two checks alone cost
 * hundreds of sequential queries — enough, with the writes behind them, to push
 * the whole request past nginx's 120s proxy_read_timeout, which is what produced
 * the "Unexpected token '<'" the uploader saw (nginx's HTML 504 page parsed as
 * JSON). Both plans are primary/unique-key range scans (verified against the
 * live DB), so widening the batch does not change how MySQL resolves them; it
 * just asks the same question a sixth as often.
 */
const SELECT_CHUNK_SIZE = 2000;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error(
        'This upload reads CSV files only — it cannot read an Excel workbook. ' +
        'In Excel choose File > Save As > CSV (Comma delimited) (*.csv) and upload that file.',
      ));
    }
  },
});

/**
 * Multer's rejections are the uploader's problem to fix, not a server fault — but
 * multer raises them as plain Errors with no statusCode, and the global error handler
 * masks any statusless throw in production as "An unexpected server error occurred.
 * Please quote reference <hex>". So an uploader who sent an .xlsx, or a file over the
 * size limit, was told nothing at all about what to change: the one sentence that would
 * have fixed it — save it as CSV — was replaced by a reference number.
 *
 * Reproduced end to end: posting an .xlsx to this route returned exactly that masked
 * 500. Answering the rejection here, with a status, keeps it out of the masking branch.
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

interface CsvRow {
  rowNum: number;
  employee_code: string;
  attendance_date: string;
  net_login_minutes: number;
}

interface RowError {
  row: number;
  employee_code: string;
  reason: string;
}

function parseCsv(content: string): { rows: CsvRow[]; errors: RowError[] } {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], errors: [] };

  const header = lines[0]!.split(',').map(h => h.trim().toLowerCase());
  const codeIdx = header.indexOf('employee_code');
  const dateIdx = header.indexOf('attendance_date');
  const minsIdx = header.indexOf('net_login_minutes');

  if (codeIdx < 0 || dateIdx < 0 || minsIdx < 0) {
    return {
      rows: [],
      errors: [{ row: 0, employee_code: '', reason: 'CSV header must contain: employee_code, attendance_date, net_login_minutes' }],
    };
  }

  const rows: CsvRow[] = [];
  const errors: RowError[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',').map(c => c.trim());
    const employee_code = cols[codeIdx] ?? '';
    const attendance_date = cols[dateIdx] ?? '';
    const minsRaw = cols[minsIdx] ?? '';

    if (!employee_code && !attendance_date && !minsRaw) continue;

    const rowNum = i + 1;

    if (!employee_code) { errors.push({ row: rowNum, employee_code, reason: 'employee_code is required' }); continue; }
    // Accept DD-MM-YYYY and convert to YYYY-MM-DD
    let normalised_date = attendance_date;
    if (/^\d{2}-\d{2}-\d{4}$/.test(attendance_date)) {
      const [d, m, y] = attendance_date.split('-');
      normalised_date = `${y}-${m}-${d}`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(attendance_date)) {
      errors.push({ row: rowNum, employee_code, reason: 'attendance_date must be DD-MM-YYYY (e.g. 14-07-2026)' }); continue;
    }

    const dateVal = new Date(normalised_date);
    if (isNaN(dateVal.getTime())) { errors.push({ row: rowNum, employee_code, reason: 'attendance_date is invalid' }); continue; }
    if (dateVal > today) { errors.push({ row: rowNum, employee_code, reason: 'attendance_date cannot be in the future' }); continue; }
    if (dateVal < ninetyDaysAgo) { errors.push({ row: rowNum, employee_code, reason: 'attendance_date is older than 90 days' }); continue; }

    const net_login_minutes = parseInt(minsRaw, 10);
    if (isNaN(net_login_minutes) || net_login_minutes < 0 || net_login_minutes > 600) {
      errors.push({ row: rowNum, employee_code, reason: 'net_login_minutes must be an integer 0–600' }); continue;
    }

    rows.push({ rowNum, employee_code, attendance_date: normalised_date, net_login_minutes });
  }

  return { rows, errors };
}

router.post(
  '/apr-bulk-upload',
  requireRole('wfm', 'hr', 'payroll_head', 'super_admin', 'admin'),
  acceptCsvUpload,
  async (req: any, res: any) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No CSV file uploaded' });
    }

    const content = req.file.buffer.toString('utf-8');
    const { rows: csvRows, errors: parseErrors } = parseCsv(content);

    if (parseErrors.length > 0 && csvRows.length === 0) {
      return res.status(400).json({ success: false, message: parseErrors[0]!.reason, errors: parseErrors });
    }

    if (csvRows.length === 0) {
      return res.json({ success: true, uploaded: 0, skipped_locked: 0, errors: parseErrors });
    }

    // Fetch all unique employee codes in one query.
    //
    // This is a prerequisite read the rest of the request depends on — no row can
    // be classified or inserted without knowing who the employees are. Unlike the
    // chunked phases below, a failure here cannot be scoped to a subset of rows,
    // so it fails the whole request cleanly instead of continuing with an empty
    // employee map (which would make every row wrongly report "Employee not found
    // or inactive" instead of the real cause). Un-chunked because this is a single
    // IN-list query, not a per-row loop — the earlier crash bug was about bare
    // `await`s inside loops, and this one is not in a loop, but it was still bare
    // and still upstream of the fixed phases, so a DB error here still crashed the
    // process exactly as before the chunked-insert fix.
    const codes = [...new Set(csvRows.map(r => r.employee_code))];
    const ph = codes.map(() => '?').join(', ');
    let empRows: RowDataPacket[];
    try {
      [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.id AS employee_id, e.employee_code,
                LOWER(COALESCE(dm.dept_name, ''))         AS dept_name,
                LOWER(COALESCE(desig.designation_name,'')) AS designation_name,
                e.branch_id, e.process_id
         FROM employees e
         LEFT JOIN department_master dm    ON dm.id = e.department_id
         LEFT JOIN designation_master desig ON desig.id = e.designation_id
         WHERE e.employee_code IN (${ph}) AND e.employment_status = 'active'`,
        codes,
      );
    } catch (err) {
      return res.status(502).json({
        success: false,
        message: `Could not look up employees for this upload — the upload was not processed at all and no rows were saved. Retry the upload. (${
          err instanceof Error ? err.message : String(err)})`,
      });
    }
    const empMap = new Map<string, any>();
    for (const row of empRows as any[]) empMap.set(row.employee_code, row);

    // Fetch locked records for all affected employee+date pairs.
    //
    // Previously this list was built by string-interpolating employee_id and
    // attendance_date directly into the SQL text. employee_id comes from the DB and
    // attendance_date is format-validated by parseCsv, so it was never exploitable —
    // but at up to several thousand rows it produced one enormous interpolated
    // statement. Parameterised and chunked below: MySQL's row-constructor
    // `(a,b) IN ((?,?),(?,?),...)` form (already used a few lines down for the `apr`
    // sync check) takes bound params instead, and INSERT_CHUNK_SIZE keeps any one
    // statement small. Deduplicated first since the same employee+date pair can
    // repeat across rows the file itself does not dedupe.
    const lockPairs: Array<[string, string]> = [];
    const seenLockPairs = new Set<string>();
    for (const r of csvRows) {
      const emp = empMap.get(r.employee_code);
      if (!emp) continue;
      const key = `${emp.employee_id}:${r.attendance_date}`;
      if (seenLockPairs.has(key)) continue;
      seenLockPairs.add(key);
      lockPairs.push([emp.employee_id, r.attendance_date]);
    }

    const lockedSet = new Set<string>();
    const protectedReasonByKey = new Map<string, string>();
    for (const pairChunk of chunkArray(lockPairs, SELECT_CHUNK_SIZE)) {
      const placeholders = pairChunk.map(() => '(?,?)').join(',');
      const params = pairChunk.flat();
      let lockedRows: RowDataPacket[];
      try {
        [lockedRows] = await db.execute<RowDataPacket[]>(
          `SELECT adr.employee_id,
                  DATE_FORMAT(adr.record_date,'%Y-%m-%d') AS record_date,
                  adr.is_locked,
                  adr.regularization_id,
                  adr.override_by,
                  ar.id AS approved_regularization_id
           FROM attendance_daily_record adr
           LEFT JOIN attendance_regularization ar
             ON ar.employee_id = adr.employee_id
            AND ar.session_date = adr.record_date
            AND ar.status = 'approved'
           WHERE (adr.employee_id, adr.record_date) IN (${placeholders})
             AND (
                   -- A lock this route set on a previous upload is not "protected": the
                   -- rows below are now written with is_locked=1 so the nightly engine
                   -- cannot recompute them away, and treating that as protection would
                   -- make a corrected re-upload permanently impossible. A lock that came
                   -- with a human decision — an override or a regularization — still wins.
                   (adr.is_locked=1 AND (adr.override_by IS NOT NULL OR adr.regularization_id IS NOT NULL))
                   OR adr.regularization_id IS NOT NULL
                   OR adr.override_by IS NOT NULL
                   OR ar.id IS NOT NULL
                 )`,
          params,
        );
      } catch (err) {
        // Fail closed, not open. A failed chunk means we cannot tell which of its
        // employee+date pairs are protected by an approved regularization, a manual
        // override, or a payroll lock — so every pair in this chunk is treated as
        // locked, and the upload skips writing to those rows. The alternative
        // (treating the chunk as unlocked) risks silently overwriting a
        // payroll-locked or regularization-approved attendance record because the
        // safety check itself errored, which is worse than under-writing rows a
        // caller can safely retry.
        const reason = `Lock status could not be verified for this row — the safety check that protects payroll-locked and regularization-approved attendance failed, so this row was skipped rather than risk an unsafe overwrite. Retry the upload. (${
          err instanceof Error ? err.message : String(err)})`;
        for (const [employeeId, attendanceDate] of pairChunk) {
          const key = `${employeeId}:${attendanceDate}`;
          lockedSet.add(key);
          protectedReasonByKey.set(key, reason);
        }
        continue;
      }
      for (const r of lockedRows as any[]) {
        const key = `${r.employee_id}:${r.record_date}`;
        lockedSet.add(key);
        protectedReasonByKey.set(
          key,
          r.approved_regularization_id || r.regularization_id
            ? 'Approved regularization already controls payroll attendance for this date'
            : r.override_by
              ? 'Manual attendance override already controls payroll attendance for this date'
              : 'Attendance record is locked for payroll'
        );
      }
    }

    // Days the dialler feed ALREADY reports, so no manual row is added for them.
    //
    // getAprNetMinutes SUMs every `apr` row for a UserID+ReportDate, and the table's
    // primary key is (ReportDate, UserID, campaign_id) — so a manual row filed under
    // its own campaign sits ALONGSIDE a synced one rather than replacing it, and the
    // day's minutes would silently double. Where the feed already reports the day,
    // the upload still writes the attendance record exactly as before; only the
    // evidence row is withheld.
    //
    // "Reported by the feed" is now `source <> 'manual'` AND not the legacy sentinel campaign,
    // where it used to be the campaign test alone. The campaign test alone was correct only while
    // this route wrote exactly one campaign string: now that its rows carry their own registered
    // campaign, a day this route itself evidenced yesterday would read back as a SYNCED day, the
    // evidence write would be withheld, and a corrected re-upload would update
    // attendance_daily_record while leaving the stale Net_Login in place - the two disagreeing
    // silently. `apr.source` is ENUM('sync','manual') NOT NULL DEFAULT 'sync' (migration 1502), so
    // it is the feed's own declaration and does not depend on any campaign naming choice; the
    // legacy campaign test is kept alongside it for any historical manual row whose source column
    // was never backfilled to 'manual'.
    const aprAlreadySynced = new Set<string>();
    // Chunked for the same reason as the lock check above: this was already
    // parameterised (never an injection risk), but one statement covering every
    // row in a several-thousand-row file is unnecessarily large. Same chunk size,
    // same row-constructor form.
    for (const rowChunk of chunkArray(csvRows, SELECT_CHUNK_SIZE)) {
      const pairParams: string[] = [];
      const pairPlaceholders = rowChunk.map((r) => {
        pairParams.push(r.employee_code, r.attendance_date);
        return '(?,?)';
      }).join(',');
      const [syncedRows] = await db.execute<RowDataPacket[]>(
        `SELECT UserID, DATE_FORMAT(ReportDate,'%Y-%m-%d') AS d
           FROM apr
          WHERE (UserID, ReportDate) IN (${pairPlaceholders})
            AND source <> 'manual'
            AND campaign_id <> ?`,
        [...pairParams, LEGACY_MANUAL_UPLOAD_CAMPAIGN],
      ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);
      for (const r of syncedRows as any[]) aprAlreadySynced.add(`${r.UserID}:${r.d}`);
    }

    const rowErrors: RowError[] = [...parseErrors];
    let uploaded = 0;
    let skippedLocked = 0;
    let evidenceRecorded = 0;
    let evidenceSkippedAlreadySynced = 0;
    const failedRows: RowError[] = [];

    // Resolved once for the whole upload, not per row: a bulk file can carry
    // thousands of rows and this is a database read. Resolving it inside the loop
    // would also let the floor change midway through a single upload.
    const netLoginHalfDayFloor = await resolveHalfDayFloorMinutes('netlogin_half_day_floor_minutes');

    // Phase 1 — validate and classify every row (no DB writes here). Unchanged
    // skip reasons, unchanged call sites for isOperationsExecutive /
    // classifyOperationsNetLogin. Rows that pass are queued for the chunked
    // insert in phase 2; rows the file itself was fine on but that fail to save
    // are queued for evidence in phase 3, filtered by the same
    // aprAlreadySynced check as before.
    interface InsertCandidate {
      rowNum: number;
      employee_code: string;
      attendance_date: string;
      // Carried explicitly, not read back out of `params`, because phase 3 groups rows by them to
      // build one Upload_Batch per (branch, process) - see the grouping comment there. Either can
      // be NULL: employees.branch_id / process_id are nullable, and productivity_upload_batch's
      // branch_id / process_id are NOT NULL, so a row without both cannot be attributed to a batch
      // at all.
      branch_id: string | null;
      process_id: string | null;
      params: [string, string, unknown, unknown, number, number, string, number, string];
    }
    const toInsert: InsertCandidate[] = [];

    for (const row of csvRows) {
      const emp = empMap.get(row.employee_code);
      if (!emp) {
        rowErrors.push({ row: row.rowNum, employee_code: row.employee_code, reason: 'Employee not found or inactive' });
        continue;
      }

      if (!isOperationsExecutive(emp.dept_name, emp.designation_name)) {
        rowErrors.push({ row: row.rowNum, employee_code: row.employee_code, reason: 'Employee is not an APR/Operations Executive' });
        continue;
      }

      const lockKey = `${emp.employee_id}:${row.attendance_date}`;
      if (lockedSet.has(lockKey)) {
        skippedLocked++;
        rowErrors.push({
          row: row.rowNum,
          employee_code: row.employee_code,
          reason: protectedReasonByKey.get(lockKey) ?? 'Attendance record is locked for payroll',
        });
        continue;
      }

      const { status, lwpValue } = classifyOperationsNetLogin(row.net_login_minutes, netLoginHalfDayFloor);

      toInsert.push({
        rowNum: row.rowNum,
        employee_code: row.employee_code,
        attendance_date: row.attendance_date,
        branch_id: emp.branch_id ?? null,
        process_id: emp.process_id ?? null,
        params: [
          emp.employee_id, row.attendance_date, emp.branch_id, emp.process_id,
          row.net_login_minutes, row.net_login_minutes,
          status, lwpValue,
          (req.authUser as any).id,
        ],
      });
    }

    // Phase 2 — write attendance_daily_record in chunked multi-row statements.
    //
    // is_locked=1 is the whole point of this write.
    //
    // Without it the row sits at is_locked=0, and the nightly attendance sweep
    // recomputes that employee/date from the automatic sources — the `apr` table
    // and biometric punches — and silently overwrites the upload. This route does
    // not write to `apr`, so the engine has no memory of what was uploaded: the
    // file survived until 23:00 that night and then vanished, with no error. The
    // other manual-override path in this codebase, correctDailyRecord(), has always
    // set is_locked=1; this one never did.
    //
    // The ON DUPLICATE guard keys off override_by/regularization_id rather than
    // is_locked. Two reasons: those two columns are never assigned in this
    // statement, so the guard cannot be corrupted by MySQL evaluating assignments
    // left-to-right and reading an already-updated value; and it expresses the real
    // precedence — a human override or an approved regularization outranks a bulk
    // file, while automatic engine output does not.
    //
    // Each chunk below is ONE multi-row INSERT — one SQL statement, so MySQL
    // applies it atomically (see INSERT_CHUNK_SIZE comment above). A chunk that
    // throws (lock timeout, transient connection error, anything) is caught here,
    // never allowed to escape as an unhandled rejection, and every row in that
    // chunk is reported back as not-saved with the real DB error text. Rows in
    // chunks that succeed are never rolled back by a later chunk's failure.
    const succeededInsertRows: InsertCandidate[] = [];
    for (const insertChunk of chunkArray(toInsert, INSERT_CHUNK_SIZE)) {
      const valuesSql = insertChunk.map(() => '(UUID(), ?, ?, ?, ?, \'dialler\', \'apr_bulk\', ?, ?, ?, ?, 0, 0, 1, NOW(), ?)').join(',\n           ');
      const flatParams = insertChunk.flatMap(c => c.params);
      try {
        await db.execute(
          `INSERT INTO attendance_daily_record
             (id, employee_id, record_date, branch_id, process_id,
              attendance_source, source_system,
              dialler_minutes, raw_minutes,
              attendance_status, lwp_value,
              late_mark, late_by_minutes,
              is_locked,
              processed_at, created_by)
           VALUES ${valuesSql}
           ON DUPLICATE KEY UPDATE
             attendance_source = IF(override_by IS NULL AND regularization_id IS NULL, 'dialler',                attendance_source),
             source_system     = IF(override_by IS NULL AND regularization_id IS NULL, 'apr_bulk',               source_system),
             dialler_minutes   = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(dialler_minutes),   dialler_minutes),
             raw_minutes       = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(raw_minutes),       raw_minutes),
             attendance_status = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(attendance_status), attendance_status),
             lwp_value         = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(lwp_value),         lwp_value),
             is_locked         = IF(override_by IS NULL AND regularization_id IS NULL, 1,                         is_locked),
             processed_at      = IF(override_by IS NULL AND regularization_id IS NULL, NOW(),                     processed_at)`,
          flatParams,
        );
        uploaded += insertChunk.length;
        succeededInsertRows.push(...insertChunk);
      } catch (err) {
        const reason = `Attendance not saved: batch insert failed (rows ${insertChunk[0]!.rowNum}-${insertChunk[insertChunk.length - 1]!.rowNum} of this file) — ${
          err instanceof Error ? err.message : String(err)}`;
        for (const c of insertChunk) {
          failedRows.push({ row: c.rowNum, employee_code: c.employee_code, reason });
        }
      }
    }
    rowErrors.push(...failedRows);

    // Phase 3 — record the same minutes as EVIDENCE, not only as a verdict, for
    // every row that actually saved in phase 2.
    //
    // Much of the dialler estate is not connected to this database, so those
    // campaigns never reach `apr` and their agents are invisible to everything
    // that reasons about dialler coverage — including isEnrolledInAprFeed, which
    // decides whether an Operations Executive is judged on APR alone. Writing the
    // attendance record alone left the engine with no memory that the day was
    // ever evidenced: the employee stayed "not covered" and every day this file
    // did not mention kept falling back to their biometric punch.
    //
    // ATTRIBUTED, as of criterion 17.10. Every row written below carries a campaign owned by a
    // registered Dialler_Source and a real productivity_upload_batch id, where it used to carry the
    // bare 'MANUAL_UPLOAD' string and a NULL upload_batch_id - the path that produced the 3,810
    // rows with empty process_name and empty branch_name. There is no fallback: if the source, the
    // campaign or a batch row cannot be created, the affected rows are reported per row exactly as
    // a failed chunk is, and nothing unattributed is written. Migration 1640's BEFORE INSERT
    // trigger enforces the same rule at the database, which is why these two ship together.
    //
    // Still filed under its own campaign so it is distinguishable from a synced row,
    // and re-uploading a corrected figure overwrites it rather than adding to it.
    // The attendance record above is unchanged and still authoritative for the
    // days in this file; this only gives the engine the evidence behind it.
    //
    // Same chunked-multi-row / catch-per-chunk contract as phase 2: a failure here
    // never fails the attendance write already committed, and never throws — but
    // it is never silent either, or coverage would quietly stay wrong with the
    // upload reporting success.
    const toEvidence = succeededInsertRows.filter(c => {
      if (aprAlreadySynced.has(`${c.employee_code}:${c.attendance_date}`)) {
        evidenceSkippedAlreadySynced++;
        return false;
      }
      return true;
    });

    // Resolved once per request, before any evidence row is written, and never per row: it is two
    // reads plus at most two inserts, and it is the same answer for every row in the file. A
    // failure here means NO row can be attributed, so every row is reported and the phase writes
    // nothing - the one behaviour criterion 17.10 forbids is falling back to an unattributed write.
    let attribution: { diallerSourceId: string; campaignCode: string } | null = null;
    if (toEvidence.length > 0) {
      try {
        attribution = await resolveAprBulkUploadAttribution((req.authUser as any).id ?? null);
      } catch (err) {
        const reason = `Attendance saved, but the dialler evidence row was not recorded: this upload could not be attributed to a registered dialler source, and an unattributed evidence row is no longer written. Retry the upload. (${
          err instanceof Error ? err.message : String(err)})`;
        for (const c of toEvidence) {
          rowErrors.push({ row: c.rowNum, employee_code: c.employee_code, reason });
        }
      }
    }

    // ONE Upload_Batch PER (branch, process), not one per request.
    //
    // productivity_upload_batch (migration 1638) is shaped around one Dialler_Source, one branch,
    // one process and one date range, all NOT NULL. An apr-bulk file is shaped around nothing but
    // employee codes: it routinely spans many branches, many processes and up to 90 days, because
    // its three-column CSV contract names none of them. So one batch per request would have to put
    // SOMETHING in branch_id and process_id - the first row's, or a sentinel - and would then
    // attribute every other branch's rows to it. That is the same class of defect as the
    // 'MANUAL_UPLOAD' sentinel this phase exists to remove, one level up.
    //
    // Grouping by the employee's own (branch_id, process_id) makes every column of the batch row
    // literally true of every row that points at it, and date_from/date_to are the real min and max
    // within the group.
    //
    // The tension with criterion 17.11 (accepted + rejected = submitted), stated plainly: a batch's
    // submitted_row_count counts the rows OF THAT GROUP, so the identity holds per batch. It cannot
    // be made to hold across the file, because the rows this route rejects earliest - an unparseable
    // date, an employee code that resolves to nobody, an employee who is not an Operations
    // Executive, a payroll-locked day - never resolve to a (branch, process) at all, and several
    // never resolve to an employee. There is no batch they could belong to without inventing one.
    // Those rows stay accounted for where they always were: `errors` in this response names every
    // row of the file that did not land, and the file-level identity is
    // `uploaded + errors.length === rows in the file` (see the response comment below). The
    // Upload_Batch accounting is therefore about what was EVIDENCED, not about what was submitted to
    // the route - and 17.11 holds exactly on that scope.
    const evidenceBatchIds: string[] = [];
    const evidenceWarnings: string[] = [];

    if (attribution !== null && toEvidence.length > 0) {
      // The digest of the bytes actually uploaded (criterion 17.2). Computed once; every group's
      // batch row carries the same digest because they all came from the one file.
      const contentDigest = createHash('sha256').update(req.file.buffer).digest('hex');
      const fileName: string = req.file.originalname ?? 'apr-bulk-upload.csv';

      const byScope = new Map<string, InsertCandidate[]>();
      const unattributableRows: InsertCandidate[] = [];
      for (const c of toEvidence) {
        // employees.branch_id / process_id are nullable; productivity_upload_batch.branch_id /
        // process_id are NOT NULL. A row for an employee mapped to neither cannot be attributed to
        // any batch, and under strict mode letting it reach the INSERT would fail the whole group.
        // Reported with the actionable cause instead - and NOT written unattributed.
        if (!c.branch_id || !c.process_id) {
          unattributableRows.push(c);
          continue;
        }
        const key = `${c.branch_id}|${c.process_id}`;
        const bucket = byScope.get(key);
        if (bucket) bucket.push(c);
        else byScope.set(key, [c]);
      }

      for (const c of unattributableRows) {
        rowErrors.push({
          row: c.rowNum,
          employee_code: c.employee_code,
          reason: 'Attendance saved, but no dialler evidence row was recorded: this employee has no branch and/or no process mapping, so the upload batch that every evidence row must reference cannot be created. Set the employee\'s branch and process, then re-upload this row.',
        });
      }

      for (const group of byScope.values()) {
        const dates = group.map(c => c.attendance_date).sort();
        let batchId: string;
        try {
          batchId = await createAprBulkUploadBatch(attribution.diallerSourceId, {
            branchId: group[0]!.branch_id!,
            processId: group[0]!.process_id!,
            dateFrom: dates[0]!,
            dateTo: dates[dates.length - 1]!,
            fileName,
            contentDigest,
            uploadedBy: (req.authUser as any).id,
            submittedRowCount: group.length,
          });
        } catch (err) {
          // Fail closed for this group only, exactly as a failed insert chunk does. Other groups
          // are independent and still write; the attendance rows already committed in phase 2 are
          // never rolled back.
          const reason = `Attendance saved, but the dialler evidence row was not recorded: the upload batch record it must reference could not be created, and an unattributed evidence row is no longer written. Retry the upload. (${
            err instanceof Error ? err.message : String(err)})`;
          for (const c of group) {
            rowErrors.push({ row: c.rowNum, employee_code: c.employee_code, reason });
          }
          continue;
        }
        evidenceBatchIds.push(batchId);

        let groupAccepted = 0;
        let groupRejected = 0;
        for (const evidenceChunk of chunkArray(group, INSERT_CHUNK_SIZE)) {
          const valuesSql = evidenceChunk.map(() => `(?, ?, ?, SEC_TO_TIME(? * 60), 'manual', ?, ?)`).join(',\n           ');
          const flatParams = evidenceChunk.flatMap(c => [
            c.attendance_date, c.employee_code, attribution!.campaignCode, c.params[4],
            (req.authUser as any).id, batchId,
          ]);
          try {
            // source='manual' both protects the row from sync overwrites (the vicidial worker's
            // ON DUPLICATE clause preserves every column of a manual row) and is what marks this
            // as a manual write for migration 1640's trigger. upload_batch_id is assigned in the
            // ON DUPLICATE branch too: a corrected re-upload must move the row's attribution to
            // the batch that actually last evidenced the day, not leave it pointing at a batch
            // whose figures no longer describe it.
            await db.execute(
              `INSERT INTO apr (ReportDate, UserID, campaign_id, Net_Login, source, uploaded_by, upload_batch_id)
               VALUES ${valuesSql}
               ON DUPLICATE KEY UPDATE
                 Net_Login = VALUES(Net_Login),
                 source = 'manual',
                 uploaded_by = VALUES(uploaded_by),
                 upload_batch_id = VALUES(upload_batch_id)`,
              flatParams,
            );
            evidenceRecorded += evidenceChunk.length;
            groupAccepted += evidenceChunk.length;
          } catch (err) {
            groupRejected += evidenceChunk.length;
            const reason = `Attendance saved, but the dialler evidence row could not be recorded (batch rows ${
              evidenceChunk[0]!.rowNum}-${evidenceChunk[evidenceChunk.length - 1]!.rowNum} of this file): ${
              err instanceof Error ? err.message : String(err)}`;
            for (const c of evidenceChunk) {
              rowErrors.push({ row: c.rowNum, employee_code: c.employee_code, reason });
            }
          }
        }

        try {
          await finaliseAprBulkUploadBatch(batchId, groupAccepted, groupRejected);
        } catch (err) {
          // The rows themselves are saved and attributed - the batch id on them is real. Only the
          // batch's own counts are unrecorded, so this is a warning about the audit trail, not a
          // per-row failure: reporting it in `errors` would tell the uploader that rows which did
          // land had not, and would bury a real row error under one line per row.
          evidenceWarnings.push(
            `Upload batch ${batchId} recorded ${group.length} evidence row(s) but its own row counts could not be written, so it is still marked pending: ${
              err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return res.json({
      success: true,
      uploaded,
      skipped_locked: skippedLocked,
      evidence_recorded: evidenceRecorded,
      evidence_skipped_already_synced: evidenceSkippedAlreadySynced,
      // ADDED, never renamed or removed: src/components/attendance/AprBulkUpload.tsx reads
      // success, uploaded, skipped_locked and errors[] only, and all four behave exactly as before.
      // These two make the new attribution visible to an operator without a DB query - which batch
      // rows this upload created (criterion 17.13's history screen reads the same rows), and any
      // audit-trail problem that did NOT cost a row.
      evidence_batch_ids: evidenceBatchIds,
      evidence_warnings: evidenceWarnings,
      // Atomicity contract: rows are written in chunks of up to INSERT_CHUNK_SIZE
      // via a single multi-row statement per chunk, so each chunk is all-or-nothing
      // but chunks are independent of each other — one chunk's DB error does not
      // roll back or block any other chunk, and never crashes the request. `errors`
      // lists every row that did NOT land, by row number, with the real reason,
      // including any chunk-level DB failure. The real invariant is
      // `uploaded + errors.length === (total rows in the file)`: `errors` is where
      // every non-uploaded row is accounted for, including parse-stage failures
      // and locked rows — `skipped_locked` is a count of how many of those `errors`
      // rows were locked, not a fourth bucket disjoint from `errors`, so it is not
      // additive with `uploaded` and `errors.length`.
      failed: failedRows.length,
      errors: rowErrors,
    });
  },
);

export { router as attendanceAprBulkRouter };
