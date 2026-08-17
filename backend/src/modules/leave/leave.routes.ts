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

/**
 * GET /requests/my — the caller's own leave requests, whoever they are.
 *
 * The dashboard activity feed has always called this and it never existed, so the request
 * 404'd on every load. The feed uses Promise.allSettled, so the rejection was absorbed and
 * leave simply never appeared among a user's recent activity — no error, just a feed that
 * silently omitted half of what it promised.
 *
 * Distinct from GET /requests, which widens for privileged roles: an admin asking /requests
 * gets their whole branch, which is not what "my recent activity" means. Here employeeId is
 * forced to the caller for everyone, so the answer cannot widen with the caller's role.
 *
 * Registered before /requests/:id/review so "my" is never read as an id.
 */
leaveRouter.get("/requests/my", h(async (req: AuthenticatedRequest, res: Response) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  // A login with no employee record has no leave of its own. That is an empty feed, not an
  // error — the dashboard renders for such accounts too.
  if (!callerEmp) return res.json({ success: true, data: [], total: 0 });

  const query = req.query as Record<string, unknown>;
  query.employeeId = callerEmp.id;
  return leaveController.listRequests(req, res);
}));

// GET /requests and PATCH /requests/:id/review used to be defined here, but both
// are dead code: app.ts mounts leaveSecureRouter at /api/leave before leaveRouter,
// and Express's router.use() stops at the first router with a matching route —
// leaveSecureRouter's own GET /requests and PATCH /requests/:id/review (which has
// real DB-backed reporting-manager scope, via resolveEffectiveApprover) always won.
// This file's PATCH /requests/:id/review was requireRole("admin","hr","manager")
// with NO row-scope check at all — reachable only by accident (e.g. a future
// change to app.ts's mount order), it would let any "manager"-role user approve
// any employee's leave. Removed rather than left dormant. (2026-08-13 audit)
//
// GET /requests/legacy — REMOVED 2026-08-17.
// Historical leave data (2018–2026) fully migrated from db_bill into mas_hrms.leave_request
// via scripts/migrate-leave-history-full.ts (27,209 records).
// mas_hrms is now the sole source of truth for all leave history.

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
  // generatedAt lets the dashboard's Source Freshness panel show when this was
  // computed. Without it the panel read "Timestamp unavailable" (CEO UAT); these
  // figures are calculated live per request, so request time IS the freshness.
  return res.json({ success: true, data, generatedAt: new Date().toISOString() });
}));

leaveRouter.get("/holidays",                      h(leaveController.listHolidays.bind(leaveController)));  // All can view
leaveRouter.post("/holidays",                     requireRole("admin", "hr", "super_admin"), h(leaveController.createHoliday.bind(leaveController)));

