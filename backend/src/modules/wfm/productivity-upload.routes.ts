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
import { resolveUserBusinessScope, type UserBusinessScope } from '../../shared/enterpriseScope.js';
import { buildUploadPreview } from './productivity-upload-preview.service.js';
import { commitUploadBatch, DuplicateUploadBatchError } from './productivity-upload-commit.service.js';

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

function isBranchInUploaderScope(scope: UserBusinessScope, branchId: string): boolean {
  if (scope.isSuperAdmin || scope.isAdmin) return true;
  return scope.assignments.some((a) => a.branchId === null || a.branchId === branchId);
}

function parseCsvIntoRows(content: string): Array<{ rowNumber: number; data: Record<string, string> }> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  const rows: Array<{ rowNumber: number; data: Record<string, string> }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',').map((c) => c.trim());
    const data: Record<string, string> = {};
    headers.forEach((h, idx) => { data[h] = cols[idx] ?? ''; });
    rows.push({ rowNumber: i + 1, data });
  }
  return rows;
}

interface UploadRequestFields {
  diallerSourceId: string;
  branchId: string;
  processId: string;
  dateFrom: string;
  dateTo: string;
  columnMappings: Record<string, string>;
}

function readRequestFields(body: any): UploadRequestFields | { error: string } {
  const { diallerSourceId, branchId, processId, dateFrom, dateTo, columnMappings } = body;
  if (!diallerSourceId || !branchId || !processId || !dateFrom || !dateTo || !columnMappings) {
    return { error: 'diallerSourceId, branchId, processId, dateFrom, dateTo and columnMappings are all required' };
  }
  let parsedMappings: Record<string, string>;
  try {
    parsedMappings = typeof columnMappings === 'string' ? JSON.parse(columnMappings) : columnMappings;
  } catch {
    return { error: 'columnMappings must be valid JSON' };
  }
  return { diallerSourceId, branchId, processId, dateFrom, dateTo, columnMappings: parsedMappings };
}

router.post(
  '/preview',
  requireRole('wfm', 'branch_head', 'hr', 'payroll_head', 'super_admin', 'admin'),
  acceptCsvUpload,
  async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' });

    const fields = readRequestFields(req.body);
    if ('error' in fields) return res.status(400).json({ success: false, message: fields.error });

    const scope = await resolveUserBusinessScope(req.authUser);
    if (!isBranchInUploaderScope(scope, fields.branchId)) {
      return res.status(403).json({ success: false, message: 'This branch is outside your resolved scope' });
    }

    const rawRows = parseCsvIntoRows(req.file.buffer.toString('utf-8'));
    const preview = await buildUploadPreview(rawRows, fields.columnMappings, fields.diallerSourceId);

    if (preview.mappingError) {
      return res.status(400).json({
        success: false,
        message: `Column mapping is missing required field(s): ${preview.mappingError.missingFields.join(', ')}`,
      });
    }

    return res.json({ success: true, accepted: preview.accepted, rejected: preview.rejected });
  },
);

router.post(
  '/commit',
  requireRole('wfm', 'branch_head', 'hr', 'payroll_head', 'super_admin', 'admin'),
  acceptCsvUpload,
  async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' });

    const fields = readRequestFields(req.body);
    if ('error' in fields) return res.status(400).json({ success: false, message: fields.error });

    const scope = await resolveUserBusinessScope(req.authUser);
    if (!isBranchInUploaderScope(scope, fields.branchId)) {
      return res.status(403).json({ success: false, message: 'This branch is outside your resolved scope' });
    }

    const fileBuffer: Buffer = req.file.buffer;
    const rawRows = parseCsvIntoRows(fileBuffer.toString('utf-8'));
    const preview = await buildUploadPreview(rawRows, fields.columnMappings, fields.diallerSourceId);

    if (preview.mappingError) {
      return res.status(400).json({
        success: false,
        message: `Column mapping is missing required field(s): ${preview.mappingError.missingFields.join(', ')}`,
      });
    }

    const contentDigest = createHash('sha256').update(fileBuffer).digest('hex');
    const mappingVersionUsed = Number(req.body.mappingVersionUsed) || 1;
    const supersedesBatchId: string | undefined = req.body.supersedesBatchId || undefined;

    // commitUploadBatch() throws DuplicateUploadBatchError, not a plain Error, when its
    // duplicate-submission guard fires (an identical file+scope was already committed and this
    // request did not declare itself a re-upload via supersedesBatchId). That is an expected,
    // actionable outcome — not a server fault — so it is caught here and turned into 409 with the
    // guard's own message (which already names the prior batch id the caller needs to pass back
    // as supersedesBatchId to force it through). Matched by `instanceof`, not by a message
    // substring: an earlier draft matched on message text, which coupled the route to a string
    // the service could reword without this file's own tests noticing, silently degrading a real
    // duplicate submission back into a masked 500 (caught in a round-4 review). Any other error
    // from commitUploadBatch is a genuine unexpected failure and is deliberately rethrown to the
    // global error handler rather than also mapped to 409.
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
    // not a silent 200.
    return res.status(result.writeErrors.length === 0 ? 200 : 207).json({
      success: result.writeErrors.length === 0,
      ...result,
    });
  },
);

export { router as productivityUploadRouter };
