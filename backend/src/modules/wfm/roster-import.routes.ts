/**
 * Task 5: Roster Import Routes — Upload & Preview
 */

import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  createImportBatch,
  getImportBatch,
  getImportRows,
  commitImportBatch,
  updateImportRow,
  getMissingEmployees,
} from './roster-import.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const WFM_ROLES = ['wfm', 'admin', 'super_admin'];

export const rosterImportRouter = Router();

// Apply auth to all routes
rosterImportRouter.use(requireAuth);

// ── POST /api/wfm/roster-imports ──────────────────────────────────────────
// Upload a roster spreadsheet and produce a PREVIEW batch
rosterImportRouter.post(
  '/',
  requireRole(...WFM_ROLES),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded — send field "file"' });
        return;
      }

      const { processId, importMode, cycleId, sheetName } = req.body as {
        processId?: string;
        importMode?: string;
        cycleId?: string;
        sheetName?: string;
      };

      // processId is deliberately NOT required: the file identifies people by employee code and
      // each employee carries their own process. It is still accepted, for the Roster Builder
      // deep link which already knows the process.

      const mode = (importMode === 'UPDATE' ? 'UPDATE' : 'NEW') as 'NEW' | 'UPDATE';
      const createdBy = (req as any).user?.id ?? 'system';

      const result = await createImportBatch({
        processId,
        cycleId,
        sheetName,
        importMode: mode,
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        createdBy,
      });

      res.status(201).json({
        batchId: result.batchId,
        status: 'PREVIEW',
        summary: result.summary,
      });
    } catch (err: any) {
      // Anything that named its own status is already a message written for the uploader
      // (wrong tab, no date columns, unreadable file). Pass it through verbatim.
      if (err?.statusCode) {
        // candidates is what lets the upload page render a sheet picker instead of a dead end.
        res.status(err.statusCode).json({
          error: err.message,
          code: err.code,
          ...(err.candidates ? { candidates: err.candidates } : {}),
        });
        return;
      }
      console.error('[roster-import] POST error:', err);
      // The cause used to go into `detail`, which nothing displays: hrmsApi reads `error` first
      // (hrmsApi.ts:110), so the uploader saw a bare "Import failed" and the actual reason was
      // dropped on the floor. Two files were reported as simply "failed" for exactly this
      // reason. `detail` is kept for programmatic callers; the message now carries the cause.
      const cause = err?.message ? String(err.message) : 'unknown error';
      res.status(500).json({ error: `Import failed: ${cause}`, detail: cause });
    }
  }
);

// ── GET /api/wfm/roster-imports/:batchId ─────────────────────────────────
rosterImportRouter.get(
  '/:batchId',
  requireRole(...WFM_ROLES),
  async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId, 10);
      if (isNaN(batchId)) {
        res.status(400).json({ error: 'Invalid batchId' });
        return;
      }
      const result = await getImportBatch(batchId);
      res.json(result);
    } catch (err: any) {
      if (err?.statusCode === 404) {
        res.status(404).json({ error: err.message });
        return;
      }
      console.error('[roster-import] GET batch error:', err);
      res.status(500).json({ error: 'Failed to retrieve batch' });
    }
  }
);

// ── GET /api/wfm/roster-imports/:batchId/rows ────────────────────────────
rosterImportRouter.get(
  '/:batchId/rows',
  requireRole(...WFM_ROLES),
  async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId, 10);
      if (isNaN(batchId)) {
        res.status(400).json({ error: 'Invalid batchId' });
        return;
      }

      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));
      const rawState = req.query.state as string | undefined;
      const state =
        rawState === 'VALID' || rawState === 'WARNING' || rawState === 'ERROR'
          ? rawState
          : undefined;

      const result = await getImportRows(batchId, { page, limit, state });
      res.json({
        rows: result.rows,
        total: result.total,
        page,
        limit,
      });
    } catch (err: any) {
      console.error('[roster-import] GET rows error:', err);
      res.status(500).json({ error: 'Failed to retrieve rows' });
    }
  }
);

// ── POST /api/wfm/roster-imports/:batchId/commit ─────────────────────────
rosterImportRouter.post(
  '/:batchId/commit',
  requireRole(...WFM_ROLES),
  async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId, 10);
      if (isNaN(batchId)) {
        res.status(400).json({ success: false, error: 'Invalid batchId' });
        return;
      }
      const committedBy = (req as any).user?.id;
      const { overrideWarnings, cycleId } = req.body;
      const result = await commitImportBatch(batchId, committedBy, { overrideWarnings, cycleId });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Commit failed' });
    }
  }
);

