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

      const { processId, importMode, cycleId } = req.body as {
        processId?: string;
        importMode?: string;
        cycleId?: string;
      };

      if (!processId) {
        res.status(400).json({ error: 'processId is required' });
        return;
      }

      const mode = (importMode === 'UPDATE' ? 'UPDATE' : 'NEW') as 'NEW' | 'UPDATE';
      const createdBy = (req as any).user?.id ?? 'system';

      const result = await createImportBatch({
        processId,
        cycleId,
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
      if (err?.message?.includes('Could not detect header row')) {
        res.status(422).json({ error: err.message });
        return;
      }
      console.error('[roster-import] POST error:', err);
      res.status(500).json({ error: 'Import failed', detail: err?.message });
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
