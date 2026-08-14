import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { exitController } from "./exit.controller.js";
import { exitService } from "./exit.service.js";
import { assertValidExitTransition } from "./exit.secure.routes.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response, NextFunction } from "express";
import { db } from "../../db/mysql.js";
import { sqlLimitOffset } from "../../db/pagination.js";
import { randomUUID } from "crypto";

export const resignationRouter = Router();
resignationRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

/**
 * Record an exit-request status change in the exit approval trail.
 *
 * The three lifecycle routes below used to insert into exit_retention_action. That statement
 * could never have succeeded — five separate reasons, and the table's 0 rows confirm it:
 *
 *   - action_type is an ENUM of retention actions (manager_discussion, hr_discussion,
 *     role_change, process_change, shift_change, compensation_review, location_change, other).
 *     'status_change' is not a member.
 *   - employee_id is NOT NULL with no default and was never supplied.
 *   - created_by is NOT NULL with no default and was never supplied.
 *   - performed_by and performed_at do not exist; the real columns are created_by / created_at.
 *
 * The fix is not to rename the columns. exit_retention_action models retention CONVERSATIONS —
 * who spoke to the leaver, what was offered, whether it saved them. Forcing status transitions
 * into it as action_type='other' would corrupt every future report over that table.
 *
 * exit_approval_log is where this belongs, and the rest of the system already assumes so:
 *   - its 11 existing production rows use exactly this shape — stage='accepted',
 *     action='status_update' — so these writes extend an established convention rather than
 *     inventing one;
 *   - journeyLog.service.ts:522-583 already reads exit_approval_log into the employee journey
 *     timeline, so these events now surface there for free;
 *   - the frontend AuditEntry contract (NativeMyResignation.tsx:40) is {action, performed_by,
 *     performed_at, remarks} — which matches exit_approval_log field-for-field and matches
 *     exit_retention_action on nothing at all.
 */
async function logExitStatusChange(
  req: AuthenticatedRequest,
  newStatus: string,
  summary: string
): Promise<void> {
  await db.execute(
    `INSERT INTO exit_approval_log
       (id, exit_request_id, stage, action, action_by, action_by_role, discussion_remarks, created_at)
     VALUES (?, ?, ?, 'status_update', ?, ?, ?, NOW())`,
    [randomUUID(), req.params.exitId, newStatus, req.authUser!.id, req.authUser!.role ?? null, summary]
  );
}

// ── Create Resignation (employee self-service) ────────────────────────────────

resignationRouter.post(
  "/",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const isPrivileged = await hasRole(userId, "admin", "hr", "manager");
    if (!isPrivileged) {
      const emp = await getEmployeeForUser(userId);
      if (!emp) {
        return res.status(403).json({ success: false, message: "Forbidden: no employee record linked to your account" });
      }
      req.body = { ...req.body, employeeId: emp.id };
    }
    req.body = {
      ...req.body,
      exitType: req.body.exitType ?? "voluntary",
      exitDate: req.body.exitDate ?? req.body.last_working_day,
    };
    return exitController.createExitRequest(req, res);
  })
);

// ── Discussion Routes ─────────────────────────────────────────────────────────

// POST /:exitId/discussion — add a discussion record (caller sets discussion_type)
resignationRouter.post(
  "/:exitId/discussion",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { discussion_type, outcome, remarks, employee_sentiment } = req.body as {
      discussion_type: "manager" | "hr";
      outcome?: string;
      remarks?: string;
      employee_sentiment?: string;
    };
    if (!discussion_type) {
      return res.status(400).json({ success: false, message: "discussion_type is required" });
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO resignation_discussion
         (id, exit_request_id, discussion_type, discussed_by, outcome, remarks, employee_sentiment, discussion_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`,
      [id, req.params.exitId, discussion_type, req.authUser!.id, outcome ?? null, remarks ?? null, employee_sentiment ?? null]
    );
    const [rows] = await db.execute(
      `SELECT * FROM resignation_discussion WHERE id = ? LIMIT 1`,
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as any[])[0] ?? null });
  })
);

// GET /:exitId/discussions — list discussions for an exit request
resignationRouter.get(
  "/:exitId/discussions",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute(
      `SELECT rd.*,
              COALESCE(
                NULLIF(discussed_emp.full_name, ''),
                NULLIF(TRIM(CONCAT(COALESCE(discussed_emp.first_name, ''), ' ', COALESCE(discussed_emp.last_name, ''))), ''),
                discussed_user.email
              ) AS discussed_by_name
       FROM resignation_discussion rd
       LEFT JOIN auth_user discussed_user ON discussed_user.id = rd.discussed_by
       LEFT JOIN employees discussed_emp ON discussed_emp.user_id = discussed_user.id AND discussed_emp.active_status = 1
       WHERE rd.exit_request_id = ?
       ORDER BY rd.discussion_date DESC, rd.created_at DESC`,
      [req.params.exitId]
    );
    return res.json({ success: true, data: rows });
  })
);

// POST /:exitId/discussion/:discId/note — add a note to a discussion
resignationRouter.post(
  "/:exitId/discussion/:discId/note",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { note_text } = req.body as { note_text?: string };
    if (!note_text?.trim()) {
      return res.status(400).json({ success: false, message: "note_text is required" });
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO resignation_discussion_note
         (id, discussion_id, note, noted_by)
       VALUES (?, ?, ?, ?)`,
      [id, req.params.discId, note_text, req.authUser!.id]
    );
    return res.status(201).json({ success: true, data: { id } });
  })
);

