import { Router } from 'express';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { legacyService } from './legacy.service.js';
import { legacySyncWorker } from '../../workers/legacy-sync-worker.js';

const router = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => 
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// All legacy sync operations require authentication and admin role
router.use(requireAuth);
router.use(requireRole('admin'));

/**
 * Health check - verify legacy database connection
 * GET /api/legacy/health
 */
router.get('/health', h(async (_req: AuthenticatedRequest, res: Response) => {
  const health = await legacyService.checkHealth();
  return res.json({ success: health.ok, ...health });
}));

/**
 * Get connection info (safe for display, no password)
 * GET /api/legacy/connection-info
 */
router.get('/connection-info', h(async (_req: AuthenticatedRequest, res: Response) => {
  const info = legacyService.getConnectionInfo();
  return res.json({ success: true, data: info });
}));

/**
 * Analyze legacy database schema
 * POST /api/legacy/analyze/schema
 */
router.post('/analyze/schema', h(async (_req: AuthenticatedRequest, res: Response) => {
  const result = await legacyService.analyzeSchema();
  return res.json({ 
    success: true, 
    message: `Found ${result.candidateCount} candidate tables`,
    data: result 
  });
}));

/**
 * Get mapping candidates (pending approval)
 * GET /api/legacy/mapping-candidates
 */
router.get('/mapping-candidates', h(async (_req: AuthenticatedRequest, res: Response) => {
  const candidates = await legacyService.getMappingCandidates();
  return res.json({ success: true, data: candidates });
}));

/**
 * Approve a mapping candidate
 * POST /api/legacy/mapping-candidates/:id/approve
 */
router.post('/mapping-candidates/:id/approve', h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await legacyService.approveMappingCandidate(id, req.authUser!.id);
  return res.json({ success: true, message: 'Mapping approved' });
}));

/**
 * Reject a mapping candidate
 * POST /api/legacy/mapping-candidates/:id/reject
 */
router.post('/mapping-candidates/:id/reject', h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  await legacyService.rejectMappingCandidate(id, req.authUser!.id);
  return res.json({ success: true, message: 'Mapping rejected' });
}));

/**
 * Get all sync maps
 * GET /api/legacy/sync-maps
 */
router.get('/sync-maps', h(async (_req: AuthenticatedRequest, res: Response) => {
  const maps = await legacyService.getSyncMaps();
  return res.json({ success: true, data: maps });
}));

/**
 * Get sync status (overview)
 * GET /api/legacy/sync/status
 */
router.get('/sync/status', h(async (_req: AuthenticatedRequest, res: Response) => {
  const status = await legacyService.getSyncStatus();
  return res.json({ success: true, data: status });
}));

/**
 * Trigger manual sync (for testing)
 * POST /api/legacy/sync/trigger
 */
router.post('/sync/trigger', h(async (_req: AuthenticatedRequest, res: Response) => {
  const result = await legacySyncWorker.triggerManualSync();
  return res.json(result);
}));

export default router;
