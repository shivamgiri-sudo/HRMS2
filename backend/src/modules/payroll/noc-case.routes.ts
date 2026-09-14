/**
 * NOC Certificate (Exit Clearance) — authenticated endpoints.
 *
 * Signatory actions, HR administration, the tracking dashboard, and the Payroll Head override.
 *
 * AUTHORIZATION MODEL
 *
 * Two independent checks, and both matter:
 *   1. Does the caller hold the role this stage belongs to? Read from noc_signatory.role_key
 *      (plus fallback_role_key), never from a list hardcoded here — the template owns who signs.
 *   2. Is the caller scoped to the leaver's branch? A NOC is a branch document; the Admin of
 *      branch X has no business clearing branch Y's asset return.
 *
 * hasScopedAccess() does both, but there is a trap in it worth naming: a caller holding NONE of
 * allowedRoles returns false immediately, and requireScopeForNonAdmin defaults to true so a
 * role-holder with no user_assignment_scope row also fails. Both are the correct fail-closed
 * behaviour for a clearance that releases money, and both are why role keys passed here must be
 * the LITERAL user_roles.role_key rather than an alias — getUserRoleKeys reads user_roles raw and
 * performs no alias expansion.
 *
 * This is deliberately stricter than the existing exit_clearance_task routes, which by their own
 * comment (exit.routes.ts:108-113) let any of six broad roles clear any department's task and
 * left owner-role enforcement as an open business question. For a control that gates salary, the
 * answer is that the owner signs.
 */

import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole, hasScopedAccess, buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import * as nocCase from "./noc-case.service.js";
import { overrideNocRelease, nocBlockedEmployeesForRuns, nocReleaseStatusForEmployee } from "./noc-release-gate.service.js";

export const nocCaseRouter = Router();
nocCaseRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

/** Roles allowed to READ the NOC dashboard and any case within their scope. */
const READ_ROLES = [
  "hr", "branch_hr", "payroll", "payroll_head", "payroll_hr", "payroll_branch",
  "finance", "finance_head", "accounts", "admin", "super_admin",
  "branch_head", "branch_admin", "branch_it", "it", "it_head",
  "process_manager", "manager", "tl", "team_leader",
];

/** Roles allowed to open a case and send the employee invite. */
const INITIATE_ROLES = [
  "hr", "branch_hr", "admin", "super_admin", "tl", "team_leader",
  "process_manager", "manager", "branch_head", "branch_it", "it", "branch_admin",
  "payroll_head", "payroll_hr",
];

/** HR administration: Last Working Day, record-on-behalf, reopening a declined case. */
const HR_ROLES = ["hr", "branch_hr", "admin", "super_admin", "payroll_head"];

function refuse(res: Response, statusCode: number, code: string, message: string): Response {
  return res.status(statusCode).json({ success: false, code, message });
}

function fail(res: Response, err: unknown): Response {
  const e = err as { statusCode?: number; code?: string; message?: string };
  if (e?.statusCode && e.statusCode < 500) {
    return res.status(e.statusCode).json({ success: false, code: e.code ?? "NOC_ERROR", message: e.message });
  }
  throw err;
}

interface ActorIdentity {
  userId: string;
  employeeId: string | null;
  name: string | null;
  role: string | null;
}

/**
 * Who is acting, resolved once per request.
 *
 * The NAME is what the certificate reproduces beside each signature, so it is captured onto the
 * signatory row rather than joined at print time — a later edit or deactivation of the signer's
 * employee record must not change a historical clearance document.
 */
async function resolveActor(req: AuthenticatedRequest): Promise<ActorIdentity> {
  const userId = req.authUser!.id;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), employee_code) AS name
       FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [userId],
  );
  return {
    userId,
    employeeId: (rows[0]?.id as string) ?? null,
    // Falls back to the login email when the caller has no employees row (a pure system/admin
    // account). Better than NULL on a certificate: it still names who signed.
    name: (rows[0]?.name as string) ?? req.authUser!.email ?? null,
    role: req.authUser!.role ?? null,
  };
}

