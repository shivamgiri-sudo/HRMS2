import { Router } from 'express';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  type HeaderMappingProfile,
} from './header-mapping-profile.service.js';

const router = Router();

// Middleware to wrap async handlers
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: any) =>
    fn(req, res).catch(next);

router.use(requireAuth);

/**
 * GET /api/wfm/header-mapping-profiles
 * Query: ?processId=<uuid> (optional)
 * Auth: wfm, admin, super_admin
 */
router.get(
  '/',
  requireRole('wfm', 'admin', 'super_admin'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const processId = req.query.processId as string | undefined;
    const profiles = await listProfiles(processId);
    res.json({ profiles });
  }),
);

/**
 * POST /api/wfm/header-mapping-profiles
 * Auth: wfm, admin
 */
router.post(
  '/',
  requireRole('wfm', 'admin'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      processId,
      profileName,
      columnMappings,
      shiftAliasOverrides,
      statusAliasOverrides,
      blankHandling,
      hdMapsTo,
      isDefault,
    } = req.body;

    if (!profileName) {
      res.status(400).json({ error: 'profileName is required' });
      return;
    }

    if (!columnMappings || typeof columnMappings !== 'object') {
      res.status(400).json({ error: 'columnMappings is required and must be an object' });
      return;
    }

    const userId = req.authUser?.id;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    try {
      const profile = await createProfile({
        processId,
        profileName,
        columnMappings,
        shiftAliasOverrides,
        statusAliasOverrides,
        blankHandling,
        hdMapsTo,
        isDefault,
        createdBy: userId,
      });
      res.status(201).json({ profile });
    } catch (err: any) {
      if (err.statusCode === 409) {
        res.status(409).json({ error: err.message });
      } else {
        throw err;
      }
    }
  }),
);

/**
 * PATCH /api/wfm/header-mapping-profiles/:id
 * Auth: wfm, admin
 */
router.patch(
  '/:id',
  requireRole('wfm', 'admin'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid profile id' });
      return;
    }

    const updates = req.body;

    const profile = await updateProfile(id, updates);
    res.json({ profile });
  }),
);

/**
 * DELETE /api/wfm/header-mapping-profiles/:id
 * Auth: admin
 */
router.delete(
  '/:id',
  requireRole('admin'),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid profile id' });
      return;
    }

    await deleteProfile(id);
    res.json({ success: true });
  }),
);

export default router;