// POST /:exitId/manager-discussion — forces discussion_type='manager'
resignationRouter.post(
  "/:exitId/manager-discussion",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { outcome, remarks, employee_sentiment } = req.body as {
      outcome?: string;
      remarks?: string;
      employee_sentiment?: string;
    };
    const id = randomUUID();
    await db.execute(
      `INSERT INTO resignation_discussion
         (id, exit_request_id, discussion_type, discussed_by, outcome, remarks, employee_sentiment, discussion_date)
       VALUES (?, ?, 'manager', ?, ?, ?, ?, CURDATE())`,
      [id, req.params.exitId, req.authUser!.id, outcome ?? null, remarks ?? null, employee_sentiment ?? null]
    );
    const [rows] = await db.execute(`SELECT * FROM resignation_discussion WHERE id = ? LIMIT 1`, [id]);
    // Trigger work item for branch_head — non-blocking
    try {
      await db.execute(
        `INSERT INTO work_item
           (id, item_type, title, module_code, entity_type, entity_id, assigned_to_role, priority, status, created_by, created_at)
         VALUES (UUID(), 'RESIGNATION_MANAGER_DISCUSSION', 'Manager discussion pending', 'exit', 'exit_request', ?, 'branch_head', 'high', 'pending', ?, NOW())`,
        [req.params.exitId, req.authUser!.id]
      );
    } catch (_wiErr) {
      // work_item insert failure must not block main response
    }
    return res.status(201).json({ success: true, data: (rows as any[])[0] ?? null });
  })
);

// POST /:exitId/hr-discussion — forces discussion_type='hr'
resignationRouter.post(
  "/:exitId/hr-discussion",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { outcome, remarks, employee_sentiment } = req.body as {
      outcome?: string;
      remarks?: string;
      employee_sentiment?: string;
    };
    const id = randomUUID();
    await db.execute(
      `INSERT INTO resignation_discussion
         (id, exit_request_id, discussion_type, discussed_by, outcome, remarks, employee_sentiment, discussion_date)
       VALUES (?, ?, 'hr', ?, ?, ?, ?, CURDATE())`,
      [id, req.params.exitId, req.authUser!.id, outcome ?? null, remarks ?? null, employee_sentiment ?? null]
    );
    const [rows] = await db.execute(`SELECT * FROM resignation_discussion WHERE id = ? LIMIT 1`, [id]);
    // Trigger work item for hr — non-blocking
    try {
      await db.execute(
        `INSERT INTO work_item
           (id, item_type, title, module_code, entity_type, entity_id, assigned_to_role, priority, status, created_by, created_at)
         VALUES (UUID(), 'RESIGNATION_HR_DISCUSSION', 'HR discussion pending', 'exit', 'exit_request', ?, 'hr', 'high', 'pending', ?, NOW())`,
        [req.params.exitId, req.authUser!.id]
      );
    } catch (_wiErr) {
      // work_item insert failure must not block main response
    }
    return res.status(201).json({ success: true, data: (rows as any[])[0] ?? null });
  })
);

// ── Retention Offer Routes ────────────────────────────────────────────────────