/** Scope check against the case's own captured branch, not the employee's current one. */
async function canAccessCase(
  userId: string,
  nocCaseRow: { branch_id: string | null; process_id: string | null; employee_id: string },
  roles: string[],
): Promise<boolean> {
  return hasScopedAccess(
    userId,
    roles,
    {
      branchId: nocCaseRow.branch_id,
      processId: nocCaseRow.process_id,
      employeeId: nocCaseRow.employee_id,
    },
    { allowAdminBypass: true },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard / list
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/payroll/noc-cases
nocCaseRouter.get("/", h(async (req, res) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, ...READ_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "You do not have access to NOC clearance records.");
  }

  // Row scoping through the same builder every other scoped list uses, so a branch user sees
  // their branch and Payroll Head / HR see everything. allowCeoAllRead keeps leadership read-only
  // visibility consistent with the rest of the payroll module.
  const scope = await buildScopeWhereClause(
    userId,
    READ_ROLES,
    { branchId: "c.branch_id", processId: "c.process_id", employeeId: "c.employee_id" },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );

  const { status, branchId, stageKey, stageStatus, slaBreachedOnly, search, limit } =
    req.query as Record<string, string>;

  const rows = await nocCase.listCases(
    {
      status, branchId, stageKey, stageStatus, search,
      slaBreachedOnly: slaBreachedOnly === "true",
      limit: limit ? Number(limit) : undefined,
    },
    scope,
  );
  return res.json({ success: true, data: rows });
}));

/**
 * GET /api/payroll/noc-cases/summary — the Pending / Accepted / Declined grid.
 *
 * Aggregated in SQL rather than by counting the list response client-side: the dashboard shows
 * per-role totals across every open exit, and computing that from a 200-row page would be both
 * wrong (it only sees the page) and slow.
 */
nocCaseRouter.get("/summary", h(async (req, res) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, ...READ_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "You do not have access to NOC clearance records.");
  }
  const scope = await buildScopeWhereClause(
    userId,
    READ_ROLES,
    { branchId: "c.branch_id", processId: "c.process_id", employeeId: "c.employee_id" },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );

  const [byRole] = await db.execute<RowDataPacket[]>(
    `SELECT s.display_no, s.stage_key, s.stage_label,
            SUM(s.status = 'pending')                     AS pending,
            SUM(s.status IN ('accepted','acknowledged'))  AS accepted,
            SUM(s.status = 'declined')                    AS declined,
            SUM(s.status = 'pending' AND s.sla_due_at IS NOT NULL AND s.sla_due_at < NOW()) AS sla_breached
       FROM noc_signatory s
       JOIN noc_case c ON c.id = s.noc_case_id
      WHERE (${scope.sql})
        AND c.status NOT IN ('completed','cancelled')
      GROUP BY s.display_no, s.stage_key, s.stage_label
      ORDER BY s.display_no`,
    scope.params,
  );

  const [byStatus] = await db.execute<RowDataPacket[]>(
    `SELECT c.status, COUNT(*) AS cnt
       FROM noc_case c
      WHERE (${scope.sql})
      GROUP BY c.status`,
    scope.params,
  );

  return res.json({ success: true, data: { byRole, byStatus } });
}));

/**
 * GET /api/payroll/noc-cases/withheld/:runId — who this run will not pay, and why.
 *
 * Payroll Head reads this before validating a run. Same data the 409 at
 * PATCH /runs/:id/validate returns, available on demand so it can be reviewed and worked through
 * rather than only discovered at the moment of sign-off.
 */
nocCaseRouter.get("/withheld/:runId", h(async (req, res) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_head", "payroll", "finance", "finance_head", "admin", "super_admin"))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "Only payroll and finance roles can view withheld salary.");
  }
  const rows = await nocBlockedEmployeesForRuns([String(req.params.runId)]);
  const total = rows.reduce((s, r) => s + (Number(r.net_salary) || 0), 0);
  return res.json({
    success: true,
    data: { count: rows.length, totalWithheld: Number(total.toFixed(2)), employees: rows },
  });
}));

// GET /api/payroll/noc-cases/employee/:employeeId — release status for one employee
nocCaseRouter.get("/employee/:employeeId", h(async (req, res) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, ...READ_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "You do not have access to NOC clearance records.");
  }
  const existing = await nocCase.getCaseByEmployee(String(req.params.employeeId));
  const release = await nocReleaseStatusForEmployee(String(req.params.employeeId));
  return res.json({ success: true, data: { nocCase: existing, release } });
}));

