import { Router, type Response } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { resolveDashboardScopeForRequest, buildScopeWhereEmployees } from "../../shared/dashboardScope.js";
import { submitQaAudit, listAuditsForEmployee, QaAuditError } from "./qa-audit.service.js";
import { createForm, activateForm, listForms } from "./qa-form.service.js";

/**
 * Manual QA audit capture.
 *
 * These are the routes QA_EVALUATION and QA_CALIBRATION have been granted for
 * since June — 102_role_page_access_seed.sql gave qa, manager and branch_head
 * those page codes and neither has ever had anything behind it.
 *
 * Two access rules, both enforced here rather than in the UI:
 *
 *  1. An agent may read their OWN audits and nobody else's. A quality score is
 *     personal, and "employee" is the largest role in the system at 1,357 users.
 *  2. Everyone else reads within their dashboard scope, resolved from the same
 *     helper the KPI and Operations surfaces use, so a branch head cannot read
 *     another branch by changing an id in the URL.
 *
 * Writing is narrower still: scoring somebody is a QA function, not a
 * management one.
 */

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);

const AUDITOR_ROLES = ["super_admin", "admin", "qa", "quality_analyst", "tq_head"] as const;

function handleError(res: Response, err: unknown): Response {
  if (err instanceof QaAuditError) {
    return res.status(err.statusCode).json({ success: false, message: err.message });
  }
  throw err;
}

/** The caller's own employee row, or null when their login is not linked to one. */
async function selfEmployeeId(userId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE auth_user_id = ? LIMIT 1`,
    [userId],
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

/**
 * GET /api/qa/audit-forms?processId=
 * The active form for a process, with its parameters, so an auditor can score.
 */
router.get("/audit-forms", requireRole(...AUDITOR_ROLES), h(async (req, res) => {
  const processId = String(req.query.processId ?? "").trim();
  if (!processId) return res.status(400).json({ success: false, message: "processId is required" });

  const [forms] = await db.execute<RowDataPacket[]>(
    `SELECT id, form_name, version_no, effective_from, effective_to
       FROM qa_audit_form
      WHERE process_id = ? AND status = 'active'
        AND effective_from <= CURDATE()
        AND (effective_to IS NULL OR effective_to >= CURDATE())
      ORDER BY version_no DESC`,
    [processId],
  );
  if (!forms.length) {
    // Distinguish "this process has no form yet" from "the query failed",
    // rather than returning an empty list that reads like either.
    return res.json({ success: true, data: null, reason: "no_active_form_for_process" });
  }

  const form = forms[0];
  const [parameters] = await db.execute<RowDataPacket[]>(
    `SELECT id, section, parameter_text, max_score, weightage, is_fatal, display_order
       FROM qa_audit_form_parameter
      WHERE form_id = ? AND active_status = 1
      ORDER BY display_order ASC, parameter_text ASC`,
    [form.id],
  );
  return res.json({ success: true, data: { ...form, parameters } });
}));

/**
 * POST /api/qa/audits
 * Score one interaction. The server computes the totals — see the service.
 */
router.post("/audits", requireRole(...AUDITOR_ROLES), h(async (req, res) => {
  const { formId, employeeId, employeeCode, auditDate, callReference, evidenceUrl, remarks, scores, submit } = req.body ?? {};
  if (!formId || (!employeeId && !employeeCode) || !auditDate) {
    return res.status(400).json({
      success: false, message: "formId, auditDate and one of employeeId or employeeCode are required",
    });
  }

  // An auditor has the agent's code, not their UUID. Resolve it here rather than
  // making every caller look it up — and refuse an ambiguous code rather than
  // picking one, because attributing a quality score to the wrong person is
  // worse than refusing to file it.
  let resolvedEmployeeId = employeeId ? String(employeeId) : "";
  if (!resolvedEmployeeId) {
    const [matches] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE employee_code = ? LIMIT 2`,
      [String(employeeCode).trim()],
    );
    if (matches.length === 0) {
      return res.status(404).json({ success: false, message: `No employee with code ${employeeCode}` });
    }
    if (matches.length > 1) {
      return res.status(409).json({
        success: false, message: `More than one employee has the code ${employeeCode} — resolve the duplicate first`,
      });
    }
    resolvedEmployeeId = String(matches[0].id);
  }
  if (!Array.isArray(scores)) {
    return res.status(400).json({ success: false, message: "scores must be an array" });
  }

  try {
    const result = await submitQaAudit({
      formId: String(formId),
      employeeId: resolvedEmployeeId,
      auditDate: String(auditDate).slice(0, 10),
      // Taken from the session, never from the body: an auditor cannot file an
      // audit under somebody else's name.
      auditorUserId: req.authUser!.id,
      callReference: callReference ?? null,
      evidenceUrl: evidenceUrl ?? null,
      remarks: remarks ?? null,
      scores,
      submit: submit !== false,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err);
  }
}));

