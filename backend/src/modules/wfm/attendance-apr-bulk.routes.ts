import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { isOperationsExecutiveByRegex as isOperationsExecutive, classifyOperationsNetLogin, resolveHalfDayFloorMinutes } from './attendance-engine.service.js';

/**
 * Campaign filed against manually uploaded dialler minutes.
 *
 * `apr` is keyed (ReportDate, UserID, campaign_id), so its own campaign keeps a
 * manual row from colliding with a synced one, makes uploads identifiable for
 * audit, and lets a corrected re-upload overwrite rather than accumulate.
 */
const MANUAL_UPLOAD_CAMPAIGN = 'MANUAL_UPLOAD';

const router = Router();
router.use(requireAuth);

const MAX_UPLOAD_MB = 2;

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

    // Fetch all unique employee codes in one query
    const codes = [...new Set(csvRows.map(r => r.employee_code))];
    const ph = codes.map(() => '?').join(', ');
    const [empRows] = await db.execute<RowDataPacket[]>(
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
    const empMap = new Map<string, any>();
    for (const row of empRows as any[]) empMap.set(row.employee_code, row);

    // Fetch locked records for all affected employee+date pairs
    const lockChecks = csvRows.map(r => {
      const emp = empMap.get(r.employee_code);
      return emp ? `('${emp.employee_id}','${r.attendance_date}')` : null;
    }).filter(Boolean);

    const lockedSet = new Set<string>();
    const protectedReasonByKey = new Map<string, string>();
    if (lockChecks.length > 0) {
      const [lockedRows] = await db.execute<RowDataPacket[]>(
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
         WHERE (adr.employee_id, adr.record_date) IN (${lockChecks.join(',')})
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
      );
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
    const aprAlreadySynced = new Set<string>();
    if (csvRows.length > 0) {
      const pairParams: string[] = [];
      const pairPlaceholders = csvRows.map((r) => {
        pairParams.push(r.employee_code, r.attendance_date);
        return '(?,?)';
      }).join(',');
      const [syncedRows] = await db.execute<RowDataPacket[]>(
        `SELECT UserID, DATE_FORMAT(ReportDate,'%Y-%m-%d') AS d
           FROM apr
          WHERE (UserID, ReportDate) IN (${pairPlaceholders})
            AND campaign_id <> ?`,
        [...pairParams, MANUAL_UPLOAD_CAMPAIGN],
      ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);
      for (const r of syncedRows as any[]) aprAlreadySynced.add(`${r.UserID}:${r.d}`);
    }

    const rowErrors: RowError[] = [...parseErrors];
    let uploaded = 0;
    let skippedLocked = 0;
    let evidenceRecorded = 0;
    let evidenceSkippedAlreadySynced = 0;

    // Resolved once for the whole upload, not per row: a bulk file can carry
    // thousands of rows and this is a database read. Resolving it inside the loop
    // would also let the floor change midway through a single upload.
    const netLoginHalfDayFloor = await resolveHalfDayFloorMinutes('netlogin_half_day_floor_minutes');

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

      await db.execute(
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
        `INSERT INTO attendance_daily_record
           (id, employee_id, record_date, branch_id, process_id,
            attendance_source, source_system,
            dialler_minutes, raw_minutes,
            attendance_status, lwp_value,
            late_mark, late_by_minutes,
            is_locked,
            processed_at, created_by)
         VALUES (UUID(), ?, ?, ?, ?,
                 'dialler', 'apr_bulk',
                 ?, ?,
                 ?, ?,
                 0, 0,
                 1,
                 NOW(), ?)
         ON DUPLICATE KEY UPDATE
           attendance_source = IF(override_by IS NULL AND regularization_id IS NULL, 'dialler',                attendance_source),
           source_system     = IF(override_by IS NULL AND regularization_id IS NULL, 'apr_bulk',               source_system),
           dialler_minutes   = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(dialler_minutes),   dialler_minutes),
           raw_minutes       = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(raw_minutes),       raw_minutes),
           attendance_status = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(attendance_status), attendance_status),
           lwp_value         = IF(override_by IS NULL AND regularization_id IS NULL, VALUES(lwp_value),         lwp_value),
           is_locked         = IF(override_by IS NULL AND regularization_id IS NULL, 1,                         is_locked),
           processed_at      = IF(override_by IS NULL AND regularization_id IS NULL, NOW(),                     processed_at)`,
        [
          emp.employee_id, row.attendance_date, emp.branch_id, emp.process_id,
          row.net_login_minutes, row.net_login_minutes,
          status, lwpValue,
          (req.authUser as any).id,
        ],
      );
      uploaded++;

      // Record the same minutes as EVIDENCE, not only as a verdict.
      //
      // Much of the dialler estate is not connected to this database, so those
      // campaigns never reach `apr` and their agents are invisible to everything
      // that reasons about dialler coverage — including isEnrolledInAprFeed, which
      // decides whether an Operations Executive is judged on APR alone. Writing the
      // attendance record alone left the engine with no memory that the day was
      // ever evidenced: the employee stayed "not covered" and every day this file
      // did not mention kept falling back to their biometric punch.
      //
      // Filed under its own campaign so it is distinguishable from a synced row,
      // and re-uploading a corrected figure overwrites it rather than adding to it.
      // The attendance record above is unchanged and still authoritative for the
      // days in this file; this only gives the engine the evidence behind it.
      if (aprAlreadySynced.has(`${row.employee_code}:${row.attendance_date}`)) {
        evidenceSkippedAlreadySynced++;
      } else {
        try {
          // Set source='manual' to protect from sync overwrites
          await db.execute(
            `INSERT INTO apr (ReportDate, UserID, campaign_id, Net_Login, source, uploaded_by)
             VALUES (?, ?, ?, SEC_TO_TIME(? * 60), 'manual', ?)
             ON DUPLICATE KEY UPDATE
               Net_Login = VALUES(Net_Login),
               source = 'manual',
               uploaded_by = VALUES(uploaded_by)`,
            [row.attendance_date, row.employee_code, MANUAL_UPLOAD_CAMPAIGN, row.net_login_minutes, (req.authUser as any).id],
          );
          evidenceRecorded++;
        } catch (err) {
          // The attendance record is already written and correct. A failure to file
          // the evidence must not fail the row — but it must not be silent either,
          // or coverage would quietly stay wrong with the upload reporting success.
          rowErrors.push({
            row: row.rowNum,
            employee_code: row.employee_code,
            reason: `Attendance saved, but the dialler evidence row could not be recorded: ${
              err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    return res.json({
      success: true,
      uploaded,
      skipped_locked: skippedLocked,
      evidence_recorded: evidenceRecorded,
      evidence_skipped_already_synced: evidenceSkippedAlreadySynced,
      errors: rowErrors,
    });
  },
);

export { router as attendanceAprBulkRouter };
