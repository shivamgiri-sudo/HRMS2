import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";
import { leaveController } from "./leave.controller.js";

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

leaveRouter.get("/types",                         h(leaveController.listLeaveTypes.bind(leaveController)));
leaveRouter.post("/types", requireRole("admin", "hr"), h(leaveController.createLeaveType.bind(leaveController)));

// PUT /types/:id — update leave type (admin/hr)
leaveRouter.put(
  "/types/:id",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave } =
      req.body as {
        leave_name?: string;
        max_days_per_year?: number;
        carry_forward?: boolean;
        requires_approval?: boolean;
        paid_leave?: boolean;
      };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (leave_name !== undefined)       { sets.push("leave_name = ?");          params.push(leave_name); }
    if (max_days_per_year !== undefined) { sets.push("max_days_per_year = ?");   params.push(max_days_per_year); }
    if (carry_forward !== undefined)    { sets.push("carry_forward = ?");        params.push(carry_forward ? 1 : 0); }
    if (requires_approval !== undefined){ sets.push("requires_approval = ?");    params.push(requires_approval ? 1 : 0); }
    if (paid_leave !== undefined)       { sets.push("paid_leave = ?");           params.push(paid_leave ? 1 : 0); }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(id);
    const updateResult = await db.execute(
      `UPDATE leave_type_master SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ? AND active_status = 1`,
      params
    );
    const result = (updateResult as unknown as [{ affectedRows: number }, unknown])[0];

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Leave type not found" });
    }

    const selectResult = await db.execute("SELECT * FROM leave_type_master WHERE id = ? LIMIT 1", [id]);
    const rows = (selectResult as unknown as [unknown[], unknown])[0];
    return res.json({ success: true, data: (rows as unknown[])[0] });
  })
);

// DELETE /types/:id — soft-delete leave type (admin)
leaveRouter.delete(
  "/types/:id",
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const deleteResult = await db.execute(
      "UPDATE leave_type_master SET active_status = 0, updated_at = NOW() WHERE id = ? AND active_status = 1",
      [id]
    );
    const result = (deleteResult as unknown as [{ affectedRows: number }, unknown])[0];

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Leave type not found or already inactive" });
    }
    return res.json({ success: true, message: "Leave type deactivated" });
  })
);
leaveRouter.post("/requests",                     h(leaveController.submitRequest.bind(leaveController)));
leaveRouter.get("/requests",                      h(leaveController.listRequests.bind(leaveController)));
leaveRouter.patch("/requests/:id/review",         h(leaveController.reviewRequest.bind(leaveController)));
leaveRouter.get("/balance/:employeeId",           h(leaveController.getBalance.bind(leaveController)));
leaveRouter.get("/holidays",                      h(leaveController.listHolidays.bind(leaveController)));
leaveRouter.post("/holidays",                     h(leaveController.createHoliday.bind(leaveController)));

// POST /balance/seed — bulk seed leave balances during onboarding
leaveRouter.post("/balance/seed", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body as Array<{ employee_id: string; leave_type_id: string; year: number; allocated_days: number }>;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Array required" });
  for (const row of rows) {
    if (!row.employee_id || !row.leave_type_id || !row.year || row.allocated_days === undefined) continue;
    await db.execute(
      `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, balance_days)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE allocated_days = VALUES(allocated_days), balance_days = VALUES(allocated_days) - used_days`,
      [randomUUID(), row.employee_id, row.leave_type_id, row.year, row.allocated_days, row.allocated_days]
    );
  }
  res.json({ success: true, count: rows.length });
}));

// GET /eligibility/:employeeId — returns all active leave types (all employees are eligible)
leaveRouter.get("/eligibility/:employeeId", h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave FROM leave_type_master WHERE active_status = 1 ORDER BY leave_name ASC"
  );
  res.json({ success: true, data: rows });
}));