/**
 * GET /api/qa/audits?employeeId=&from=&to=
 * An agent reads their own; everyone else reads inside their scope.
 */
router.get("/audits", h(async (req, res) => {
  const from = String(req.query.from ?? "").slice(0, 10);
  const to = String(req.query.to ?? "").slice(0, 10);
  if (!from || !to) {
    return res.status(400).json({ success: false, message: "from and to are required" });
  }

  const requested = String(req.query.employeeId ?? "").trim();
  const self = await selfEmployeeId(req.authUser!.id);
  const roleContext = await getUserRoleContext(req.authUser!.id);
  const privileged = (AUDITOR_ROLES as readonly string[]).includes(roleContext.primaryRole)
    || ["manager", "process_manager", "branch_head", "team_leader", "tl", "operations_manager", "ceo", "coo"]
        .includes(roleContext.primaryRole);

  // Unprivileged callers get their own record regardless of what they asked for.
  if (!privileged) {
    if (!self) {
      return res.json({ success: true, data: [], reason: "no_employee_profile_linked" });
    }
    if (requested && requested !== self) {
      // Say no plainly rather than silently swapping the id — a caller who
      // asked for someone else should know they were refused.
      return res.status(403).json({ success: false, message: "You can only view your own quality audits" });
    }
    return res.json({ success: true, data: await listAuditsForEmployee(self, from, to) });
  }

  if (!requested) {
    return res.status(400).json({ success: false, message: "employeeId is required" });
  }

  // A privileged caller still only reads inside their branch/process scope.
  // Flagged in 714830f8 as carrying the same demo-identity gap. Reached only after the
  // employeeId guard above, so it does not 409 on page load the way tat/tasks and
  // work-inbox/dashboard do - but it narrows a demo super_admin to role "employee" and would
  // refuse a lookup they are entitled to.
  const scope = await resolveDashboardScopeForRequest(req.authUser!, roleContext.primaryRole);
  const scopeWhere = buildScopeWhereEmployees(scope, "e");
  const [allowed] = await db.execute<RowDataPacket[]>(
    `SELECT e.id FROM employees e WHERE e.id = ? AND ${scopeWhere.sql} LIMIT 1`,
    [requested, ...scopeWhere.params],
  );
  if (!allowed.length) {
    return res.status(403).json({ success: false, message: "That employee is outside your scope" });
  }

  return res.json({ success: true, data: await listAuditsForEmployee(requested, from, to) });
}));

/**
 * Defining what a process measures is narrower than scoring against it. A
 * quality_analyst files audits; changing the criteria everyone is judged by is a
 * QA-lead decision, so they are not in this set.
 */
const FORM_ADMIN_ROLES = ["super_admin", "admin", "qa", "tq_head"] as const;

/** GET /api/qa/audit-forms/versions?processId= — every version, for an admin screen. */
router.get("/audit-forms/versions", requireRole(...FORM_ADMIN_ROLES), h(async (req, res) => {
  const processId = String(req.query.processId ?? "").trim();
  if (!processId) return res.status(400).json({ success: false, message: "processId is required" });
  return res.json({ success: true, data: await listForms(processId) });
}));

/** POST /api/qa/audit-forms — create a DRAFT. Drafts cannot score anyone. */
router.post("/audit-forms", requireRole(...FORM_ADMIN_ROLES), h(async (req, res) => {
  const { processId, formName, effectiveFrom, parameters } = req.body ?? {};
  if (!processId || !formName || !effectiveFrom) {
    return res.status(400).json({
      success: false, message: "processId, formName and effectiveFrom are required",
    });
  }
  if (!Array.isArray(parameters)) {
    return res.status(400).json({ success: false, message: "parameters must be an array" });
  }

  try {
    const result = await createForm({
      processId: String(processId),
      formName: String(formName).trim(),
      effectiveFrom: String(effectiveFrom).slice(0, 10),
      parameters,
      createdBy: req.authUser!.id,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err);
  }
}));

/**
 * POST /api/qa/audit-forms/:id/activate
 * Activating retires whatever was active for the same process — one live form
 * per process, so "the active form" is never ambiguous.
 */
router.post("/audit-forms/:id/activate", requireRole(...FORM_ADMIN_ROLES), h(async (req, res) => {
  try {
    // The approver is taken from the session: approving criteria is an
    // accountable act and must name whoever actually did it.
    const result = await activateForm(String(req.params.id), req.authUser!.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err);
  }
}));

export { router as qaAuditRouter };