// ── PATCH /api/wfm/roster-imports/:batchId/header-mapping ────────────────
rosterImportRouter.patch(
  '/:batchId/header-mapping',
  requireRole(...WFM_ROLES),
  async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId, 10);
      if (isNaN(batchId)) {
        res.status(400).json({ error: 'Invalid batchId' });
        return;
      }

      const { columnMappings } = req.body as { columnMappings?: Record<string, string> };
      if (!columnMappings || typeof columnMappings !== 'object') {
        res.status(400).json({ error: 'columnMappings object is required' });
        return;
      }

      // Store the mapping override in validation_summary_json or a dedicated column.
      // For now persist as an update to the batch's mapping_profile metadata.
      const { db } = await import('../../db/mysql.js');
      await db.execute(
        `UPDATE wfm_roster_import_batch
         SET validation_summary_json = JSON_SET(
           COALESCE(validation_summary_json, '{}'),
           '$.columnMappings', CAST(? AS JSON)
         )
         WHERE id = ?`,
        [JSON.stringify(columnMappings), batchId]
      );

      res.json({ success: true });
    } catch (err: any) {
      console.error('[roster-import] PATCH header-mapping error:', err);
      res.status(500).json({ error: 'Failed to save header mapping' });
    }
  }
);

// ── PATCH /api/wfm/roster-imports/:batchId/rows/:rowId ───────────────────
rosterImportRouter.patch(
  '/:batchId/rows/:rowId',
  requireRole(...WFM_ROLES),
  async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId, 10);
      const rowId = parseInt(req.params.rowId, 10);
      if (isNaN(batchId) || isNaN(rowId)) {
        res.status(400).json({ error: 'Invalid batchId or rowId' });
        return;
      }
      const { rawValue } = req.body as { rawValue?: string };
      if (rawValue === undefined || rawValue === null) {
        res.status(400).json({ error: 'rawValue is required' });
        return;
      }
      const result = await updateImportRow(batchId, rowId, rawValue);
      res.json(result);
    } catch (err: any) {
      if (err?.statusCode === 404) { res.status(404).json({ error: err.message }); return; }
      console.error('[roster-import] PATCH row error:', err);
      res.status(500).json({ error: 'Failed to update row' });
    }
  }
);

// ── GET /api/wfm/roster-imports/:batchId/missing-employees ───────────────
rosterImportRouter.get(
  '/:batchId/missing-employees',
  requireRole(...WFM_ROLES),
  async (req, res) => {
    try {
      const batchId = parseInt(req.params.batchId, 10);
      if (isNaN(batchId)) { res.status(400).json({ error: 'Invalid batchId' }); return; }
      const result = await getMissingEmployees(batchId);
      res.json(result);
    } catch (err: any) {
      if (err?.statusCode === 404) { res.status(404).json({ error: err.message }); return; }
      console.error('[roster-import] GET missing-employees error:', err);
      res.status(500).json({ error: 'Failed to get missing employees' });
    }
  }
);

// ── GET /api/wfm/roster-imports/view ──────────────────────────────────────
// The roster as a table: one row per employee, dates across, with the context needed to read it
// (reporting manager, process, branch, cost centre) and filters for branch / process / cost centre.
rosterImportRouter.get('/view/table', requireRole(...WFM_ROLES), async (req, res) => {
  try {
    const { getRosterView } = await import('./roster-view.service.js');
    const q = req.query as Record<string, string | undefined>;
    if (!q.fromDate || !q.toDate) {
      res.status(400).json({ error: 'fromDate and toDate are required (YYYY-MM-DD)' });
      return;
    }
    const result = await getRosterView({
      fromDate: q.fromDate,
      toDate: q.toDate,
      branchId: q.branchId || undefined,
      processId: q.processId || undefined,
      costCentreId: q.costCentreId || undefined,
      search: q.search || undefined,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      offset: q.offset ? parseInt(q.offset, 10) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    console.error('[roster-view] error:', err);
    res.status(500).json({ error: `Roster view failed: ${err?.message ?? 'unknown error'}` });
  }
});