// GET /api/payroll/noc-cases/:id — full detail
nocCaseRouter.get("/:id", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await canAccessCase(userId, row, READ_ROLES))) {
    return refuse(res, 403, "NOC_OUT_OF_SCOPE", "This NOC is outside your assigned scope.");
  }
  try {
    return res.json({ success: true, data: await nocCase.getCaseDetail(String(req.params.id)) });
  } catch (err) { return fail(res, err); }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Initiation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/payroll/noc-cases — open a case for a leaver.
 *
 * initiatorRole is taken from the body, not inferred from the caller's roles, because the
 * escalation matrix keys on it and a user commonly holds several roles at once (manager AND hr is
 * routine here) — inferring would make the matrix row ambiguous. It is validated against the
 * caller's actual roles below so it cannot be used to claim a level they do not hold.
 */
nocCaseRouter.post("/", h(async (req, res) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, ...INITIATE_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "You cannot start a NOC clearance.");
  }
  const { employeeId, initiatorRole, exitRequestId } = req.body as {
    employeeId?: string; initiatorRole?: nocCase.InitiatorRole; exitRequestId?: string;
  };
  if (!employeeId) return refuse(res, 400, "NOC_EMPLOYEE_REQUIRED", "employeeId is required.");

  const validInitiators: nocCase.InitiatorRole[] = ["agent", "tl", "manager", "hr", "it", "admin_mis"];
  const role = (initiatorRole && validInitiators.includes(initiatorRole)) ? initiatorRole : null;
  if (!role) {
    return refuse(res, 400, "NOC_INITIATOR_INVALID",
      `initiatorRole must be one of: ${validInitiators.join(", ")}.`);
  }

  // The claimed initiator level must be one the caller can actually occupy. Without this, an
  // agent could declare themselves 'hr' and change who the case notifies.
  const ROLE_EVIDENCE: Record<nocCase.InitiatorRole, string[]> = {
    agent:     ["employee", "tl", "team_leader", "hr", "admin", "super_admin"],
    tl:        ["tl", "team_leader", "admin", "super_admin"],
    manager:   ["process_manager", "manager", "branch_head", "admin", "super_admin"],
    hr:        ["hr", "branch_hr", "payroll_hr", "payroll_head", "admin", "super_admin"],
    it:        ["branch_it", "it", "it_head", "admin", "super_admin"],
    admin_mis: ["branch_admin", "admin", "super_admin"],
  };
  if (!(await hasAnyRole(userId, ...ROLE_EVIDENCE[role]))) {
    return refuse(res, 403, "NOC_INITIATOR_NOT_HELD",
      `You do not hold a role that can initiate as '${role}'.`);
  }

  const actor = await resolveActor(req);
  try {
    const result = await nocCase.openCase({
      employeeId, initiatorRole: role, initiatedByUserId: userId,
      actorName: actor.name, actorRole: actor.role, exitRequestId: exitRequestId ?? null,
    });

    if (result.created) {
      void logSensitiveAction({
        actor_user_id: userId, actor_role: actor.role ?? undefined,
        action_type: "noc_case_opened", module_key: "payroll_noc",
        entity_type: "noc_case", entity_id: result.caseId,
        new_value_json: { employee_id: employeeId, initiator_role: role } as Record<string, unknown>,
        req,
      });
    }
    return res.status(result.created ? 201 : 200).json({
      success: true,
      data: result,
      message: result.created
        ? "NOC clearance started. Send the employee their form link next."
        : "This employee already has an open NOC clearance.",
    });
  } catch (err) { return fail(res, err); }
}));

