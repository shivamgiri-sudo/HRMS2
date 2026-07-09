import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

export const payrollExtendedRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
payrollExtendedRouter.use(requireAuth);

payrollExtendedRouter.get("/uan/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const isPrivileged = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPrivileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1", [employeeId]);
  return res.json({ success: true, data: rows[0] ?? null });
}));

payrollExtendedRouter.post("/uan/:employeeId", requireRole("admin", "hr", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const { uan, member_id, epf_join_date } = req.body as { uan: string; member_id?: string; epf_join_date?: string };
  if (!uan) return res.status(400).json({ success: false, message: "uan is required" });
  await db.execute(
    `INSERT INTO employee_uan (id, employee_id, uan, member_id, epf_join_date)
     VALUES (UUID(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE uan = VALUES(uan), member_id = VALUES(member_id), epf_join_date = VALUES(epf_join_date), updated_at = NOW()`,
    [employeeId, uan, member_id ?? null, epf_join_date ?? null],
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1", [employeeId]);
  return res.status(201).json({ success: true, data: rows[0] });
}));

payrollExtendedRouter.post("/disbursements", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { run_id, bank_ref, total_amount, employee_count } = req.body as { run_id: string; bank_ref?: string; total_amount: number; employee_count: number };
  if (!run_id || total_amount === undefined || employee_count === undefined) return res.status(400).json({ success: false, message: "run_id, total_amount, employee_count are required" });
  const [runCheck] = await db.execute<RowDataPacket[]>("SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1", [run_id]);
  if (!runCheck.length) return res.status(404).json({ success: false, message: "Payroll run not found" });
  const id = (await import("crypto")).randomUUID();
  await db.execute(
    `INSERT INTO payroll_disbursement (id, run_id, bank_ref, total_amount, employee_count, disbursed_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, run_id, bank_ref ?? null, total_amount, employee_count, req.authUser?.id ?? null],
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1", [id]);
  return res.status(201).json({ success: true, data: rows[0] });
}));

payrollExtendedRouter.get("/disbursements/:runId", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM payroll_disbursement WHERE run_id = ? ORDER BY created_at DESC", [req.params.runId]);
  return res.json({ success: true, data: rows });
}));

payrollExtendedRouter.patch("/disbursements/:id", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status, disbursed_at } = req.body as { status?: "completed" | "failed"; disbursed_at?: string };
  if (status && !new Set(["completed", "failed"]).has(status)) return res.status(400).json({ success: false, message: "status must be 'completed' or 'failed'" });
  const sets: string[] = [];
  const params: unknown[] = [];
  if (status) { sets.push("status = ?"); params.push(status); }
  if (disbursed_at) { sets.push("disbursed_at = ?"); params.push(disbursed_at); }
  if (!sets.length) return res.status(400).json({ success: false, message: "No fields to update" });
  params.push(req.params.id);
  const [result] = await db.execute<any>(`UPDATE payroll_disbursement SET ${sets.join(", ")} WHERE id = ?`, params);
  if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Disbursement not found" });
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1", [req.params.id]);
  return res.json({ success: true, data: rows[0] });
}));

payrollExtendedRouter.get("/pt-slabs", requireRole("admin", "hr", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (req.query.state_code) { where += " AND state_code = ?"; params.push(String(req.query.state_code)); }
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM pt_slab_master ${where} ORDER BY state_code, income_from`, params);
  return res.json({ success: true, data: rows });
}));

payrollExtendedRouter.get("/minimum-wages", requireRole("admin", "hr", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (req.query.state_code) { where += " AND state_code = ?"; params.push(String(req.query.state_code)); }
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT * FROM minimum_wage_master ${where} ORDER BY state_code, category`, params);
  return res.json({ success: true, data: rows });
}));

payrollExtendedRouter.get("/runs/:id/neft-summary", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ebd.id IS NOT NULL AND ebd.ifsc_code IS NOT NULL THEN 1 ELSE 0 END) AS with_bank,
            SUM(CASE WHEN ebd.id IS NULL OR ebd.ifsc_code IS NULL THEN 1 ELSE 0 END) AS missing_bank,
            SUM(spl.net_salary) AS total_net
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
      WHERE spl.run_id = ? AND spl.net_salary > 0`,
    [req.params.id],
  );
  return res.json({ success: true, data: rows[0] });
}));

payrollExtendedRouter.get("/runs/:id/neft-export", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const [runRows] = await db.execute<RowDataPacket[]>("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  const run = runRows[0];
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (!["locked", "disbursed"].includes(String(run.status))) return res.status(400).json({ error: "Run must be locked or disbursed to generate NEFT export" });
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spl.net_salary, e.employee_code, e.full_name, ebd.bank_name, ebd.ifsc_code, AES_DECRYPT(ebd.account_number, ?) AS account_number
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
      WHERE spl.run_id = ? AND spl.net_salary > 0
      ORDER BY e.employee_code`,
    [env.PAYROLL_BANK_KEY, runId],
  );
  const csvRows = ["Sr No,Employee Code,Employee Name,Bank Name,IFSC Code,Account Number,Net Amount,Remarks"];
  let srNo = 1;
  let totalAmount = 0;
  for (const line of lines) {
    const amount = Number(line.net_salary).toFixed(2);
    csvRows.push(`${srNo},${line.employee_code},${String(line.full_name ?? "").replace(/,/g, " ")},${String(line.bank_name ?? "").replace(/,/g, " ")},${line.ifsc_code ?? "NOT_LINKED"},${line.account_number ? String(line.account_number) : "NOT_LINKED"},${amount},SALARY ${run.run_month}`);
    srNo++;
    totalAmount += Number(line.net_salary);
  }
  csvRows.push(`TOTAL,,,,,,${totalAmount.toFixed(2)},`);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="NEFT_${run.run_month}_${runId.slice(0, 8)}.csv"`);
  return res.send(csvRows.join("\n"));
}));

payrollExtendedRouter.get("/runs/:id/ecr", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT eu.uan, eu.member_id, CONCAT_WS(' ', e.first_name, e.last_name) AS member_name,
            spl.gross_salary AS wages, spl.pf_employee AS epf_contribution,
            (spl.pf_employer - ROUND(spl.pf_employer * 3.67 / 12, 2)) AS eps_contribution
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_uan eu ON eu.employee_id = spl.employee_id
      WHERE spl.run_id = ? AND spl.status != 'cancelled'
      ORDER BY e.employee_code`,
    [req.params.id],
  );
  return res.json({ success: true, run_id: req.params.id, data: rows });
}));

payrollExtendedRouter.get("/runs/:id/esic-challan", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [runRows] = await db.execute<RowDataPacket[]>("SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1", [req.params.id]);
  const run = runRows[0];
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
            spl.gross_salary AS wages, spl.esic_employee AS employee_contribution, spl.esic_employer AS employer_contribution
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
      WHERE spl.run_id = ? AND spl.status != 'cancelled'
      ORDER BY e.employee_code`,
    [req.params.id],
  );
  const totals = rows.reduce((acc: any, row: any) => {
    acc.total_wages += Number(row.wages);
    acc.employee_total += Number(row.employee_contribution);
    acc.employer_total += Number(row.employer_contribution);
    return acc;
  }, { total_wages: 0, employee_total: 0, employer_total: 0 });
  return res.json({ success: true, run_id: req.params.id, period: run.run_month, employee_count: rows.length, ...totals, data: rows });
}));
