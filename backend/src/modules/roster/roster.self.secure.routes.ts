import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

export const rosterSelfSecureRouter = Router();
rosterSelfSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function statusList(raw: unknown): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

rosterSelfSecureRouter.get("/my-cycles", h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp?.id) return res.status(403).json({ success: false, message: "No employee record" });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
    [emp.id],
  );
  const processId = empRows[0]?.process_id as string | undefined;
  const branchId = empRows[0]?.branch_id as string | undefined;
  if (!processId) return res.json({ success: true, data: [] });

  const statuses = statusList(req.query.status);
  const statusSql = statuses.length ? `AND status IN (${statuses.map(() => "?").join(",")})` : "";
  const params: unknown[] = [processId, branchId ?? null, branchId ?? null, ...statuses];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_id, branch_id,
            DATE_FORMAT(week_start_date, '%Y-%m-%d') AS week_start_date,
            DATE_FORMAT(week_end_date, '%Y-%m-%d') AS week_end_date,
            status, published_at
       FROM weekly_roster_cycle
      WHERE process_id = ?
        AND (branch_id = ? OR ? IS NULL OR branch_id IS NULL)
        ${statusSql}
      ORDER BY week_start_date DESC
      LIMIT 26`,
    params,
  );
  return res.json({ success: true, data: rows });
}));

rosterSelfSecureRouter.get("/my-roster/:cycleId", h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp?.id) return res.status(403).json({ success: false, message: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rda.id,
            rda.cycle_id,
            rda.employee_id,
            DATE_FORMAT(rda.roster_date, '%Y-%m-%d') AS roster_date,
            rda.shift_template_id,
            st.shift_name,
            st.start_time,
            st.end_time,
            rda.is_week_off,
            rda.is_holiday,
            rda.acknowledgement_status,
            rda.acknowledged_at,
            rda.notes
       FROM roster_daily_assignment rda
       JOIN weekly_roster_cycle c ON c.id = rda.cycle_id
       LEFT JOIN wfm_shift_template st ON st.id = rda.shift_template_id
      WHERE rda.cycle_id = ?
        AND rda.employee_id = ?
        AND c.status IN ('published','acknowledged','active','attendance_locked','payroll_input_ready','closed')
      ORDER BY rda.roster_date ASC`,
    [req.params.cycleId, emp.id],
  );
  return res.json({ success: true, data: rows });
}));
