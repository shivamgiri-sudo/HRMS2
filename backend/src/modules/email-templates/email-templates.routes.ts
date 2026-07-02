import { Router } from 'express';
import type { Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  parseFileBuffer,
  previewImport,
  confirmImport,
  listEmailTemplates,
  updateEmailTemplate,
  testRenderTemplate,
  buildSampleCsvBuffer,
  listImportHistory,
} from './email-templates.service.js';

const router = Router();
router.use(requireAuth);

// Only admin / super_admin can manage email templates
const adminOnly = requireRole('admin', 'super_admin');

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<any>) =>
  (req: any, res: Response, next: any) => fn(req, res).catch(next);

// ─── Multer — memory storage, strict validation ───────────────────────────────
const ALLOWED_MIMETYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',        // .xls
  'text/csv',                         // .csv
  'application/csv',
  'application/octet-stream',         // some browsers send this for xlsx
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (ALLOWED_MIMETYPES.has(file.mimetype) || ['xlsx', 'xls', 'csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx / .xls) and CSV files are allowed'));
    }
  },
});

// ─── GET /api/admin/email-templates/import/sample ────────────────────────────
router.get(
  '/import/sample',
  adminOnly,
  h(async (_req, res) => {
    const buf = buildSampleCsvBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="email_templates_sample.xlsx"');
    res.send(buf);
  }),
);

// ─── POST /api/admin/email-templates/import/preview ──────────────────────────
router.post(
  '/import/preview',
  adminOnly,
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    let rawRows: Record<string, unknown>[];
    try {
      rawRows = parseFileBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
    } catch (e: any) {
      return res.status(400).json({ success: false, error: `File parse error: ${e.message}` });
    }
    if (!rawRows.length) {
      return res.status(400).json({ success: false, error: 'File is empty or has no data rows' });
    }
    if (rawRows.length > 500) {
      return res.status(400).json({ success: false, error: 'Maximum 500 templates per import' });
    }
    const preview = await previewImport(rawRows);
    return res.json({ success: true, data: preview });
  }),
);

// ─── POST /api/admin/email-templates/import/confirm ──────────────────────────
// Accepts the validRows array returned by /preview
router.post(
  '/import/confirm',
  adminOnly,
  h(async (req, res) => {
    const { validRows, originalFileName } = req.body as {
      validRows: any[];
      originalFileName?: string;
    };
    if (!Array.isArray(validRows) || validRows.length === 0) {
      return res.status(400).json({ success: false, error: 'validRows array is required' });
    }
    if (validRows.length > 500) {
      return res.status(400).json({ success: false, error: 'Maximum 500 templates per import' });
    }
    const result = await confirmImport(
      validRows,
      req.authUser!.id,
      originalFileName ?? 'bulk_import',
    );
    return res.status(201).json({ success: true, data: result });
  }),
);

// ─── GET /api/admin/email-templates ──────────────────────────────────────────
router.get(
  '/',
  adminOnly,
  h(async (req, res) => {
    const filters = {
      module_name: req.query.module_name as string | undefined,
      is_active:   req.query.active === undefined ? undefined : req.query.active === 'true',
      search:      req.query.search as string | undefined,
    };
    const data = await listEmailTemplates(filters);
    return res.json({ success: true, data });
  }),
);

// ─── PUT /api/admin/email-templates/:templateKey ──────────────────────────────
router.put(
  '/:templateKey',
  adminOnly,
  h(async (req, res) => {
    const updated = await updateEmailTemplate(
      req.params.templateKey.toUpperCase(),
      req.body,
      req.authUser!.id,
    );
    if (!updated) return res.status(404).json({ success: false, error: 'Template not found' });
    return res.json({ success: true, data: updated });
  }),
);

// ─── POST /api/admin/email-templates/test-render ─────────────────────────────
router.post(
  '/test-render',
  adminOnly,
  h(async (req, res) => {
    const { template_key, variables } = req.body as {
      template_key: string;
      variables: Record<string, string>;
    };
    if (!template_key) {
      return res.status(400).json({ success: false, error: 'template_key is required' });
    }
    const rendered = await testRenderTemplate(
      template_key.toUpperCase(),
      variables ?? {},
    );
    return res.json({ success: true, data: rendered });
  }),
);

// ─── GET /api/admin/email-templates/import/history ───────────────────────────
router.get(
  '/import/history',
  adminOnly,
  h(async (_req, res) => {
    const data = await listImportHistory();
    return res.json({ success: true, data });
  }),
);

export { router as emailTemplatesRouter };
