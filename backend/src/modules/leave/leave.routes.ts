import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";
import { leaveController } from "./leave.controller.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

async function isLeavePrivileged(userId: string): Promise<boolean> {
  return hasRole(userId, "admin", "hr", "manager");
}

leaveRouter.get("/types",                         h(leaveController.listLeaveTypes.bind(leaveController)));  // All can view
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

// Employee self-scope: employees can submit only their own leave request.
leaveRouter.post("/requests", h(async (req: AuthenticatedRequest, res: Response) => {
  const privileged = await isLeavePrivileged(req.authUser!.id);
  if (!privileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp) return res.status(403).json({ success: false, message: "No employee record linked to your login" });
    if (!req.body.employeeId) req.body.employeeId = callerEmp.id;
    if (req.body.employeeId !== callerEmp.id) {
      return res.status(403).json({ success: false, message: "Forbidden: you may submit leave only for yourself" });
    }
  }
  return leaveController.submitRequest(req, res);
}));

// Employee self-scope: employees see only their own leave requests; privileged roles can filter/list.
leaveRouter.get("/requests", h(async (req: AuthenticatedRequest, res: Response) => {
  const privileged = await isLeavePrivileged(req.authUser!.id);
  if (!privileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp) return res.status(403).json({ success: false, message: "No employee record linked to your login" });
    (req.query as Record<string, unknown>).employeeId = callerEmp.id;
  }
  return leaveController.listRequests(req, res);
}));

leaveRouter.patch("/requests/:id/review",         requireRole("admin", "hr", "manager"), h(leaveController.reviewRequest.bind(leaveController)));

// Employee self-scope: employees can view only their own leave balance.
leaveRouter.get("/balance/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const privileged = await isLeavePrivileged(req.authUser!.id);
  if (!privileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may view only your own leave balance" });
    }
  }
  return leaveController.getBalance(req, res);
}));

leaveRouter.get("/balance", h(async (req: AuthenticatedRequest, res: Response) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  if (!callerEmp) {
    return res.status(403).json({ success: false, message: "No employee record linked to your login" });
  }
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  const data = await leaveService.getBalance(callerEmp.id, year);
  return res.json({ success: true, data });
}));

leaveRouter.get("/holidays",                      h(leaveController.listHolidays.bind(leaveController)));  // All can view
leaveRouter.post("/holidays",                     requireRole("admin", "hr"), h(leaveController.createHoliday.bind(leaveController)));

// POST /balance/seed — bulk seed leave balances during onboarding
leaveRouter.post("/balance/seed", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body as Array<{ employee_id: string; leave_type_id: string; year: number; allocated_days: number }>;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Array required" });
  for (const row of rows) {
    if (!row.employee_id || !row.leave_type_id || !row.year || row.allocated_days === undefined) continue;
    await db.execute(
      `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
       VALUES (?, ?, ?, ?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE allocated_days = VALUES(allocated_days)`,
      [randomUUID(), row.employee_id, row.leave_type_id, row.year, row.allocated_days]
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
