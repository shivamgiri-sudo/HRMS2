import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";

export const employeeReportMasterRouter = Router();
employeeReportMasterRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const REPORT_MASTER_SCOPE_ROLES = ["hr", "manager", "branch_head", "process_manager", "assistant_manager", "tl", "wfm", "finance", "payroll"];

employeeReportMasterRouter.get("/directory-masters", h(async (req: any, res: any) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    REPORT_MASTER_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );

  const employeeWhere = `e.active_status = 1 AND (${scoped.sql})`;

  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.branch_name, COUNT(e.id) AS employee_count
       FROM branch_master b
       JOIN employees e ON e.branch_id = b.id
      WHERE ${employeeWhere}
        AND TRIM(COALESCE(b.branch_name, '')) <> ''
      GROUP BY b.id, b.branch_name
      ORDER BY b.branch_name ASC`,
    scoped.params,
  );

  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT p.id, p.process_name, COUNT(e.id) AS employee_count
       FROM process_master p
       JOIN employees e ON e.process_id = p.id
      WHERE ${employeeWhere}
        AND TRIM(COALESCE(p.process_name, '')) <> ''
      GROUP BY p.id, p.process_name
      ORDER BY p.process_name ASC`,
    scoped.params,
  );

  const [costCentres] = await db.execute<RowDataPacket[]>(
    `SELECT cc.id, cc.cost_centre_name, COUNT(e.id) AS employee_count
       FROM cost_centre_master cc
       JOIN employees e ON e.cost_centre_id = cc.id
      WHERE ${employeeWhere}
        AND TRIM(COALESCE(cc.cost_centre_name, '')) <> ''
      GROUP BY cc.id, cc.cost_centre_name
      ORDER BY cc.cost_centre_name ASC`,
    scoped.params,
  );

  return res.json({ success: true, data: { branches, processes, costCentres, cost_centres: costCentres } });
}));
