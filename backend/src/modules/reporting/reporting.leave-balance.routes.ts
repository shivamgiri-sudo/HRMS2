import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { resolveBranchScope } from "./reporting.scope.js";

export const reportingLeaveBalanceRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function scopeSql(scope: { isSuperAdmin: boolean; branchIds: string[] }) {
  if (scope.isSuperAdmin || scope.branchIds.length === 0) return { sql: "1=1", params: [] as unknown[] };
  return { sql: `e.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`, params: scope.branchIds as unknown[] };
}

reportingLeaveBalanceRouter.get("/leave-balances", requireAuth, h(async (req: any, res: any) => {
  const year = Number(req.query.year ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, message: "year must be between 2000 and 2100" });
  }

  const scope = await resolveBranchScope(req.authUser!.id);
  const sc = scopeSql(scope);
  const extraConds: string[] = [];
  const extraParams: unknown[] = [];

  if (req.query.branchId) { extraConds.push("e.branch_id = ?"); extraParams.push(String(req.query.branchId)); }
  if (req.query.processId) { extraConds.push("e.process_id = ?"); extraParams.push(String(req.query.processId)); }
  if (req.query.costCentreId || req.query.costCenterId) {
    extraConds.push("e.cost_centre_id = ?");
    extraParams.push(String(req.query.costCentreId ?? req.query.costCenterId));
  }

  const extraSql = extraConds.length ? `AND ${extraConds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
            COALESCE(NULLIF(TRIM(dm.dept_name), ''), 'Unassigned') AS department_name,
            COALESCE(NULLIF(TRIM(b.branch_name), ''), 'Unassigned') AS branch_name,
            COALESCE(NULLIF(TRIM(p.process_name), ''), 'Unassigned') AS process_name,
            COALESCE(NULLIF(TRIM(cc.cost_centre_name), ''), 'Unassigned') AS cost_centre_name,
            lt.id AS leave_type_id,
            lt.leave_name,
            COALESCE(lbl.allocated_days, 0) + COALESCE(lbl.adjusted_days, 0) AS total_days,
            COALESCE(lbl.used_days, 0) AS used_days
       FROM employees e
       CROSS JOIN leave_type_master lt
       LEFT JOIN department_master dm ON dm.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN leave_balance_ledger lbl
         ON lbl.employee_id = e.id
        AND lbl.leave_type_id = lt.id
        AND lbl.balance_year = ?
      WHERE e.active_status = 1
        AND lt.active_status = 1
        AND ${sc.sql}
        ${extraSql}
      ORDER BY e.employee_code, lt.leave_name`,
    [year, ...sc.params, ...extraParams],
  );

  const leaveTypes = Array.from(new Set(rows.map((row) => String(row.leave_name))));
  const records = new Map<string, {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    department: string;
    branch: string;
    process: string;
    costCentre: string;
    balances: Array<{ leaveType: string; total: number; used: number; remaining: number }>;
  }>();

  for (const row of rows) {
    const employeeId = String(row.employee_id);
    if (!records.has(employeeId)) {
      records.set(employeeId, {
        employeeId,
        employeeCode: String(row.employee_code ?? ""),
        employeeName: String(row.employee_name ?? ""),
        department: String(row.department_name ?? "Unassigned"),
        branch: String(row.branch_name ?? "Unassigned"),
        process: String(row.process_name ?? "Unassigned"),
        costCentre: String(row.cost_centre_name ?? "Unassigned"),
        balances: [],
      });
    }
    const total = Number(row.total_days ?? 0);
    const used = Number(row.used_days ?? 0);
    records.get(employeeId)!.balances.push({
      leaveType: String(row.leave_name),
      total,
      used,
      remaining: total - used,
    });
  }

  return res.json({ success: true, data: { year, leaveTypes, records: Array.from(records.values()) } });
}));