/** POST /api/payroll/noc-cases/:id/invite — mint and send the employee form link. */
nocCaseRouter.post("/:id/invite", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await hasAnyRole(userId, ...INITIATE_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "You cannot send a NOC form invite.");
  }
  if (!(await canAccessCase(userId, row, INITIATE_ROLES))) {
    return refuse(res, 403, "NOC_OUT_OF_SCOPE", "This NOC is outside your assigned scope.");
  }

  const actor = await resolveActor(req);
  try {
    const invite = await nocCase.mintInvite(String(req.params.id), userId);
    const { notifyInviteSent } = await import("./noc.notifications.js");
    const delivery = await notifyInviteSent(String(req.params.id), invite);

    void logSensitiveAction({
      actor_user_id: userId, actor_role: actor.role ?? undefined,
      action_type: "noc_invite_sent", module_key: "payroll_noc",
      entity_type: "noc_case", entity_id: String(req.params.id),
      new_value_json: { invite_id: invite.inviteId, channels: delivery.channels } as Record<string, unknown>,
      req,
    });

    // The URL is returned so HR can copy it into WhatsApp by hand. That is not a convenience —
    // SMS and WhatsApp have never successfully delivered from this system (0 sent against 901 and
    // 903 failures respectively as at 2026-08), so a human relay is the only channel besides
    // email that actually works today.
    return res.json({
      success: true,
      data: { url: invite.url, expiresAt: invite.expiresAt, delivery },
      message: delivery.emailed
        ? `Form link sent to ${invite.email}.`
        : "Form link created, but no email address is on record — copy the link and send it directly.",
    });
  } catch (err) { return fail(res, err); }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Signatory action
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/payroll/noc-cases/:id/signatories/:stageKey
 *
 * body: { decision: 'accepted' | 'acknowledged' | 'declined', remarks?: string }
 */
nocCaseRouter.post("/:id/signatories/:stageKey", h(async (req, res) => {
  const userId = req.authUser!.id;
  const caseId = String(req.params.id);
  const stageKey = String(req.params.stageKey);

  const row = await nocCase.getCase(caseId);
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");

  const signatories = await nocCase.getSignatories(caseId);
  const stage = signatories.find((s) => s.stage_key === stageKey);
  if (!stage) return refuse(res, 404, "NOC_STAGE_NOT_FOUND", "That signatory stage is not on this NOC.");

  // The stage owns who may sign it. Read from the row, never from a list in this file — the
  // template is the source of truth and an operator can repoint a stage without a deploy.
  const stageRoles = [stage.role_key, stage.fallback_role_key].filter((r): r is string => Boolean(r));
  if (!(await canAccessCase(userId, row, stageRoles))) {
    return refuse(res, 403, "NOC_NOT_YOUR_STAGE",
      `${stage.stage_label} clearance can only be recorded by the ${stage.role_key} for this branch.`);
  }

  const { decision, remarks } = req.body as { decision?: nocCase.SignatoryDecision; remarks?: string };
  const actor = await resolveActor(req);

  try {
    const result = await nocCase.actOnSignatory({
      caseId, stageKey,
      decision: decision as nocCase.SignatoryDecision,
      remarks: remarks ?? null,
      actorUserId: userId,
      actorEmployeeId: actor.employeeId,
      actorName: actor.name,
      actorRole: actor.role,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });

    await logSensitiveAction({
      actor_user_id: userId, actor_role: actor.role ?? undefined,
      action_type: `noc_signatory_${decision}`, module_key: "payroll_noc",
      entity_type: "noc_case", entity_id: caseId,
      old_value_json: { stage: stageKey, status: "pending" } as Record<string, unknown>,
      new_value_json: { stage: stageKey, status: decision, remarks: remarks ?? null } as Record<string, unknown>,
      req,
    });

    // Notifications are fanned out after the transaction committed, so a mail failure can never
    // roll back a recorded signature.
    void import("./noc.notifications.js").then(async (m) => {
      if (result.declined) await m.notifyDeclined(caseId, stageKey);
      else if (result.completed) await m.notifyCompleted(caseId);
      for (const next of result.newlyActionable) await m.notifySignatoryPending(caseId, next.stage_key);
    }).catch((e) => console.error("[noc-case] post-action notification failed:", (e as Error).message));

    return res.json({
      success: true,
      data: result,
      message: result.declined
        ? "Declined. The NOC is locked and HR has been notified to resolve it."
        : result.completed
          ? "NOC clearance is complete. Salary and F&F release is now unblocked for this employee."
          : `${stage.stage_label} clearance recorded.`,
    });
  } catch (err) { return fail(res, err); }
}));

