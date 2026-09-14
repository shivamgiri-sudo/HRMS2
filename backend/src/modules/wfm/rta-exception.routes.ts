import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { rtaExceptionService } from './rta-exception.service.js';

export const rtaExceptionRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

rtaExceptionRouter.use(requireAuth);

// GET /api/wfm/rta/exceptions
rtaExceptionRouter.get(
  '/',
  requireRole('wfm', 'admin', 'hr', 'manager', 'process_manager', 'team_leader'),
  h(async (req, res) => {
    const date = String(req.query.date ?? '').trim();
    const processId = String(req.query.processId ?? '').trim();
    const state = String(req.query.state ?? '').trim();
    const employeeId = String(req.query.employeeId ?? '').trim();

    const filters = {
      date: date || undefined,
      processId: processId || undefined,
      state: state || undefined,
      employeeId: employeeId || undefined,
    };

    const exceptions = await rtaExceptionService.listExceptions(filters);
    return res.json({ exceptions });
  })
);

// POST /api/wfm/rta/exceptions
rtaExceptionRouter.post(
  '/',
  requireRole('wfm', 'admin', 'hr', 'manager', 'process_manager'),
  h(async (req, res) => {
    const { alertId, employeeId, exceptionDate, exceptionType, comment } = req.body;

    if (!alertId || !employeeId || !exceptionDate || !exceptionType) {
      return res.status(400).json({
        success: false,
        error: 'alertId, employeeId, exceptionDate, and exceptionType are required',
      });
    }

    const exception = await rtaExceptionService.createException({
      alertId,
      employeeId,
      exceptionDate,
      exceptionType,
      comment,
    });

    return res.status(201).json({ exception });
  })
);

// PATCH /api/wfm/rta/exceptions/:id/disposition
rtaExceptionRouter.patch(
  '/:id/disposition',
  requireRole('wfm', 'admin', 'hr', 'manager', 'process_manager', 'team_leader'),
  h(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { dispositionType, comment, regularizationId, rosterAmendmentId } = req.body;

    if (!dispositionType) {
      return res.status(400).json({ success: false, error: 'dispositionType is required' });
    }

    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid exception ID' });
    }

    const exception = await rtaExceptionService.updateDisposition(id, {
      dispositionType,
      comment,
      regularizationId,
      rosterAmendmentId,
      ownerId: req.authUser.id,
    });

    return res.json({ exception });
  })
);

// PATCH /api/wfm/rta/exceptions/:id/state
rtaExceptionRouter.patch(
  '/:id/state',
  requireRole('wfm', 'admin', 'hr', 'manager', 'process_manager', 'team_leader'),
  h(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { state } = req.body;

    if (!state) {
      return res.status(400).json({ success: false, error: 'state is required' });
    }

    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid exception ID' });
    }

    try {
      const exception = await rtaExceptionService.updateState(id, state);
      return res.json({ exception });
    } catch (error: any) {
      if (error.statusCode === 400) {
        return res.status(400).json({ success: false, error: error.message });
      }
      throw error;
    }
  })
);