// POST /:exitId/retention-offer — create a structured retention offer
resignationRouter.post(
  "/:exitId/retention-offer",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { offer_type, offer_details } = req.body as {
      offer_type: string;
      offer_details?: Record<string, unknown>;
    };
    if (!offer_type) {
      return res.status(400).json({ success: false, message: "offer_type is required" });
    }
    const id = randomUUID();
    await db.execute(
      // offered_at does not exist; the column is offer_date. Every retention offer therefore
      // threw ER_BAD_FIELD_ERROR and none was ever recorded (the table holds 0 rows).
      // Verified against production: this form succeeds where the previous one throws.
      `INSERT INTO retention_offer
         (id, exit_request_id, offer_type, offer_details, offered_by, offer_date, employee_response)
       VALUES (?, ?, ?, ?, ?, NOW(), 'pending')`,
      [id, req.params.exitId, offer_type, JSON.stringify(offer_details ?? {}), req.authUser!.id]
    );
    const [rows] = await db.execute(`SELECT * FROM retention_offer WHERE id = ? LIMIT 1`, [id]);
    return res.status(201).json({ success: true, data: (rows as any[])[0] ?? null });
  })
);

// GET /:exitId/retention-offers — list retention offers for an exit request
resignationRouter.get(
  "/:exitId/retention-offers",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute(
      `SELECT ro.*,
              COALESCE(
                NULLIF(offered_emp.full_name, ''),
                NULLIF(TRIM(CONCAT(COALESCE(offered_emp.first_name, ''), ' ', COALESCE(offered_emp.last_name, ''))), ''),
                offered_user.email
              ) AS offered_by_name
       FROM retention_offer ro
       LEFT JOIN auth_user offered_user ON offered_user.id = ro.offered_by
       LEFT JOIN employees offered_emp ON offered_emp.user_id = offered_user.id AND offered_emp.active_status = 1
       WHERE ro.exit_request_id = ?
       ORDER BY ro.offer_date DESC`,
      [req.params.exitId]
    );
    return res.json({ success: true, data: rows });
  })
);

// PATCH /:exitId/retention-offer/:offerId/respond — employee responds to offer
resignationRouter.patch(
  "/:exitId/retention-offer/:offerId/respond",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employee_response, response_remarks } = req.body as {
      employee_response: "accept" | "reject";
      response_remarks?: string;
    };
    if (!["accept", "reject"].includes(employee_response)) {
      return res.status(400).json({ success: false, message: "employee_response must be 'accept' or 'reject'" });
    }
    await db.execute(
      `UPDATE retention_offer
       SET employee_response = ?, response_date = NOW(), response_remarks = ?
       WHERE id = ? AND exit_request_id = ?`,
      [employee_response, response_remarks ?? null, req.params.offerId, req.params.exitId]
    );
    return res.json({ success: true, message: `Offer ${employee_response}ed` });
  })
);

// ── Lifecycle Status Routes ───────────────────────────────────────────────────

// POST /:exitId/accept — accept the resignation
resignationRouter.post(
  "/:exitId/accept",
  requireRole("admin", "hr", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Was a raw UPDATE, bypassing exitService.updateExitStatus entirely — the shared function
    // that creates the default clearance-task checklist and fires the acceptance notification
    // for every OTHER path to "accepted" in the app. Because this one endpoint skipped it, a
    // resignation accepted through self-service "My Resignation" got no clearance checklist
    // and no notification, silently diverging from the HR-driven flow for the same status
    // value. exitService.updateExitStatus already writes to exit_approval_log itself, so the
    // separate logExitStatusChange call below (which this handler used to also make) is
    // removed — keeping both would double-log this one event.
    const data = await exitService.updateExitStatus(
      req.params.exitId,
      "accepted",
      "Resignation accepted",
      req.authUser!.id
    );
    return res.json({ success: true, data, message: "Resignation accepted" });
  })
);

