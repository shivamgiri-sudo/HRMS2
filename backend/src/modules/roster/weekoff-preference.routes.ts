import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasProcessScope, hasRole } from "../../shared/accessGuard.js";

export const weekoffPreferenceRouter = Router();
weekoffPreferenceRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayName(value: unknown) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  return DAY_NAMES[n];
}

function dayNumber(value: unknown) {
  const s = String(value ?? "");
  const idx = DAY_NAMES.findIndex((d) => d.toLowerCase() === s.toLowerCase());
  return idx >= 0 ? idx : null;
}

function apiStatus(dbStatus: string | null | undefined) {
  if (dbStatus === "approved") return "accepted";
  if (dbStatus === "rejected") return "rejected";
  return "submitted";
}

function dbStatus(apiStatusValue: unknown) {
  const status = String(apiStatusValue ?? "accepted");
  if (status === "rejected") return "rejected";
  if (["accepted", "applied", "approved"].includes(status)) return "approved";
  return "pending";
}

weekoffPreferenceRouter.post("/weekoff-preferences", h(async (req, res) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp?.id) return res.status(403).json({ success: false, message: "No employee record" });

  const weekStartDate = String(req.body?.weekStartDate ?? req.body?.week_start_date ?? "").slice(0, 10);
  const preferred = dayName(req.body?.preferredDay1 ?? req.body?.preferred_day_1);
  const alternate = dayName(req.body?.preferredDay2 ?? req.body?.preferred_day_2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) return res.status(400).json({ success: false, message: "weekStartDate is required in YYYY-MM-DD format" });
  if (!preferred) return res.status(400).json({ success: false, message: "preferredDay1 must be 0-6" });

  const notes = req.body?.reason ?? (alternate ? `Alternate: ${alternate}` : null);
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_roster_preference WHERE employee_id = ? AND effective_from = ? LIMIT 1`,
    [emp.id, weekStartDate],
  );

  if (existing[0]?.id) {
    await db.execute(
      `UPDATE employee_roster_preference
          SET preferred_week_off = ?, notes = ?, status = 'pending', approved_by = NULL, approved_at = NULL, rejection_reason = NULL
        WHERE id = ?`,
      [preferred, notes, existing[0].id],
    );
  } else {
    await db.execute(
      `INSERT INTO employee_roster_preference
         (id, employee_id, preferred_shift_id, preferred_week_off, flexibility, notes, effective_from, status, created_by)
       VALUES (?, ?, NULL, ?, 'fixed', ?, ?, 'pending', ?)`,
      [randomUUID(), emp.id, preferred, notes, weekStartDate, req.authUser!.id],
    );
  }

  return res.status(201).json({ success: true, message: "Week-off preference submitted" });
}));

weekoffPreferenceRouter.get("/weekoff-preferences", h(async (req, res) => {
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
    where.push("e.process_id = ?");
    params.push(processId);
  }

  if (weekStartDate) {
    where.push("p.effective_from = ?");
    params.push(weekStartDate);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id,
            p.employee_id,
            e.process_id,
            e.branch_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            b.branch_name,
            pm.process_name,
            DATE_FORMAT(p.effective_from, '%Y-%m-%d') AS week_start_date,
            p.preferred_week_off,
            p.notes AS reason,
            p.status AS db_status,
            p.rejection_reason AS manager_remarks,
            p.approved_at AS reviewed_at,
            p.created_at
       FROM employee_roster_preference p
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.created_at DESC
      LIMIT 500`,
    params,
  );

  const data = rows.map((row: any) => ({
    ...row,
    preferred_day_1: dayNumber(row.preferred_week_off),
    preferred_day_2: null,
    status: apiStatus(row.db_status),
  }));
  return res.json({ success: true, data });
}));

weekoffPreferenceRouter.patch("/weekoff-preferences/:id", h(async (req, res) => {
  const [prefRows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*, e.process_id, e.branch_id
       FROM employee_roster_preference p
       LEFT JOIN employees e ON e.id = p.employee_id
      WHERE p.id = ?
      LIMIT 1`,
    [req.params.id],
  );
  const pref = prefRows[0];
  if (!pref) return res.status(404).json({ success: false, message: "Preference not found" });

  const broad = await hasRole(req.authUser!.id, "admin", "hr", "wfm");
  const scoped = await hasProcessScope(req.authUser!.id, String(pref.process_id), pref.branch_id as string | null, "manager", "wfm", "assistant_manager", "tl");
  if (!broad && !scoped) return res.status(403).json({ success: false, message: "Forbidden" });

  const status = dbStatus(req.body?.status);
  await db.execute(
    `UPDATE employee_roster_preference
        SET status = ?, rejection_reason = ?, approved_by = ?, approved_at = NOW()
      WHERE id = ?`,
    [status, req.body?.remarks ?? null, req.authUser!.id, req.params.id],
  );

  return res.json({ success: true, message: "Week-off preference updated" });
}));
