import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

const router = Router();
router.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) => fn(req, res).catch(next);

// GET /api/communication/preferences — get employee notification preferences
router.get("/preferences", h(async (req: any, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser?.id);
  if (!emp) return res.status(404).json({ success: false, error: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id,
            email_on_leave_approval, email_on_leave_rejection,
            email_on_attendance_mark, email_on_payroll_ready,
            email_on_performance_review, email_on_promotion,
            sms_on_leave_approval, sms_on_attendance_mark,
            in_app_on_leave_approval, in_app_on_payroll_ready,
            push_notifications_enabled,
            created_at, updated_at
     FROM communication_preferences
     WHERE employee_id = ?
     LIMIT 1`,
    [emp.id]
  );

  if (!rows.length) {
    return res.json({
      success: true,
      data: {
        employee_id: emp.id,
        email_on_leave_approval: true,
        email_on_leave_rejection: true,
        email_on_attendance_mark: false,
        email_on_payroll_ready: true,
        email_on_performance_review: true,
        email_on_promotion: true,
        sms_on_leave_approval: false,
        sms_on_attendance_mark: false,
        in_app_on_leave_approval: true,
        in_app_on_payroll_ready: true,
        push_notifications_enabled: true,
      },
    });
  }

  return res.json({ success: true, data: rows[0] });
}));

// PATCH /api/communication/preferences — update notification preferences
router.patch("/preferences", h(async (req: any, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser?.id);
  if (!emp) return res.status(404).json({ success: false, error: "No employee record" });

  const updates = req.body;
  const allowedFields = [
    "email_on_leave_approval",
    "email_on_leave_rejection",
    "email_on_attendance_mark",
    "email_on_payroll_ready",
    "email_on_performance_review",
    "email_on_promotion",
    "sms_on_leave_approval",
    "sms_on_attendance_mark",
    "in_app_on_leave_approval",
    "in_app_on_payroll_ready",
    "push_notifications_enabled",
  ];

  const fields = Object.keys(updates).filter((k) => allowedFields.includes(k));
  if (!fields.length) {
    return res.status(400).json({ success: false, error: "No valid fields provided" });
  }

  const sets = fields.map((f) => `${f} = ?`).join(", ");
  const vals = fields.map((f) => (updates[f] !== null ? Boolean(updates[f]) : null));

  await db.execute(
    `INSERT INTO communication_preferences (id, employee_id, ${fields.join(", ")})
     VALUES (UUID(), ?, ${fields.map(() => "?").join(", ")})
     ON DUPLICATE KEY UPDATE ${sets}`,
    [emp.id, ...vals, ...vals]
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM communication_preferences WHERE employee_id = ? LIMIT 1`,
    [emp.id]
  );

  return res.json({ success: true, data: rows[0] });
}));

export const communicationRouter = router;
