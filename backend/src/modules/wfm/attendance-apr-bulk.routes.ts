import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { isOperationsExecutiveByRegex as isOperationsExecutive, classifyOperationsNetLogin } from './attendance-engine.service.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

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
  upload.single('file'),
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
       WHERE e.employee_code IN (${ph}) AND e.status = 'active'`,
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
    if (lockChecks.length > 0) {
      const [lockedRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, DATE_FORMAT(record_date,'%Y-%m-%d') AS record_date
         FROM attendance_daily_record
         WHERE (employee_id, record_date) IN (${lockChecks.join(',')}) AND is_locked=1`,
      );
      for (const r of lockedRows as any[]) {
        lockedSet.add(`${r.employee_id}:${r.record_date}`);
      }
    }

    const rowErrors: RowError[] = [...parseErrors];
    let uploaded = 0;
    let skippedLocked = 0;

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
        continue;
      }

      const { status, lwpValue } = classifyOperationsNetLogin(row.net_login_minutes);

      await db.execute(
        `INSERT INTO attendance_daily_record
           (id, employee_id, record_date, branch_id, process_id,
            attendance_source, source_system,
            dialler_minutes, raw_minutes,
            attendance_status, lwp_value,
            late_mark, late_by_minutes,
            processed_at, created_by)
         VALUES (UUID(), ?, ?, ?, ?,
                 'dialler', 'apr_bulk',
                 ?, ?,
                 ?, ?,
                 0, 0,
                 NOW(), ?)
         ON DUPLICATE KEY UPDATE
           attendance_source = IF(is_locked=0, 'dialler',              attendance_source),
           source_system     = IF(is_locked=0, 'apr_bulk',             source_system),
           dialler_minutes   = IF(is_locked=0, VALUES(dialler_minutes), dialler_minutes),
           raw_minutes       = IF(is_locked=0, VALUES(raw_minutes),     raw_minutes),
           attendance_status = IF(is_locked=0, VALUES(attendance_status), attendance_status),
           lwp_value         = IF(is_locked=0, VALUES(lwp_value),       lwp_value),
           processed_at      = IF(is_locked=0, NOW(),                   processed_at)`,
        [
          emp.employee_id, row.attendance_date, emp.branch_id, emp.process_id,
          row.net_login_minutes, row.net_login_minutes,
          status, lwpValue,
          (req.authUser as any).id,
        ],
      );
      uploaded++;
    }

    return res.json({ success: true, uploaded, skipped_locked: skippedLocked, errors: rowErrors });
  },
);

export { router as attendanceAprBulkRouter };
