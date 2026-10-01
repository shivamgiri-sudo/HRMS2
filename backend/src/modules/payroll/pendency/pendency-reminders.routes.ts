import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../../middleware/authMiddleware.js';
import { requireRole } from '../../../middleware/requireRole.js';
import { filterVisibleEmployeeIds, OUT_OF_SCOPE_BODY } from '../payroll-branch-scope.js';
import { logSensitiveAction } from '../../../shared/auditLog.js';
import { PENDENCY_KINDS, sendPendencyReminders, type PendencyKind } from './pendency.service.js';

export const pendencyRemindersRouter = Router();

// Same audience as the ESI Registration screen these reminders are triggered from.
const ROLES = ['payroll', 'payroll_hr', 'payroll_branch', 'payroll_head', 'super_admin'] as const;
const MAX_PER_REQUEST = 200;

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

/**
 * POST /api/payroll/pendency-reminders
 * body: { kind: 'esi_docs' | 'bank_account' | 'digilocker', employee_ids: string[] }
 *
 * Sends the follow-up email (with the link to the exact page) to each selected employee
 * who is still pending, honouring the cooldown. Branch scope applies: a caller cannot
 * trigger mail to employees outside their own scope.
 */
pendencyRemindersRouter.post(
  '/pendency-reminders',
  requireAuth,
  requireRole(...ROLES),
  h(async (req, res) => {
    const kind = String(req.body?.kind ?? '') as PendencyKind;
    const rawIds: unknown = req.body?.employee_ids;
    if (!PENDENCY_KINDS.includes(kind)) {
      return res.status(400).json({ success: false, error: `kind must be one of ${PENDENCY_KINDS.join(', ')}` });
    }
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ success: false, error: 'employee_ids must be a non-empty array' });
    }
    const employeeIds = Array.from(new Set(rawIds.map(String).filter(Boolean)));
    if (employeeIds.length > MAX_PER_REQUEST) {
      return res.status(400).json({ success: false, error: `Maximum ${MAX_PER_REQUEST} employees per request` });
    }

    const visible = await filterVisibleEmployeeIds(req as any, employeeIds);
    if (visible.size !== employeeIds.length) return res.status(403).json(OUT_OF_SCOPE_BODY);

    const actorId = (req as any).authUser?.id ?? null;
    const results = await sendPendencyReminders({ kind, employeeIds, sentBy: actorId, trigger: 'manual' });
    const summary = {
      sent: results.filter((r) => r.status === 'sent').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };

    await logSensitiveAction({
      actor_user_id: actorId ?? 'unknown',
      action_type: 'PENDENCY_REMINDER_SENT',
      module_key: 'payroll',
      entity_type: 'pendency_reminder',
      entity_id: kind,
      change_summary: { kind, requested: employeeIds.length, ...summary },
    } as any);

    return res.json({ success: true, summary, results });
  }),
);
