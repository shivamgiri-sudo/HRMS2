import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

/**
 * Onfido Utilization bulk upload.
 *
 * Feeds the Onfido Process Dashboard's "Queue Wise" panel (Queue / Required HC / Active HC /
 * Buffer % / Shortfall) directly from an uploaded sheet — no manual re-entry. Weekly or daily
 * uploads are both one row per (date, queue): a weekly file simply carries 7 dates at once.
 *
 * SCAFFOLD NOTE: the column set (upload_date, queue_name, approved_hc, required_hc, active_hc,
 * buffer_pct, shortfall) is modelled on the Queue Wise panel already shown in the Onfido
 * dashboard mock, because the real "Onfido Utilization" sheet referenced in the original request
 * was never attached to this change. If the real template uses different headers, update
 * REQUIRED_COLUMNS / OPTIONAL_COLUMNS below and the matching columns in migration
 * 1644_onfido_utilization_upload.sql together — this route reads columns by name, not position.
 *
 * Static values only: this route never evaluates a formula. Multer's memoryStorage + a plain
 * text split is used exactly like attendance-apr-bulk.routes.ts's CSV path; an Excel workbook is
 * converted to CSV client-side (see the matching frontend upload component) before it reaches
 * here, so this route only ever sees literal cell values, never a formula string or a computed
 * result.
 *
 * Override-not-duplicate: re-uploading the same date+queue overwrites the existing row via
 * `ON DUPLICATE KEY UPDATE`, keyed on the table's own UNIQUE KEY (upload_date, queue_name) — the
 * same idempotent-upsert shape attendance-apr-bulk.routes.ts uses for attendance_daily_record.
 */

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
        'This upload reads CSV files only — it cannot read an Excel workbook directly. ' +
        'Convert the sheet to CSV before uploading.',
      ));
    }
  },
});

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

const REQUIRED_COLUMNS = ['upload_date', 'queue_name', 'required_hc', 'active_hc'] as const;
const OPTIONAL_COLUMNS = ['approved_hc', 'buffer_pct', 'shortfall'] as const;

interface CsvRow {
  rowNum: number;
  upload_date: string;
  queue_name: string;
  approved_hc: number | null;
  required_hc: number;
  active_hc: number;
  buffer_pct: number | null;
  shortfall: number | null;
}

interface RowError {
  row: number;
  queue_name: string;
  reason: string;
}

function parseNullableInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : NaN;
}

function parseNullableFloat(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-') return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

function parseCsv(content: string): { rows: CsvRow[]; errors: RowError[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: [] };

  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const col of [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]) idx[col] = header.indexOf(col);

  const missing = REQUIRED_COLUMNS.filter((col) => idx[col] === -1);
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{
        row: 0, queue_name: '',
        reason: `CSV header must contain: ${REQUIRED_COLUMNS.join(', ')}. Missing: ${missing.join(', ')}.`,
      }],
    };
  }

  const rows: CsvRow[] = [];
  const errors: RowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',').map((c) => c.trim());
    const rowNum = i + 1;

    const rawDate = cols[idx.upload_date] ?? '';
    const queue_name = cols[idx.queue_name] ?? '';
    if (!rawDate && !queue_name) continue; // blank row

    if (!queue_name) { errors.push({ row: rowNum, queue_name, reason: 'queue_name is required' }); continue; }

    let upload_date = rawDate;
    if (/^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
      const [d, m, y] = rawDate.split('-');
      upload_date = `${y}-${m}-${d}`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      errors.push({ row: rowNum, queue_name, reason: 'upload_date must be DD-MM-YYYY or YYYY-MM-DD' });
      continue;
    }
    if (isNaN(new Date(upload_date).getTime())) {
      errors.push({ row: rowNum, queue_name, reason: 'upload_date is invalid' });
      continue;
    }

    const requiredHc = parseNullableInt(cols[idx.required_hc] ?? '');
    const activeHc = parseNullableInt(cols[idx.active_hc] ?? '');
    if (requiredHc === null || Number.isNaN(requiredHc)) { errors.push({ row: rowNum, queue_name, reason: 'required_hc must be a whole number' }); continue; }
    if (activeHc === null || Number.isNaN(activeHc)) { errors.push({ row: rowNum, queue_name, reason: 'active_hc must be a whole number' }); continue; }

    const approvedHcRaw = idx.approved_hc >= 0 ? parseNullableInt(cols[idx.approved_hc] ?? '') : null;
    const bufferPctRaw = idx.buffer_pct >= 0 ? parseNullableFloat(cols[idx.buffer_pct] ?? '') : null;
    const shortfallRaw = idx.shortfall >= 0 ? parseNullableInt(cols[idx.shortfall] ?? '') : null;
    if (Number.isNaN(approvedHcRaw)) { errors.push({ row: rowNum, queue_name, reason: 'approved_hc must be a whole number' }); continue; }
    if (Number.isNaN(bufferPctRaw)) { errors.push({ row: rowNum, queue_name, reason: 'buffer_pct must be a number' }); continue; }
    if (Number.isNaN(shortfallRaw)) { errors.push({ row: rowNum, queue_name, reason: 'shortfall must be a whole number' }); continue; }

    rows.push({
      rowNum, upload_date, queue_name,
      approved_hc: approvedHcRaw, required_hc: requiredHc, active_hc: activeHc,
      buffer_pct: bufferPctRaw, shortfall: shortfallRaw,
    });
  }

  return { rows, errors };
}

