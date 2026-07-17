import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { getLegacyPool } from "../../db/legacyDb.js";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";
import { leaveController } from "./leave.controller.js";
import { leaveService } from "./leave.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

async function isLeavePrivileged(userId: string): Promise<boolean> {
  return hasRole(userId, "super_admin", "admin", "hr", "manager", "payroll_head", "payroll_admin");
}

leaveRouter.get("/types",                         h(leaveController.listLeaveTypes.bind(leaveController)));  // All can view
leaveRouter.post("/types", requireRole("admin", "hr", "super_admin"), h(leaveController.createLeaveType.bind(leaveController)));

// PUT /types/:id — update leave type (admin/hr)
leaveRouter.put(
  "/types/:id",
  requireRole("admin", "hr", "super_admin"),
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
leaveRouter.post("/requests", requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
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

// Employee self-scope: employees see only their own leave requests; privileged roles filtered by branch.
leaveRouter.get("/requests", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const privileged = await isLeavePrivileged(userId);
  if (!privileged) {
    const callerEmp = await getEmployeeForUser(userId);
    if (!callerEmp) return res.status(403).json({ success: false, message: "No employee record linked to your login" });
    (req.query as Record<string, unknown>).employeeId = callerEmp.id;
  } else {
    // super_admin sees all; head-office admin/hr see all; others scoped to their branch
    const isSuperAdmin = await hasRole(userId, "super_admin");
    if (!isSuperAdmin) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT bm.branch_name
           FROM employees e
           JOIN branch_master bm ON bm.id = e.branch_id
          WHERE e.user_id = ? AND e.active_status = 1
          LIMIT 1`,
        [userId]
      );
      const empBranch = (empRows[0] as any)?.branch_name ?? "";
      const isHO = /head\s*office/i.test(empBranch);
      if (!isHO) {
        const scoped = await buildScopeWhereClause(
          userId,
          ["admin", "hr", "manager"],
          { branchId: "e.branch_id" },
          { allowCeoAllRead: true }
        );
        (req as any).scopeFilter = scoped;
      }
    }
  }
  return leaveController.listRequests(req, res);
}));

leaveRouter.patch("/requests/:id/review", requireRole("admin", "hr", "manager"), h(leaveController.reviewRequest.bind(leaveController)));

// GET /requests/legacy?employeeId=&year= — historical leave records from db_bill
leaveRouter.get("/requests/legacy", h(async (req: AuthenticatedRequest, res: Response) => {
  const privileged = await isLeavePrivileged(req.authUser!.id);
  let employeeId = String(req.query.employeeId ?? "");
  if (!privileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp) return res.status(403).json({ success: false, message: "No employee record" });
    employeeId = callerEmp.id;
  }
  if (!employeeId) return res.status(400).json({ success: false, message: "employeeId required" });

  // Resolve employee_code from mas_hrms
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT employee_code FROM employees WHERE id = ? LIMIT 1", [employeeId]
  );
  const empCode = (empRows[0] as any)?.employee_code;
  if (!empCode) return res.json({ success: true, data: [] });

  const year = req.query.year ? Number(req.query.year) : null;
  const legacy = await getLegacyPool();

  const params: any[] = [empCode];
  let yearCond = "";
  if (year) { yearCond = " AND YEAR(LeaveFrom) = ?"; params.push(year); }

  const [rows] = await legacy.execute<RowDataPacket[]>(`
    SELECT
      Id                                                  AS id,
      EmpCode                                             AS emp_code,
      LeaveFrom                                           AS from_date,
      LeaveTo                                             AS to_date,
      LeaveType                                           AS leave_type_code,
      COALESCE(CL,0)+COALESCE(EL,0)+COALESCE(ML,0)+COALESCE(PTRL,0)+COALESCE(MTRL,0)+COALESCE(LWP,0) AS total_days,
      CASE Status
        WHEN 'Approved'     THEN 'approved'
        WHEN 'Not Approved' THEN 'rejected'
        WHEN 'Pending'      THEN 'pending'
        ELSE LOWER(Status)
      END                                                 AS status,
      TRIM(Purpose)                                       AS reason,
      CreateDate                                          AS created_at
    FROM leave_management
    WHERE EmpCode = ?${yearCond}
    ORDER BY LeaveFrom DESC
    LIMIT 200
  `, params);

  return res.json({ success: true, data: rows });
}));

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
leaveRouter.post("/holidays",                     requireRole("admin", "hr", "super_admin"), h(leaveController.createHoliday.bind(leaveController)));

// POST /balance/seed — bulk seed leave balances during onboarding
leaveRouter.post("/balance/seed", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
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

// GET /eligibility/:employeeId — returns leave types eligible for this employee (gender-filtered)
leaveRouter.get("/eligibility/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const isPrivileged = await hasRole(req.authUser!.id, "admin", "super_admin", "hr", "hr_admin", "wfm", "branch_head");
  if (!isPrivileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only view your own leave eligibility" });
    }
  }
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT gender FROM employees WHERE id = ? LIMIT 1", [employeeId]
  );
  const gender = ((empRows[0] as any)?.gender ?? "").toLowerCase().trim();
  const isFemale = ["female", "f"].includes(gender);
  const isMale   = ["male", "m"].includes(gender);

  // ML/MTRL = female only; PL/PTRL = male only; all other types = everyone
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave
     FROM leave_type_master
     WHERE active_status = 1
       AND (
         leave_code NOT IN ('ML','MTRL','PL','PTRL')
         OR (leave_code IN ('ML','MTRL') AND ?)
         OR (leave_code IN ('PL','PTRL') AND ?)
       )
     ORDER BY leave_name ASC`,
    [isFemale ? 1 : 0, isMale ? 1 : 0]
  );
  res.json({ success: true, data: rows });
}));