// POST /balance/seed — bulk seed leave balances during onboarding
//
// SECURITY/DATA-INTEGRITY (2026-08-13 audit): this writes allocated_days directly,
// bypassing reviewRequest()'s "duration > availableBalance" guard, so it could push
// an existing employee's balance negative (allocated_days cut below their existing
// used_days) with no signal. Not blocked outright — HR may be deliberately
// correcting an allocation, including one below current usage — but every such
// row is now flagged back in the response instead of happening silently.
leaveRouter.post("/balance/seed", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const rows = req.body as Array<{ employee_id: string; leave_type_id: string; year: number; allocated_days: number }>;
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Array required" });
  const negativeBalanceWarnings: Array<{ employee_id: string; leave_type_id: string; year: number; allocated_days: number; used_days: number; adjusted_days: number; would_be_available: number }> = [];
  for (const row of rows) {
    if (!row.employee_id || !row.leave_type_id || !row.year || row.allocated_days === undefined) continue;

    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT used_days, adjusted_days FROM leave_balance_ledger
        WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ? LIMIT 1`,
      [row.employee_id, row.leave_type_id, row.year]
    );
    const existing = existingRows[0] as { used_days?: number; adjusted_days?: number } | undefined;
    const usedDays = Number(existing?.used_days ?? 0);
    const adjustedDays = Number(existing?.adjusted_days ?? 0);
    const wouldBeAvailable = Number(row.allocated_days) + adjustedDays - usedDays;
    if (wouldBeAvailable < 0) {
      negativeBalanceWarnings.push({
        employee_id: row.employee_id, leave_type_id: row.leave_type_id, year: row.year,
        allocated_days: row.allocated_days, used_days: usedDays, adjusted_days: adjustedDays,
        would_be_available: wouldBeAvailable,
      });
    }

    await db.execute(
      `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
       VALUES (?, ?, ?, ?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE allocated_days = VALUES(allocated_days)`,
      [randomUUID(), row.employee_id, row.leave_type_id, row.year, row.allocated_days]
    );
  }
  res.json({ success: true, count: rows.length, negativeBalanceWarnings });
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

  // MTRL (Maternity Leave, 180 days) = female only; PL/PTRL = male only;
  // all other types, including ML, = everyone.
  //
  // CORRECTED (2026-08-13, live-DB verified): ML was renamed from "Maternity
  // Leave" to "Medical Leave" by migration 204 (confirmed applied
  // 2026-06-17) and is meant for all employees — MTRL is the dedicated
  // maternity type that replaced ML's old meaning. This endpoint still
  // gated ML as female-only, so it had been hiding "Medical Leave" from
  // every male employee since that rename.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, leave_code, leave_name, max_days_per_year, carry_forward, requires_approval, paid_leave
     FROM leave_type_master
     WHERE active_status = 1
       AND (
         leave_code NOT IN ('MTRL','PL','PTRL')
         OR (leave_code = 'MTRL' AND ?)
         OR (leave_code IN ('PL','PTRL') AND ?)
       )
     ORDER BY leave_name ASC`,
    [isFemale ? 1 : 0, isMale ? 1 : 0]
  );
  res.json({ success: true, data: rows });
}));

// POST /admin/sync-used-days-from-db-bill — sync 2026 used_days from db_bill (admin/hr only)
//
// SECURITY/DATA-INTEGRITY (2026-08-13 audit): writes used_days directly with no
// comparison to allocated_days+adjusted_days, unlike reviewRequest()'s guard. Not
// blocked outright — db_bill's historical usage is the real ground truth this sync
// exists to backfill, and it may legitimately exceed what mas_hrms was ever
// allocated — but any row this would push into a negative available balance is
// now flagged back in the response instead of happening silently.
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
  const negativeBalanceWarnings: Array<{ employee_code: string; leave_code: string; allocated_days: number; adjusted_days: number; new_used_days: number; would_be_available: number }> = [];
  for (const row of dbBillRows) {
    const empId = empMap[row.EmpCode];
    if (!empId) continue;
    for (const { col, code } of cols) {
      const usedDays = Number(row[col] ?? 0);
      if (usedDays <= 0) continue;
      const ltId = ltMap[code];
      if (!ltId) continue;
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id, used_days, allocated_days, adjusted_days FROM leave_balance_ledger WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [empId, ltId, year]
      );
      if (!existing.length) continue;
      const currentUsed = Number(existing[0].used_days ?? 0);
      if (currentUsed >= usedDays) continue;
      const allocatedDays = Number(existing[0].allocated_days ?? 0);
      const adjustedDays = Number(existing[0].adjusted_days ?? 0);
      const wouldBeAvailable = allocatedDays + adjustedDays - usedDays;
      if (wouldBeAvailable < 0) {
        negativeBalanceWarnings.push({
          employee_code: row.EmpCode, leave_code: code, allocated_days: allocatedDays,
          adjusted_days: adjustedDays, new_used_days: usedDays, would_be_available: wouldBeAvailable,
        });
      }
      await db.execute(
        `UPDATE leave_balance_ledger SET used_days = ? WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [usedDays, empId, ltId, year]
      );
      updated++;
    }
  }

  res.json({ success: true, message: `Synced ${year} used_days from db_bill`, updated, employees: dbBillRows.length, negativeBalanceWarnings });
}));
