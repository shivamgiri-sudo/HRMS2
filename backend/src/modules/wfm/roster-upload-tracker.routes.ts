// Roster Upload Tracker API — mounted at /api/wfm/roster-upload-tracker.
import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { getUserRoleContext } from '../../shared/roleResolver.js';
import { resolveDashboardScopeForRequest } from '../../shared/dashboardScope.js';
import { logger } from '../../logger.js';
import { UPLOAD_STATUSES, type UploadStatus } from './roster-upload-tracker.logic.js';
import {
  getCellDetail,
  getTracker,
  MAX_WEEKS,
  type TrackerScope,
} from './roster-upload-tracker.service.js';
import { ReminderError, runRosterUploadEscalation, sendManualReminder } from './roster-upload-escalation.service.js';

const ADMIN_ROLES = ['wfm', 'admin', 'super_admin'];
const VIEW_ROLES = [...ADMIN_ROLES, 'branch_wfm', 'hr', 'ceo', 'branch_head', 'operations_manager', 'process_manager', 'manager'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^[0-9a-fA-F-]{36}$/;

export const rosterUploadTrackerRouter = Router();
rosterUploadTrackerRouter.use(requireAuth);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Who may see which branches/processes; null lists mean org-wide. Throws 403 for self/team-only viewers. */
async function resolveScope(req: AuthenticatedRequest): Promise<TrackerScope> {
  const user = req.authUser!;
  const ctx = await getUserRoleContext(user.id);
  const scope = await resolveDashboardScopeForRequest(user, ctx.primaryRole);
  if (scope.level === 'ORG_ALL') return { branchIds: null, processIds: null };
  if (scope.level === 'BRANCH_ALL') return { branchIds: scope.branchIds, processIds: null };
  if (scope.level === 'PROCESS_ALL') return { branchIds: scope.branchIds, processIds: scope.processIds };
  throw Object.assign(new Error('Your role is not scoped to a branch or process'), { status: 403 });
}

function fail(res: Response, err: unknown, what: string): void {
  const status = (err as { status?: number }).status;
  if (status) {
    res.status(status).json({ error: (err as Error).message });
    return;
  }
  logger.error({ err: (err as Error).message }, `[roster-upload-tracker] ${what} failed`);
  res.status(500).json({ error: `Could not ${what}` });
}

// GET /api/wfm/roster-upload-tracker?weeks=6&offset=0&branchId=&processId=&managerId=&status=
rosterUploadTrackerRouter.get('/', requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const status = str(req.query.status);
    if (status && !UPLOAD_STATUSES.includes(status as UploadStatus)) {
      res.status(400).json({ error: `status must be one of ${UPLOAD_STATUSES.join(', ')}` });
      return;
    }
    const weeks = Number(req.query.weeks ?? 6);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isFinite(weeks) || !Number.isFinite(offset) || weeks < 1 || weeks > MAX_WEEKS) {
      res.status(400).json({ error: `weeks must be 1–${MAX_WEEKS} and offset a whole number` });
      return;
    }
    const data = await getTracker({
      weeks,
      offset,
      branchId: str(req.query.branchId),
      processId: str(req.query.processId),
      managerId: str(req.query.managerId),
      status: status as UploadStatus | undefined,
      scope: await resolveScope(req as AuthenticatedRequest),
    });
    res.json(data);
  } catch (err) {
    fail(res, err, 'load the upload tracker');
  }
});

// GET /api/wfm/roster-upload-tracker/cell?branchId=&processId=&weekStart=YYYY-MM-DD
rosterUploadTrackerRouter.get('/cell', requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const branchId = str(req.query.branchId);
    const processId = str(req.query.processId);
    const weekStart = str(req.query.weekStart);
    if (!branchId || !processId || !weekStart || !ID_PATTERN.test(branchId) || !ID_PATTERN.test(processId) || !DATE_PATTERN.test(weekStart)) {
      res.status(400).json({ error: 'branchId, processId and weekStart (YYYY-MM-DD) are required' });
      return;
    }
    const detail = await getCellDetail(branchId, processId, weekStart, Date.now(), await resolveScope(req as AuthenticatedRequest));
    if (!detail) {
      res.status(404).json({ error: 'No active employees for this branch and process' });
      return;
    }
    res.json(detail);
  } catch (err) {
    fail(res, err, 'load the upload detail');
  }
});

// POST /api/wfm/roster-upload-tracker/remind  { branchId, processId, weekStart }
rosterUploadTrackerRouter.post('/remind', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { branchId, processId, weekStart } = req.body as Record<string, unknown>;
    if (
      typeof branchId !== 'string' || typeof processId !== 'string' || typeof weekStart !== 'string' ||
      !ID_PATTERN.test(branchId) || !ID_PATTERN.test(processId) || !DATE_PATTERN.test(weekStart)
    ) {
      res.status(400).json({ error: 'branchId, processId and weekStart (YYYY-MM-DD) are required' });
      return;
    }
    const scope = await resolveScope(req as AuthenticatedRequest);
    if ((scope.branchIds && !scope.branchIds.includes(branchId)) || (scope.processIds && !scope.processIds.includes(processId))) {
      res.status(403).json({ error: 'That branch or process is outside your scope' });
      return;
    }
    res.json(await sendManualReminder(branchId, processId, weekStart));
  } catch (err) {
    if (err instanceof ReminderError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    fail(res, err, 'send the reminder');
  }
});

// POST /api/wfm/roster-upload-tracker/escalation/run?dryRun=true — manual sweep, admin only.
// Dry run is the default: a real send needs an explicit dryRun=false.
rosterUploadTrackerRouter.post('/escalation/run', requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    res.json(await runRosterUploadEscalation({ dryRun: req.query.dryRun !== 'false' }));
  } catch (err) {
    fail(res, err, 'run the escalation sweep');
  }
});
