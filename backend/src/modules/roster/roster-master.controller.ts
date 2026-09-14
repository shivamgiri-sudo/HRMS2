import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { hasProcessScope, hasRole } from '../../shared/accessGuard.js';
import { rosterMasterService } from './roster-master.service.js';

type Request = AuthenticatedRequest;

// This whole module previously enforced role only (requireRole in roster-master.routes.ts),
// never scope: a wfm/process_manager user's process_id/employee_id was trusted wherever the
// request body or a URL param supplied one, letting them touch any process company-wide.
// Mirrors roster.governance.routes.ts's canOwnRoster/hasProcessScope pattern — admin and hr
// are treated as org-wide monitors (consistent with SCOPED_MONITORS there), everyone else
// must hold an explicit user_assignment_scope grant for the target process.
const SCOPED_ROSTER_ROLES = ['wfm', 'process_manager'];

class RosterMasterScopeError extends Error {
  readonly statusCode = 403;
  constructor(message = 'Not authorized for this process') {
    super(message);
  }
}

async function assertProcessScope(
  req: Request,
  processId: string | null | undefined,
  branchId: string | null | undefined = null,
): Promise<void> {
  const userId = req.authUser!.id;
  if (await hasRole(userId, 'admin', 'hr')) return;
  if (!processId || !(await hasProcessScope(userId, processId, branchId, ...SCOPED_ROSTER_ROLES))) {
    throw new RosterMasterScopeError();
  }
}

async function employeeProcessScope(employeeId: string): Promise<{ processId: string | null; branchId: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT process_id, branch_id FROM employees WHERE id = ? LIMIT 1',
    [employeeId],
  );
  const row = rows[0] as { process_id?: string; branch_id?: string } | undefined;
  return { processId: row?.process_id ?? null, branchId: row?.branch_id ?? null };
}

/**
 * List-endpoint counterpart to assertProcessScope: create/update/delete/approve
 * already went through assertProcessScope (a single, caller-supplied process_id
 * checked against the caller's own scope), but listTemplates/listWeekOffPreferences
 * left process_id as an entirely optional filter — a wfm/process_manager caller who
 * simply omitted it got every template/preference company-wide (delta-audit
 * 2026-08-14, P1). Returns 'unrestricted' for admin/hr and any 'all'-scope grant,
 * otherwise the caller's own assigned process ids — [] (not 'unrestricted') for a
 * scoped role with no user_assignment_scope row at all, which the caller must
 * translate into "return nothing", matching the fail-closed behavior every other
 * under-provisioned manager-tier role in this codebase already gets.
 */