// ─────────────────────────────────────────────────────────────────────────────
// HR administration
// ─────────────────────────────────────────────────────────────────────────────

/** PATCH /api/payroll/noc-cases/:id/last-working-day */
nocCaseRouter.patch("/:id/last-working-day", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await canAccessCase(userId, row, HR_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "Only HR can record the Last Working Day.");
  }
  const { lastWorkingDay } = req.body as { lastWorkingDay?: string };
  const actor = await resolveActor(req);
  try {
    await nocCase.setLastWorkingDay({
      caseId: String(req.params.id), lastWorkingDay: String(lastWorkingDay ?? ""),
      actorUserId: userId, actorRole: actor.role, actorName: actor.name,
    });
    return res.json({ success: true, message: `Last Working Day recorded as ${lastWorkingDay}.` });
  } catch (err) { return fail(res, err); }
}));

/** POST /api/payroll/noc-cases/:id/record-employee-form — for an unreachable leaver. */
nocCaseRouter.post("/:id/record-employee-form", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await canAccessCase(userId, row, HR_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "Only HR can record the form on an employee's behalf.");
  }
  const { resignationDate, reasonForLeaving, assets } = req.body as {
    resignationDate?: string; reasonForLeaving?: string;
    assets?: Array<{ itemCode: string; quantity?: number | null; status: nocCase.AssetStatus; remarks?: string | null }>;
  };
  const actor = await resolveActor(req);
  try {
    await nocCase.recordEmployeeFormOnBehalf({
      caseId: String(req.params.id),
      input: {
        resignationDate: String(resignationDate ?? ""),
        reasonForLeaving: reasonForLeaving ?? null,
        assets: Array.isArray(assets) ? assets : [],
      },
      actorUserId: userId, actorRole: actor.role, actorName: actor.name,
      ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null,
    });
    void import("./noc.notifications.js")
      .then((m) => m.notifyEmployeeSubmitted(String(req.params.id)))
      .catch(() => undefined);
    return res.json({ success: true, message: "Form recorded. The clearance chain is now open." });
  } catch (err) { return fail(res, err); }
}));

/** POST /api/payroll/noc-cases/:id/reopen — HR resolution of a declined case. */
nocCaseRouter.post("/:id/reopen", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await canAccessCase(userId, row, HR_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "Only HR can reopen a declined NOC.");
  }
  const { reason } = req.body as { reason?: string };
  const actor = await resolveActor(req);
  try {
    await nocCase.reopenDeclinedCase({
      caseId: String(req.params.id), reason: String(reason ?? ""),
      actorUserId: userId, actorRole: actor.role, actorName: actor.name,
    });
    await logSensitiveAction({
      actor_user_id: userId, actor_role: actor.role ?? undefined,
      action_type: "noc_case_reopened", module_key: "payroll_noc",
      entity_type: "noc_case", entity_id: String(req.params.id),
      new_value_json: { reason } as Record<string, unknown>,
      req,
    });
    return res.json({ success: true, message: "NOC reopened. The declining stage is pending again." });
  } catch (err) { return fail(res, err); }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Assets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asset status and waivers are Admin/IT work.
 *
 * Finance is excluded on purpose: its own sign-off is gated on these rows, so letting Finance
 * edit them would let the gated party clear its own gate.
 */
const ASSET_ROLES = ["branch_admin", "admin", "branch_it", "it", "it_head", "hr", "super_admin"];

/** PATCH /api/payroll/noc-cases/:id/assets/:itemCode */
nocCaseRouter.patch("/:id/assets/:itemCode", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await canAccessCase(userId, row, ASSET_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "Only branch Admin or IT can record asset returns.");
  }
  const { status, quantity, remarks } = req.body as {
    status?: nocCase.AssetStatus; quantity?: number | null; remarks?: string;
  };
  const actor = await resolveActor(req);
  try {
    await nocCase.updateAssetReturn({
      caseId: String(req.params.id), itemCode: String(req.params.itemCode),
      status: status as nocCase.AssetStatus, quantity: quantity ?? null, remarks: remarks ?? null,
      actorUserId: userId, actorRole: actor.role, actorName: actor.name,
    });
    return res.json({ success: true, message: "Asset status updated." });
  } catch (err) { return fail(res, err); }
}));