// POST /:exitId/withdraw — employee withdraws own resignation; HR/admin may withdraw on behalf
resignationRouter.post(
  "/:exitId/withdraw",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const isPrivileged = await import("../../shared/accessGuard.js").then((m) =>
      m.hasRole(userId, "admin", "hr", "manager")
    );
    if (!isPrivileged) {
      // Employee may only withdraw their own exit request
      const emp = await getEmployeeForUser(userId);
      if (!emp) return res.status(403).json({ success: false, message: "Forbidden" });
      const [check] = await db.execute(
        `SELECT id FROM exit_request WHERE id = ? AND employee_id = ? LIMIT 1`,
        [req.params.exitId, emp.id]
      ) as any[];
      if (!(check as any[]).length) {
        return res.status(403).json({ success: false, message: "You may only withdraw your own resignation" });
      }
    }

    // Was a raw UPDATE with no precondition at all — a resignation already 'exited', 'closed'
    // or itself already 'withdrawn' could be "withdrawn" again. Guarded against the same FSM
    // exit.secure.routes.ts's /:id/status already enforces (delta-audit 2026-08-14, Stage 5g).
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
      [req.params.exitId]
    );
    const current = (rows as RowDataPacket[])[0];
    if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });
    const transition = assertValidExitTransition(current.status, "withdrawn");
    if (!transition.ok) return res.status(409).json({ success: false, message: transition.message });

    await db.execute(
      `UPDATE exit_request SET status = 'withdrawn', updated_at = NOW() WHERE id = ?`,
      [req.params.exitId]
    );
    await logExitStatusChange(req, "withdrawn", "Resignation withdrawn");
    return res.json({ success: true, message: "Resignation withdrawn" });
  })
);

// POST /:exitId/mark-clearance-pending — move to clearance_pending
resignationRouter.post(
  "/:exitId/mark-clearance-pending",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Was a raw UPDATE with no precondition and no audit entry at all — this action was
    // reachable from ANY status (e.g. an exit still in 'draft', or already 'closed') and left
    // no exit_approval_log trail, unlike its sibling /close and /withdraw further down this
    // file. Both fixed together (delta-audit 2026-08-14, Stage 5g, user-approved: this status
    // is now a real branch of the FSM in exit.secure.routes.ts, off 'accepted').
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
      [req.params.exitId]
    );
    const current = (rows as RowDataPacket[])[0];
    if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });
    const transition = assertValidExitTransition(current.status, "clearance_pending");
    if (!transition.ok) return res.status(409).json({ success: false, message: transition.message });

    await db.execute(
      `UPDATE exit_request SET status = 'clearance_pending', updated_at = NOW() WHERE id = ?`,
      [req.params.exitId]
    );
    await logExitStatusChange(req, "clearance_pending", "Status updated to clearance_pending");
    return res.json({ success: true, message: "Status updated to clearance_pending" });
  })
);

// POST /:exitId/mark-fnf-pending — move to fnf_pending
resignationRouter.post(
  "/:exitId/mark-fnf-pending",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Same gap and same fix as /mark-clearance-pending above: no precondition, no audit entry
    // (delta-audit 2026-08-14, Stage 5g).
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
      [req.params.exitId]
    );
    const current = (rows as RowDataPacket[])[0];
    if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });
    const transition = assertValidExitTransition(current.status, "fnf_pending");
    if (!transition.ok) return res.status(409).json({ success: false, message: transition.message });

    await db.execute(
      `UPDATE exit_request SET status = 'fnf_pending', updated_at = NOW() WHERE id = ?`,
      [req.params.exitId]
    );
    await logExitStatusChange(req, "fnf_pending", "Status updated to fnf_pending");
    return res.json({ success: true, message: "Status updated to fnf_pending" });
  })
);

