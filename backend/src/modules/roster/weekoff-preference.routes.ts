import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasProcessScope, hasRole } from "../../shared/accessGuard.js";

export const weekoffPreferenceRouter = Router();
weekoffPreferenceRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

async function ensureTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS roster_weekoff_preference (
    id CHAR(36) NOT NULL PRIMARY KEY,
    employee_id CHAR(36) NOT NULL,
    process_id CHAR(36) NULL,
    branch_id CHAR(36) NULL,
    week_start_date DATE NOT NULL,
    preferred_day_1 TINYINT NOT NULL,
    preferred_day_2 TINYINT NULL,
    reason VARCHAR(500) NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted',
    manager_remarks VARCHAR(500) NULL,
    reviewed_by CHAR(36) NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_roster_weekoff_employee_week (employee_id, week_start_date),
    KEY idx_roster_weekoff_process_week (process_id, week_start_date, status),
    KEY idx_roster_weekoff_employee (employee_id)
  )`);
}

function validDay(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 6;
}

weekoffPreferenceRouter.post("/weekoff-preferences", h(async (req, res) => {
  await ensureTable();
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp?.id) return res.status(403).json({ success: false, message: "No employee record" });

  const weekStartDate = String(req.body?.weekStartDate ?? req.body?.week_start_date ?? "").slice(0, 10);
  const day1 = req.body?.preferredDay1 ?? req.body?.preferred_day_1;
  const day2 = req.body?.preferredDay2 ?? req.body?.preferred_day_2 ?? null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) return res.status(400).json({ success: false, message: "weekStartDate is required in YYYY-MM-DD format" });
  if (!validDay(day1)) return res.status(400).json({ success: false, message: "preferredDay1 must be 0-6" });
  if (day2 !== null && day2 !== undefined && !validDay(day2)) return res.status(400).json({ success: false, message: "preferredDay2 must be 0-6" });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
    [emp.id],
  );
  const processId = empRows[0]?.process_id ?? null;
  const branchId = empRows[0]?.branch_id ?? null;

  await db.execute(
    `INSERT INTO roster_weekoff_preference
       (id, employee_id, process_id, branch_id, week_start_date, preferred_day_1, preferred_day_2, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
     ON DUPLICATE KEY UPDATE
       process_id = VALUES(process_id), branch_id = VALUES(branch_id),
       preferred_day_1 = VALUES(preferred_day_1), preferred_day_2 = VALUES(preferred_day_2),
       reason = VALUES(reason), status = 'submitted', manager_remarks = NULL,
       reviewed_by = NULL, reviewed_at = NULL`,
    [randomUUID(), emp.id, processId, branchId, weekStartDate, Number(day1), day2 == null ? null : Number(day2), req.body?.reason ?? null],
  );

  return res.status(201).json({ success: true, message: "Week-off preference submitted" });
}));

weekoffPreferenceRouter.get("/weekoff-preferences", h(async (req, res) => {
  await ensureTable();
  const userId = req.authUser!.id;
  const processId = String(req.query.processId ?? req.query.process_id ?? "");
  const weekStartDate = String(req.query.weekStartDate ?? req.query.week_start_date ?? "").slice(0, 10);
  const own = String(req.query.own ?? "") === "1";

  const params: unknown[] = [];
  const where: string[] = [];

  if (own) {
    const emp = await getEmployeeForUser(userId);
    if (!emp?.id) return res.status(403).json({ success: false, message: "No employee record" });
    where.push("p.employee_id = ?");
    params.push(emp.id);
  } else {
    if (!processId) return res.status(400).json({ success: false, message: "processId is required" });
    const broad = await hasRole(userId, "admin", "hr", "wfm");
    const scoped = await hasProcessScope(userId, processId, null, "manager", "wfm", "assistant_manager", "tl");
    if (!broad && !scoped) return res.status(403).json({ success: false, message: "Forbidden: mapped process scope required" });
    where.push("p.process_id = ?");
    params.push(processId);
  }

  if (weekStartDate) {
    where.push("p.week_start_date = ?");
    params.push(weekStartDate);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            b.branch_name,
            pm.process_name
       FROM roster_weekoff_preference p
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN branch_master b ON b.id = p.branch_id
       LEFT JOIN process_master pm ON pm.id = p.process_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.created_at DESC
      LIMIT 500`,
    params,
  );

  return res.json({ success: true, data: rows });
}));

weekoffPreferenceRouter.patch("/weekoff-preferences/:id", h(async (req, res) => {
  await ensureTable();
  const [prefRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM roster_weekoff_preference WHERE id = ? LIMIT 1`, [req.params.id]);
  const pref = prefRows[0];
  if (!pref) return res.status(404).json({ success: false, message: "Preference not found" });

  const broad = await hasRole(req.authUser!.id, "admin", "hr", "wfm");
  const scoped = await hasProcessScope(req.authUser!.id, String(pref.process_id), pref.branch_id as string | null, "manager", "wfm");
  if (!broad && !scoped) return res.status(403).json({ success: false, message: "Forbidden" });

  const status = String(req.body?.status ?? "accepted");
  if (!["accepted", "rejected", "applied", "submitted"].includes(status)) return res.status(400).json({ success: false, message: "Invalid status" });

  await db.execute(
    `UPDATE roster_weekoff_preference
        SET status = ?, manager_remarks = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE id = ?`,
    [status, req.body?.remarks ?? null, req.authUser!.id, req.params.id],
  );

  return res.json({ success: true, message: "Week-off preference updated" });
}));