// POST /admin/sync-used-days-from-db-bill — sync 2026 used_days from db_bill (admin/hr only)
leaveRouter.post("/admin/sync-used-days-from-db-bill", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const year = Number(req.query.year ?? 2026);
  const legacy = await getLegacyPool();

  const [dbBillRows] = await legacy.execute<RowDataPacket[]>(`
    SELECT EmpCode,
      COALESCE(SUM(CL), 0)   AS cl_used,
      COALESCE(SUM(EL), 0)   AS el_used,
      COALESCE(SUM(ML), 0)   AS ml_used,
      COALESCE(SUM(PTRL), 0) AS ptrl_used,
      COALESCE(SUM(MTRL), 0) AS mtrl_used
    FROM leave_management
    WHERE YEAR(LeaveFrom) = ? AND Status = 'Approved'
    GROUP BY EmpCode
  `, [year]);

  const [ltRows] = await db.execute<RowDataPacket[]>(`SELECT id, leave_code FROM leave_type_master WHERE active_status = 1`);
  const ltMap: Record<string, string> = {};
  for (const lt of ltRows) ltMap[lt.leave_code] = lt.id;

  const [empRows] = await db.execute<RowDataPacket[]>(`SELECT id, employee_code FROM employees WHERE active_status = 1`);
  const empMap: Record<string, string> = {};
  for (const e of empRows) empMap[e.employee_code] = e.id;

  const cols = [
    { col: 'cl_used', code: 'CL' }, { col: 'el_used', code: 'EL' },
    { col: 'ml_used', code: 'ML' }, { col: 'ptrl_used', code: 'PTRL' },
    { col: 'mtrl_used', code: 'MTRL' },
  ];

  let updated = 0;
  for (const row of dbBillRows) {
    const empId = empMap[row.EmpCode];
    if (!empId) continue;
    for (const { col, code } of cols) {
      const usedDays = Number(row[col] ?? 0);
      if (usedDays <= 0) continue;
      const ltId = ltMap[code];
      if (!ltId) continue;
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id, used_days FROM leave_balance_ledger WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [empId, ltId, year]
      );
      if (!existing.length) continue;
      const currentUsed = Number(existing[0].used_days ?? 0);
      if (currentUsed >= usedDays) continue;
      await db.execute(
        `UPDATE leave_balance_ledger SET used_days = ? WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [usedDays, empId, ltId, year]
      );
      updated++;
    }
  }

  res.json({ success: true, message: `Synced ${year} used_days from db_bill`, updated, employees: dbBillRows.length });
}));
