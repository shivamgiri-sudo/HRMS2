import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getPlanningMode, setPlanningMode, PlanningMode } from './planning-mode.service.js';

const planningModeRouter = Router({ mergeParams: true });

planningModeRouter.use(requireAuth);

/**
 * GET /api/wfm/processes/:id/planning-config
 * Get the planning mode configuration for a process.
 */
planningModeRouter.get(
  '/:id/planning-config',
  requireRole('wfm', 'admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: processId } = req.params;
      const mode = await getPlanningMode(processId);
      res.json({ processId, planningMode: mode });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/wfm/processes/:id/planning-config
 * Update the planning mode configuration for a process.
 */
planningModeRouter.patch(
  '/:id/planning-config',
  requireRole('admin', 'super_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id: processId } = req.params;
      const { planningMode } = req.body as { planningMode?: PlanningMode };

      if (!planningMode || !['ROSTER_LED', 'VOLUME_BASED'].includes(planningMode)) {
        res.status(400).json({ error: 'planningMode must be ROSTER_LED or VOLUME_BASED' });
        return;
      }

      await setPlanningMode(processId, planningMode);
      res.json({ processId, planningMode });
    } catch (err) {
      next(err);
    }
  }
);

export { planningModeRouter };
