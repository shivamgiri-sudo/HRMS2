import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/rm-change/search-managers - search for potential managers
router.get("/search-managers", h(async (req: any, res: any) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) {
    return res.json({ ok: true, data: [] });
  }

  const searchPattern = `%${query}%`;
  const currentEmployee = await getEmployeeForUser(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            d.designation_name
     FROM employees e
     LEFT JOIN designation_master d ON d.id = e.designation_id
     WHERE e.active_status = 1
       AND LOWER(e.employment_status) = 'active'
       AND e.id <> ?
       AND (CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) LIKE ? OR e.employee_code LIKE ?)
     ORDER BY e.first_name ASC
     LIMIT 20`,
    [currentEmployee?.id ?? "", searchPattern, searchPattern]
  );

  return res.json({ ok: true, data: rows });
}));

// GET /api/rm-change/my-requests - list own change requests
router.get("/my-requests", h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ ok: false, message: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rm.*,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            CONCAT(cm.first_name, ' ', COALESCE(cm.last_name, '')) AS current_manager_name,
            CONCAT(nm.first_name, ' ', COALESCE(nm.last_name, '')) AS requested_manager_name
     FROM rm_change_requests rm
     JOIN employees e ON e.id = rm.employee_id
     LEFT JOIN employees cm ON cm.id = rm.current_manager_id
     LEFT JOIN employees nm ON nm.id = rm.requested_manager_id
     WHERE rm.employee_id = ?
     ORDER BY rm.created_at DESC`,
    [emp.id]
  );

  return res.json({ ok: true, data: rows });
}));

// GET /api/rm-change/pending - list pending requests for approval (WFM/HR/Admin)
router.get("/pending", requireRole("admin", "hr", "wfm"), h(async (req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rm.*,
            e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            CONCAT(cm.first_name, ' ', COALESCE(cm.last_name, '')) AS current_manager_name,
            CONCAT(nm.first_name, ' ', COALESCE(nm.last_name, '')) AS requested_manager_name,
            b.branch_name
     FROM rm_change_requests rm
     JOIN employees e ON e.id = rm.employee_id
     LEFT JOIN employees cm ON cm.id = rm.current_manager_id
     LEFT JOIN employees nm ON nm.id = rm.requested_manager_id
     LEFT JOIN branch_master b ON b.id = rm.branch_id
     WHERE rm.status = 'pending'
     ORDER BY rm.created_at DESC`
  );

  return res.json({ ok: true, data: rows });
}));

// POST /api/rm-change - submit a reporting manager change request
router.post("/", h(async (req: any, res: any) => {
  const basicEmp = await getEmployeeForUser(req.authUser!.id);
  if (!basicEmp) return res.status(403).json({ ok: false, message: "No employee record" });

  // Fetch full employee details
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, reporting_manager_id FROM employees WHERE id = ? LIMIT 1`,
    [basicEmp.id]
  );
  const emp = empRows[0];

  const { requested_manager_id, reason } = req.body;
  if (!requested_manager_id) {
    return res.status(400).json({ ok: false, message: "requested_manager_id required" });
  }
  if (requested_manager_id === emp.id) {
    return res.status(400).json({ ok: false, message: "You cannot assign yourself as reporting manager" });
  }

  // Check if there's already a pending request
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM rm_change_requests
     WHERE employee_id = ? AND status = 'pending' LIMIT 1`,
    [emp.id]
  );

  if (existing.length > 0) {
    return res.status(400).json({
      ok: false,
      message: "You already have a pending reporting manager change request"
    });
  }

  // Verify the requested manager exists and is active
  const [managerCheck] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees
     WHERE id = ? AND active_status = 1 AND LOWER(employment_status) = 'active' LIMIT 1`,
    [requested_manager_id]
  );

  if (managerCheck.length === 0) {
    return res.status(400).json({ ok: false, message: "Invalid manager selected" });
  }

  // Create the request
  const requestId = randomUUID();
  await db.execute(
    `INSERT INTO rm_change_requests
     (id, employee_id, branch_id, current_manager_id, requested_manager_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
    [requestId, emp.id, emp.branch_id, emp.reporting_manager_id, requested_manager_id, reason || null]
  );

  return res.status(201).json({ success: true, ok: true, data: { id: requestId } });
}));

// POST /api/rm-change/:id/action - approve or reject a request
router.post("/:id/action", requireRole("admin", "hr", "wfm"), h(async (req: any, res: any) => {
  const { id } = req.params;
  const { action, remarks } = req.body;

  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ ok: false, message: "action must be 'approved' or 'rejected'" });
  }

  // Get the request details
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM rm_change_requests WHERE id = ? LIMIT 1`,
    [id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ ok: false, message: "Request not found" });
  }

  const request = rows[0];

  if (request.status !== "pending") {
    return res.status(400).json({ ok: false, message: "Request is not pending" });
  }

  // Update the request status
  await db.execute(
    `UPDATE rm_change_requests
     SET status = ?, actioned_by = ?, actioned_at = NOW(), remarks = ?
     WHERE id = ?`,
    [action, req.authUser!.id, remarks || null, id]
  );

  // If approved, update the employee's reporting manager
  if (action === "approved") {
    await db.execute(
      `UPDATE employees
       SET reporting_manager_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [request.requested_manager_id, request.employee_id]
    );
  }

  return res.json({ ok: true, message: `Request ${action}` });
}));

export { router as rmChangeRouter };
