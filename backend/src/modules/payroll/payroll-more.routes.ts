import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

export const payrollMoreRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
payrollMoreRouter.use(requireAuth);

payrollMoreRouter.get("/form16-data/:runId/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { runId, employeeId } = req.params;
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const [runRows] = await db.execute<RowDataPacket[]>("SELECT run_month FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  const run = runRows[0] as { run_month: string } | undefined;
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });

  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT gross_salary, tds_amount, tds FROM salary_prep_line WHERE run_id = ? AND employee_id = ? LIMIT 1`,
    [runId, employeeId],
  );
  const line = lineRows[0] as { gross_salary: number; tds_amount: number; tds: number } | undefined;
  if (!line) return res.status(404).json({ success: false, message: "Payroll line not found for employee" });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT_WS(' ', e.first_name, e.last_name) AS name,
            e.pan_number AS pan,
            dm.designation_name AS designation,
            e.date_of_joining
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = empRows[0] as { name: string; pan: string | null; designation: string | null; date_of_joining: string | null } | undefined;

  const [yr, mo] = run.run_month.split("-").map(Number);
  const fyStart = mo >= 4 ? yr : yr - 1;
  const financialYear = `${fyStart}-${fyStart + 1}`;
  const legacyFinancialYear = `${fyStart}-${String(fyStart + 1).slice(2)}`;

  const [declRows] = await db.execute<RowDataPacket[]>(
    `SELECT declared_hra, declared_80c, declared_80d, regime
       FROM tax_declaration
      WHERE employee_id = ? AND financial_year IN (?, ?)
      ORDER BY financial_year = ? DESC
      LIMIT 1`,
    [employeeId, financialYear, legacyFinancialYear, financialYear],
  );
  const decl = declRows[0] as { declared_hra: number; declared_80c: number; declared_80d: number; regime: string } | undefined;

  const grossSalary = Number(line.gross_salary);
  const standardDeduction = 75000;
  const tdsDeducted = Number(line.tds_amount) || Number(line.tds) || 0;
  const totalDeductions = standardDeduction + (decl ? Number(decl.declared_hra) + Number(decl.declared_80c) + Number(decl.declared_80d) : 0);
  const netTaxableIncome = Math.max(0, grossSalary * 12 - totalDeductions);

  return res.json({
    success: true,
    data: {
      financial_year: financialYear,
      period: run.run_month,
      employee: {
        name: emp?.name ?? "",
        pan: emp?.pan ?? null,
        designation: emp?.designation ?? null,
        period: `Apr ${fyStart} – Mar ${fyStart + 1}`,
      },
      gross_salary: grossSalary,
      standard_deduction: standardDeduction,
      tds_deducted: tdsDeducted,
      net_taxable_income: netTaxableIncome,
      declaration: decl ? { hra: Number(decl.declared_hra), "80c": Number(decl.declared_80c), "80d": Number(decl.declared_80d), regime: decl.regime } : null,
    },
  });
}));

payrollMoreRouter.post("/pt-slabs", requireRole("admin", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from } = req.body as {
    state_code: string;
    state_name: string;
    income_from: number;
    income_to?: number | null;
    pt_amount: number;
    frequency: string;
    effective_from: string;
  };
  if (!state_code || !state_name || income_from === undefined || pt_amount === undefined || !frequency || !effective_from) {
    return res.status(400).json({ success: false, message: "state_code, state_name, income_from, pt_amount, frequency, effective_from are required" });
  }
  const id = (await import("crypto")).randomUUID();
  await db.execute(
    `INSERT INTO pt_slab_master (id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, state_code, state_name, income_from, income_to ?? null, pt_amount, frequency, effective_from],
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1", [id]);
  return res.status(201).json({ success: true, data: rows[0] });
}));

payrollMoreRouter.patch("/pt-slabs/:id", requireRole("admin", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { pt_amount, income_to, is_active } = req.body as { pt_amount?: number; income_to?: number | null; is_active?: number };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (pt_amount !== undefined) { sets.push("pt_amount = ?"); params.push(pt_amount); }
  if (income_to !== undefined) { sets.push("income_to = ?"); params.push(income_to ?? null); }
  if (is_active !== undefined) { sets.push("is_active = ?"); params.push(is_active); }
  if (sets.length === 0) return res.status(400).json({ success: false, message: "No fields to update" });
  params.push(id);
  const [result] = await db.execute<any>(`UPDATE pt_slab_master SET ${sets.join(", ")} WHERE id = ?`, params);
  if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "PT slab not found" });
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1", [id]);
  return res.json({ success: true, data: rows[0] });
}));