router.post(
  '/onfido-utilization-bulk-upload',
  requireRole('wfm', 'hr', 'operations_manager', 'process_manager', 'super_admin', 'admin'),
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
      return res.json({ success: true, uploaded: 0, errors: parseErrors });
    }

    const actorId = (req.authUser as any).id ?? null;
    const rowErrors: RowError[] = [...parseErrors];
    let uploaded = 0;

    // One multi-row INSERT ... ON DUPLICATE KEY UPDATE, same pattern (and same reasoning) as
    // attendance-apr-bulk.routes.ts: naturally idempotent on the table's real unique key
    // (upload_date, queue_name), so a corrected re-upload safely overwrites rather than
    // duplicating, and a failure here fails the whole batch loudly rather than partially.
    try {
      const valuesSql = csvRows.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?)').join(',\n         ');
      const params = csvRows.flatMap((r) => [
        r.upload_date, r.queue_name, r.approved_hc, r.required_hc, r.active_hc, r.buffer_pct, r.shortfall, actorId,
      ]);
      await db.execute(
        `INSERT INTO onfido_utilization_upload
           (id, upload_date, queue_name, approved_hc, required_hc, active_hc, buffer_pct, shortfall, uploaded_by)
         VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE
           approved_hc = VALUES(approved_hc),
           required_hc = VALUES(required_hc),
           active_hc   = VALUES(active_hc),
           buffer_pct  = VALUES(buffer_pct),
           shortfall   = VALUES(shortfall),
           uploaded_by = VALUES(uploaded_by),
           updated_at  = NOW()`,
        params,
      );
      uploaded = csvRows.length;
    } catch (err) {
      return res.status(502).json({
        success: false,
        message: `Upload failed — no rows were saved. (${err instanceof Error ? err.message : String(err)})`,
        errors: rowErrors,
      });
    }

    return res.json({ success: true, uploaded, errors: rowErrors });
  },
);

/**
 * Read-back for the dashboard's Queue Wise panel. Returns exactly the columns the panel
 * displays, for the most recent upload_date on or before the requested date (defaults to today).
 */
router.get('/onfido-utilization', requireRole(
  'wfm', 'hr', 'operations_manager', 'process_manager', 'qa', 'quality_analyst',
  'manager', 'super_admin', 'admin', 'ceo',
), async (req: any, res: any) => {
  const asOf = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : new Date().toISOString().slice(0, 10);

  const [latestRows] = await db.execute<RowDataPacket[]>(
    `SELECT MAX(upload_date) AS latest FROM onfido_utilization_upload WHERE upload_date <= ?`,
    [asOf],
  );
  const latestDate = (latestRows[0] as any)?.latest ?? null;
  if (!latestDate) {
    return res.json({ success: true, data: { as_of: null, queues: [] } });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT queue_name, approved_hc, required_hc, active_hc, buffer_pct, shortfall
       FROM onfido_utilization_upload
      WHERE upload_date = ?
      ORDER BY queue_name ASC`,
    [latestDate],
  );

  return res.json({
    success: true,
    data: {
      as_of: latestDate,
      queues: rows,
    },
  });
});

export { router as onfidoUtilizationRouter };