/** POST /api/payroll/noc-cases/:id/assets/:itemCode/waive */
nocCaseRouter.post("/:id/assets/:itemCode/waive", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await canAccessCase(userId, row, ASSET_ROLES))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "Only branch Admin or IT can waive an asset.");
  }
  const { reason } = req.body as { reason?: string };
  const actor = await resolveActor(req);
  try {
    await nocCase.waiveAsset({
      caseId: String(req.params.id), itemCode: String(req.params.itemCode),
      reason: String(reason ?? ""), actorUserId: userId, actorRole: actor.role, actorName: actor.name,
    });
    // Audited as a sensitive action, not just a case event: a waiver is what lets Finance sign off
    // on property the company has not got back.
    await logSensitiveAction({
      actor_user_id: userId, actor_role: actor.role ?? undefined,
      action_type: "noc_asset_waived", module_key: "payroll_noc",
      entity_type: "noc_case", entity_id: String(req.params.id),
      new_value_json: { item_code: req.params.itemCode, reason } as Record<string, unknown>,
      req,
    });
    return res.json({ success: true, message: "Asset waived. Finance sign-off is no longer blocked by this item." });
  } catch (err) { return fail(res, err); }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Finance: settlement route
// ─────────────────────────────────────────────────────────────────────────────

/** PATCH /api/payroll/noc-cases/:id/fnf-option */
nocCaseRouter.patch("/:id/fnf-option", h(async (req, res) => {
  const userId = req.authUser!.id;
  const row = await nocCase.getCase(String(req.params.id));
  if (!row) return refuse(res, 404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!(await hasAnyRole(userId, "finance", "finance_head", "accounts", "payroll_head", "admin", "super_admin"))) {
    return refuse(res, 403, "NOC_ACCESS_DENIED", "Only Finance can set the settlement route.");
  }
  const { option } = req.body as { option?: nocCase.FnfOption };
  const actor = await resolveActor(req);
  try {
    await nocCase.setFnfOption({
      caseId: String(req.params.id), option: option as nocCase.FnfOption,
      actorUserId: userId, actorRole: actor.role, actorName: actor.name,
    });
    return res.json({ success: true, message: "Settlement route recorded." });
  } catch (err) { return fail(res, err); }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Head override
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/payroll/noc-cases/employee/:employeeId/override
 *
 * Payroll Head and super_admin only. This is the one endpoint that releases money the signatories
 * have not cleared, so the role list is written narrow and literal here rather than reusing any
 * of the broader constants above — hasAnyRole also grants super_admin unconditionally, which is
 * the intended second holder and not an accident.
 *
 * Audited with `await`, not fire-and-forget: for an act whose only justification is the reason
 * string attached to it, failing to record that reason means the override should not happen.
 */
nocCaseRouter.post("/employee/:employeeId/override", h(async (req, res) => {
  const userId = req.authUser!.id;
  if (!(await hasAnyRole(userId, "payroll_head"))) {
    return refuse(res, 403, "NOC_OVERRIDE_FORBIDDEN",
      "Only Payroll Head can override a NOC and release salary without a completed clearance.");
  }
  const { reason } = req.body as { reason?: string };
  const actor = await resolveActor(req);
  try {
    const result = await overrideNocRelease({
      employeeId: String(req.params.employeeId),
      reason: String(reason ?? ""),
      actorUserId: userId,
    });
    await logSensitiveAction({
      actor_user_id: userId, actor_role: actor.role ?? undefined,
      action_type: "noc_release_overridden", module_key: "payroll_noc",
      entity_type: "noc_case", entity_id: result.caseId,
      reason: String(reason),
      new_value_json: { employee_id: req.params.employeeId } as Record<string, unknown>,
      req,
    });
    await nocCase.__writeNocEvent(null, {
      caseId: result.caseId, action: "release_overridden",
      actorUserId: userId, actorRole: actor.role, actorName: actor.name,
      reason: String(reason),
      ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null,
    });
    return res.json({
      success: true,
      message: "Override recorded. This employee's salary can now be released without a completed NOC.",
    });
  } catch (err) { return fail(res, err); }
}));
