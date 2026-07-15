import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { exitController } from "./exit.controller.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response, NextFunction } from "express";
import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";

export const resignationRouter = Router();
resignationRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

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
      `SELECT rd.*, u.full_name AS discussed_by_name
       FROM resignation_discussion rd
       LEFT JOIN users u ON u.id = rd.discussed_by
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
      `INSERT INTO retention_offer
         (id, exit_request_id, offer_type, offer_details, offered_by, offered_at, employee_response)
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
      `SELECT ro.*, u.full_name AS offered_by_name
       FROM retention_offer ro
       LEFT JOIN users u ON u.id = ro.offered_by
       WHERE ro.exit_request_id = ?
       ORDER BY ro.offered_at DESC`,
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
    await db.execute(
      `UPDATE exit_request SET status = 'accepted', updated_at = NOW() WHERE id = ?`,
      [req.params.exitId]
    );
    await db.execute(
      `INSERT INTO exit_retention_action
         (id, exit_request_id, action_type, action_summary, outcome, performed_by, performed_at)
       VALUES (UUID(), ?, 'status_change', 'Resignation accepted', 'accepted', ?, NOW())`,
      [req.params.exitId, req.authUser!.id]
    );
    return res.json({ success: true, message: "Resignation accepted" });
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
    await db.execute(
      `UPDATE exit_request SET status = 'withdrawn', updated_at = NOW() WHERE id = ?`,
      [req.params.exitId]
    );
    await db.execute(
      `INSERT INTO exit_retention_action
         (id, exit_request_id, action_type, action_summary, outcome, performed_by, performed_at)
       VALUES (UUID(), ?, 'status_change', 'Resignation withdrawn', 'withdrawn', ?, NOW())`,
      [req.params.exitId, userId]
    );
    return res.json({ success: true, message: "Resignation withdrawn" });
  })
);

// POST /:exitId/mark-clearance-pending — move to clearance_pending
resignationRouter.post(
  "/:exitId/mark-clearance-pending",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await db.execute(
      `UPDATE exit_request SET status = 'clearance_pending', updated_at = NOW() WHERE id = ?`,
      [req.params.exitId]
    );
    return res.json({ success: true, message: "Status updated to clearance_pending" });
  })
);

// POST /:exitId/mark-fnf-pending — move to fnf_pending
resignationRouter.post(
  "/:exitId/mark-fnf-pending",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await db.execute(
      `UPDATE exit_request SET status = 'fnf_pending', updated_at = NOW() WHERE id = ?`,
      [req.params.exitId]
    );
    return res.json({ success: true, message: "Status updated to fnf_pending" });
  })
);

// POST /:exitId/close — close the exit request
resignationRouter.post(
  "/:exitId/close",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await db.execute(
      `UPDATE exit_request
       SET status = 'closed', closed_at = NOW(), closed_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [req.authUser!.id, req.params.exitId]
    );
    await db.execute(
      `INSERT INTO exit_retention_action
         (id, exit_request_id, action_type, action_summary, outcome, performed_by, performed_at)
       VALUES (UUID(), ?, 'status_change', 'Exit request closed', 'closed', ?, NOW())`,
      [req.params.exitId, req.authUser!.id]
    );
    return res.json({ success: true, message: "Exit request closed" });
  })
);

// ── Audit & List Routes ───────────────────────────────────────────────────────

// GET /:exitId/audit — audit trail for an exit request
resignationRouter.get(
  "/:exitId/audit",
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute(
      `SELECT era.*, u.full_name AS performed_by_name
       FROM exit_retention_action era
       LEFT JOIN users u ON u.id = era.performed_by
       WHERE era.exit_request_id = ?
       ORDER BY era.performed_at ASC`,
      [req.params.exitId]
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
    params.push(Number(limit), Number(offset));
    const [rows] = await db.execute(
      `SELECT er.*,
              COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
              e.employee_code, e.branch_id
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
       WHERE ${where}
       ORDER BY er.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return res.json({ success: true, data: rows });
  })
);