// POST /:exitId/close — close the exit request
resignationRouter.post(
  "/:exitId/close",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // exit_request has no closed_at and no closed_by - the table records
    // closure through status alone, and tracks its other terminal transitions
    // with revoked_at/revoked_by/revoke_reason and exit_confirmed_at. Naming
    // two columns that do not exist raised ER_BAD_FIELD_ERROR, so closing an
    // exit request has never worked: the endpoint returned 500 and the request
    // stayed in whatever state it was in.
    //
    // Nothing is lost by dropping them. Who closed it and when is recorded by
    // logExitStatusChange on the very next line, which writes the actor and
    // NOW() into exit_approval_log - the same audit every other transition on
    // this router uses. status is varchar(50), so 'closed' needs no enum change.
    //
    // Also had no precondition on the current status — an exit still in 'draft' could be
    // "closed" directly. Guarded against the same FSM exit.secure.routes.ts's /:id/status
    // enforces; 'closed' is now the terminal step of the clearance_pending → fnf_pending →
    // closed chain (delta-audit 2026-08-14, Stage 5g, user-approved).
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status FROM exit_request WHERE id = ? LIMIT 1`,
      [req.params.exitId]
    );
    const current = (rows as RowDataPacket[])[0];
    if (!current) return res.status(404).json({ success: false, message: "Exit request not found" });
    const transition = assertValidExitTransition(current.status, "closed");
    if (!transition.ok) return res.status(409).json({ success: false, message: transition.message });

    await db.execute(
      `UPDATE exit_request
       SET status = 'closed', updated_at = NOW()
       WHERE id = ?`,
      [req.params.exitId]
    );
    await logExitStatusChange(req, "closed", "Exit request closed");
    return res.json({ success: true, message: "Exit request closed" });
  })
);

// ── Audit & List Routes ───────────────────────────────────────────────────────

// GET /:exitId/audit — audit trail for an exit request
resignationRouter.get(
  "/:exitId/audit",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Two corrections here, both proven against production:
    //
    // 1. This read exit_retention_action alone — a table that has 0 rows and, per
    //    logExitStatusChange above, never could have had any. The approval trail actually
    //    lives in exit_approval_log (11 rows). The timeline was empty for every exit request
    //    in the system.
    // 2. It selected era.* and aliased performed_by_name, but the page's AuditEntry type
    //    (NativeMyResignation.tsx:40) reads action / performed_by / performed_at / remarks.
    //    exit_retention_action has none of those four columns, so even a populated table would
    //    have rendered a list of "Event" rows with no actor, no remark and an empty timestamp.
    //    Both branches below are aliased into that contract explicitly.
    //
    // exit_retention_action is kept in the UNION rather than dropped: retention discussions are
    // a genuine part of an exit's audit trail, and once something writes them they belong on
    // this timeline alongside the status changes.
    const [rows] = await db.execute(
      `SELECT * FROM (
         SELECT eal.id,
                eal.action,
                eal.stage,
                eal.action_by                                     AS performed_by,
                eal.created_at                                    AS performed_at,
                COALESCE(eal.discussion_remarks, eal.internal_notes) AS remarks,
                COALESCE(
                  NULLIF(actor_emp.full_name, ''),
                  NULLIF(TRIM(CONCAT(COALESCE(actor_emp.first_name, ''), ' ', COALESCE(actor_emp.last_name, ''))), ''),
                  actor_user.email,
                  eal.action_by_role
                ) AS performed_by_name
           FROM exit_approval_log eal
           LEFT JOIN auth_user actor_user ON actor_user.id = eal.action_by
           LEFT JOIN employees actor_emp  ON actor_emp.user_id = actor_user.id AND actor_emp.active_status = 1
          WHERE eal.exit_request_id = ?

         UNION ALL

         SELECT era.id,
                era.action_type                                   AS action,
                'retention'                                       AS stage,
                era.created_by                                    AS performed_by,
                era.created_at                                    AS performed_at,
                COALESCE(era.outcome_remarks, era.action_summary) AS remarks,
                COALESCE(
                  NULLIF(actor_emp.full_name, ''),
                  NULLIF(TRIM(CONCAT(COALESCE(actor_emp.first_name, ''), ' ', COALESCE(actor_emp.last_name, ''))), ''),
                  actor_user.email
                ) AS performed_by_name
           FROM exit_retention_action era
           LEFT JOIN auth_user actor_user ON actor_user.id = era.created_by
           LEFT JOIN employees actor_emp  ON actor_emp.user_id = actor_user.id AND actor_emp.active_status = 1
          WHERE era.exit_request_id = ?
       ) trail
       ORDER BY performed_at ASC`,
      [req.params.exitId, req.params.exitId]
    );
    return res.json({ success: true, data: rows });
  })
);

// GET /my — employee's own exit request(s)
resignationRouter.get(
  "/my",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) {
      return res.status(403).json({ success: false, message: "No employee record linked to your account" });
    }
    const [rows] = await db.execute(
      `SELECT * FROM exit_request WHERE employee_id = ? ORDER BY created_at DESC`,
      [emp.id]
    );
    return res.json({ success: true, data: rows });
  })
);

// GET / — list all exit requests (admin/hr/branch_head/operations_head)
resignationRouter.get(
  "/",
  requireRole("admin", "hr", "branch_head", "operations_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, branchId, limit = "100", offset = "0" } = req.query as Record<string, string>;
    const params: unknown[] = [];
    let where = "1=1";
    if (status) { where += " AND er.status = ?"; params.push(status); }
    if (branchId) { where += " AND e.branch_id = ?"; params.push(branchId); }
    const [rows] = await db.execute(
      `SELECT er.*,
              COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
              e.employee_code, e.branch_id
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
       WHERE ${where}
       ORDER BY er.created_at DESC
       ${sqlLimitOffset(limit, offset, { defaultLimit: 100 })}`,
      params
    );
    return res.json({ success: true, data: rows });
  })
);