async function resolveScopedProcessIds(req: Request): Promise<'unrestricted' | string[]> {
  const userId = req.authUser!.id;
  if (await hasRole(userId, 'admin', 'hr')) return 'unrestricted';

  const placeholders = SCOPED_ROSTER_ROLES.map(() => '?').join(', ');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT scope_type, process_id
       FROM user_assignment_scope
      WHERE user_id = ?
        AND role_key IN (${placeholders})
        AND active_status = 1`,
    [userId, ...SCOPED_ROSTER_ROLES],
  );
  const scopes = rows as { scope_type: string; process_id: string | null }[];
  if (scopes.some((s) => s.scope_type === 'all')) return 'unrestricted';
  return scopes.map((s) => s.process_id).filter((id): id is string => !!id);
}

export const rosterMasterController = {
  // ========== Templates ==========
  async createTemplate(req: Request, res: Response) {
    await assertProcessScope(req, req.body.process_id);
    const template = await rosterMasterService.createTemplate({
      ...req.body,
      created_by: req.authUser?.id,
    });
    res.status(201).json(template);
  },

  async listTemplates(req: Request, res: Response) {
    const { process_id, is_active } = req.query;

    const allowed = await resolveScopedProcessIds(req);
    if (allowed !== 'unrestricted') {
      if (allowed.length === 0) return res.json({ data: [] });
      if (process_id && !allowed.includes(String(process_id))) {
        return res.status(403).json({ error: 'Not authorized for this process' });
      }
    }

    const templates = await rosterMasterService.listTemplates({
      process_id: process_id ? (process_id as string) : (allowed === 'unrestricted' ? undefined : allowed),
      is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined,
    });

    res.json({ data: templates });
  },

  async getTemplate(req: Request, res: Response) {
    const template = await rosterMasterService.getTemplateById(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Same row-scope gap as the list endpoint: fetching by id bypassed process
    // scope entirely. Mirrors updateTemplate's own check against the row's
    // actual process, not a caller-supplied value.
    await assertProcessScope(req, (template as { process_id?: string }).process_id ?? null);

    res.json(template);
  },

  async updateTemplate(req: Request, res: Response) {
    // Scope is checked against the template's OWN process, not the request body — a
    // PATCH doesn't necessarily carry process_id, and even if it did, the write target
    // is the existing row's process, not whatever the caller claims.
    const existing = await rosterMasterService.getTemplateById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    await assertProcessScope(req, existing.process_id);
    const template = await rosterMasterService.updateTemplate(req.params.id, req.body);
    res.json(template);
  },

  async deleteTemplate(req: Request, res: Response) {
    await rosterMasterService.deleteTemplate(req.params.id);
    res.status(204).send();
  },

  // ========== Week-Off Preferences ==========
  async createWeekOffPreference(req: Request, res: Response) {
    const preference = await rosterMasterService.createWeekOffPreference({
      employee_id: req.authUser?.id!,
      preferred_day: req.body.preferred_day,
      alternate_day: req.body.alternate_day,
    });

    res.status(201).json(preference);
  },

  async getMyWeekOffPreference(req: Request, res: Response) {
    const preference = await rosterMasterService.getWeekOffPreference(req.authUser?.id!);

    if (!preference) {
      return res.status(404).json({ error: 'No preference found' });
    }

    res.json(preference);
  },

  async listWeekOffPreferences(req: Request, res: Response) {
    const { approved, process_id } = req.query;

    const allowed = await resolveScopedProcessIds(req);
    if (allowed !== 'unrestricted') {
      if (allowed.length === 0) return res.json({ data: [] });
      if (process_id && !allowed.includes(String(process_id))) {
        return res.status(403).json({ error: 'Not authorized for this process' });
      }
    }

    const preferences = await rosterMasterService.listWeekOffPreferences({
      approved: approved === 'true' ? true : approved === 'false' ? false : undefined,
      process_id: process_id ? (process_id as string) : (allowed === 'unrestricted' ? undefined : allowed),
    });

    res.json({ data: preferences });
  },

  async approveWeekOffPreference(req: Request, res: Response) {
    // employee_id came straight from the URL param with no check that the target
    // employee is even in a process the caller has scope over — a wfm/process_manager
    // user could approve week-off for any employee in the company by id.
    const { processId, branchId } = await employeeProcessScope(req.params.employee_id);
    await assertProcessScope(req, processId, branchId);
    const preference = await rosterMasterService.approveWeekOffPreference(
      req.params.employee_id,
      req.authUser?.id!
    );

    res.json(preference);
  },

  // ========== Auto-Roster Generation ==========
  async generateRoster(req: Request, res: Response) {
    await assertProcessScope(req, req.body.process_id);
    const result = await rosterMasterService.generateRoster({
      template_id: req.body.template_id,
      process_id: req.body.process_id,
      start_date: req.body.start_date,
      end_date: req.body.end_date,
      employee_ids: req.body.employee_ids,
      apply_preferences: req.body.apply_preferences ?? true,
    });

    res.json(result);
  },

  // ========== Validation ==========
  async validateSupportRatio(req: Request, res: Response) {
    const { process_id, date } = req.query;

    if (!process_id || !date) {
      return res.status(400).json({ error: 'process_id and date are required' });
    }

    const result = await rosterMasterService.validateSupportRatio(
      process_id as string,
      date as string
    );

    res.json(result);
  },
};
