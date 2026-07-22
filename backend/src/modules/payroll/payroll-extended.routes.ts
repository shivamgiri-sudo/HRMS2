import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";

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

// ESIC challan: handled by payroll.routes.ts /runs/:id/esic-challan (mounted first)

// ── Salary Sheet XLSX export (mirrors Onfido Noida sheet format) ──────────────
payrollExtendedRouter.get("/runs/:id/salary-sheet-export", requireRole("admin", "finance", "payroll", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const [runRows] = await db.execute<RowDataPacket[]>("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  const run = runRows[0];
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });

  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.employee_code                                    AS EmpCode,
        CONCAT_WS(' ', e.first_name, e.last_name)         AS EmpName,
        COALESCE(ccm.cost_centre_code, '')                 AS CostCenter,
        COALESCE(dm.dept_name, '')                         AS Department,
        COALESCE(desm.designation_name, '')                AS Designation,
        COALESCE(e.profile_type, '')                       AS Profile,
        'InHouse'                                          AS EmployeeFor,
        ''                                                 AS Billable,
        COALESCE(bm.branch_name, '')                       AS Branch,
        COALESCE(slc_basic.amount, 0)                      AS Basic,
        COALESCE(slc_hra.amount, 0)                        AS HRA,
        COALESCE(slc_bonus.amount, 0)                      AS Bonus,
        COALESCE(slc_conv.amount, 0)                       AS Conv,
        COALESCE(slc_portfolio.amount, 0)                  AS Portfolio,
        COALESCE(slc_medical.amount, 0)                    AS MedicalAllowance,
        COALESCE(slc_lta.amount, 0)                        AS LTA,
        COALESCE(slc_special.amount, 0)                    AS SpecialAllowance,
        COALESCE(slc_other.amount, 0)                      AS OtherAllowance,
        COALESCE(slc_pli.amount, 0)                        AS PLI1,
        spl.gross_salary                                   AS Gross,
        spl.working_days                                   AS WorkingDays,
        COALESCE(esa.ctc_annual / 12, spl.gross_salary)   AS CTCOffered,
        COALESCE(esa.ctc_annual / 12, spl.gross_salary)   AS CurrentCTC,
        COALESCE(spl.present_days, 0)                      AS ActualDays,
        COALESCE(spl.paid_working_days, spl.present_days, 0) AS EarnedDays,
        0                                                  AS ExtraDay,
        COALESCE(spl.leave_days, 0)                        AS Leave,
        COALESCE(slc_basic.amount, 0)                      AS Basic1,
        COALESCE(slc_hra.amount, 0)                        AS HRA1,
        COALESCE(slc_bonus.amount, 0)                      AS Bonus1,
        COALESCE(slc_conv.amount, 0)                       AS Conv1,
        COALESCE(slc_portfolio.amount, 0)                  AS Portfolio1,
        COALESCE(slc_special.amount, 0)                    AS SpecialAllowance1,
        COALESCE(slc_other.amount, 0)                      AS OtherAllowance1,
        COALESCE(slc_medical.amount, 0)                    AS MedicalAllowance1,
        spl.gross_salary                                   AS Gross1,
        CASE WHEN spl.esic_employee > 0 THEN 'YES' ELSE 'NO' END AS ESIElig,
        CASE WHEN spl.pf_employee > 0 THEN 'YES' ELSE 'NO' END   AS PFElig,
        spl.esic_employee                                  AS ESIC,
        spl.pf_employee                                    AS EPF,
        COALESCE(spl.tds, 0)                               AS IncomeTax,
        0                                                  AS AdvTaken,
        COALESCE(spl.advance_recovery, 0)                  AS AdvPaid,
        0                                                  AS LoanTaken,
        COALESCE(spl.loan_emi, 0)                          AS LoanDed,
        COALESCE(spl.incentive_total, 0)                   AS Incentive,
        0                                                  AS ExtraDayIncentive,
        0                                                  AS Arrear,
        COALESCE(slc_pli.amount, 0)                        AS PLI,
        spl.net_salary                                     AS NetSalary,
        spl.esic_employer                                  AS ESICCompany,
        spl.pf_employer                                    AS EPFCompany,
        ROUND(spl.pf_employer * 0.01, 2)                   AS AdminChrg,
        ROUND(COALESCE(esa.ctc_annual / 12, spl.gross_salary) + spl.pf_employer + spl.esic_employer, 2) AS CTC,
        0                                                  AS SHSH,
        COALESCE(spl.other_deductions, 0)                  AS MobileDeduction,
        0                                                  AS ShortCollection,
        0                                                  AS AssetRecovery,
        0                                                  AS Insurance,
        COALESCE(spl.professional_tax, 0)                  AS ProTaxDeduction,
        COALESCE(spl.lwp_deduction, 0)                     AS LeaveDeduction,
        0                                                  AS OtherDeduction,
        ''                                                 AS OtherDeductionRemarks,
        spl.total_deductions                               AS TotalDeduction,
        r.run_month                                        AS SalDate,
        COALESCE(eu.uan, e.uan, '')                        AS UAN,
        COALESCE(eu.member_id, e.epf_number, '')           AS EPFNo,
        COALESCE(e.esic_number, '')                        AS ESICNo,
        ''                                                 AS ChequeNumber,
        ''                                                 AS ChequeDate,
        ''                                                 AS PrintDate,
        COALESCE(e.status, '')                             AS LeftStatus,
        NULL AS TaxTotalGross,
        NULL AS TaxSection10,
        NULL AS TaxBalance,
        NULL AS TaxUnderHd,
        NULL AS DeductionUnder24,
        NULL AS TaxGrossTotal,
        NULL AS TaxAggofChapter6,
        NULL AS TotalIncome,
        NULL AS TaxOnTotalIncome,
        NULL AS EduCess,
        NULL AS TaxPayEduCess,
        NULL AS TaxDeductedTillPreviousMonth,
        NULL AS BalanceTax,
        'NEFT'                                             AS SalaryPaymentMode,
        AES_DECRYPT(ebd.account_number, ?)                 AS AcNo,
        COALESCE(ebd.ifsc_code, '')                        AS IFSCCode,
        COALESCE(ebd.bank_name, '')                        AS AcBank,
        COALESCE(ebd.bank_branch, '')                      AS AcBranch
      FROM salary_prep_line spl
      JOIN salary_prep_run r ON r.id = spl.run_id
      JOIN employees e ON e.id = spl.employee_id
      LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
      LEFT JOIN department_master dm ON dm.id = e.department_id
      LEFT JOIN designation_master desm ON desm.id = e.designation_id
      LEFT JOIN branch_master bm ON bm.id = e.branch_id
      LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      LEFT JOIN employee_uan eu ON eu.employee_id = e.id
      LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = e.id
      LEFT JOIN salary_prep_line_component slc_basic     ON slc_basic.line_id     = spl.id AND slc_basic.component_code     = 'BASIC'
      LEFT JOIN salary_prep_line_component slc_hra       ON slc_hra.line_id       = spl.id AND slc_hra.component_code       = 'HRA'
      LEFT JOIN salary_prep_line_component slc_bonus     ON slc_bonus.line_id     = spl.id AND slc_bonus.component_code     = 'BONUS'
      LEFT JOIN salary_prep_line_component slc_conv      ON slc_conv.line_id      = spl.id AND slc_conv.component_code      = 'CONV'
      LEFT JOIN salary_prep_line_component slc_portfolio ON slc_portfolio.line_id = spl.id AND slc_portfolio.component_code = 'PORTFOLIO'
      LEFT JOIN salary_prep_line_component slc_medical   ON slc_medical.line_id   = spl.id AND slc_medical.component_code   = 'MEDICAL'
      LEFT JOIN salary_prep_line_component slc_lta       ON slc_lta.line_id       = spl.id AND slc_lta.component_code       = 'LTA'
      LEFT JOIN salary_prep_line_component slc_special   ON slc_special.line_id   = spl.id AND slc_special.component_code   = 'SPECIAL'
      LEFT JOIN salary_prep_line_component slc_other     ON slc_other.line_id     = spl.id AND slc_other.component_code     = 'OTHER_ALLOW'
      LEFT JOIN salary_prep_line_component slc_pli       ON slc_pli.line_id       = spl.id AND slc_pli.component_code       = 'PLI'
      WHERE spl.run_id = ? AND spl.status != 'cancelled'
      ORDER BY e.employee_code`,
    [env.PAYROLL_BANK_KEY, runId],
  );

  // Build sheet data — map each row to a plain object in column order
  const sheetData = (lines as RowDataPacket[]).map((row: any) => ({
    EmpCode: row.EmpCode,
    EmpName: row.EmpName,
    CostCenter: row.CostCenter,
    Department: row.Department,
    Designation: row.Designation,
    Profile: row.Profile,
    "Employee For": row.EmployeeFor,
    Billable: row.Billable,
    Branch: row.Branch,
    Basic: Number(row.Basic),
    HRA: Number(row.HRA),
    Bonus: Number(row.Bonus),
    Conv: Number(row.Conv),
    Portfolio: Number(row.Portfolio),
    MedicalAllowance: Number(row.MedicalAllowance),
    LTA: Number(row.LTA),
    SpecialAllowance: Number(row.SpecialAllowance),
    OtherAllowance: Number(row.OtherAllowance),
    PLI1: Number(row.PLI1),
    Gross: Number(row.Gross),
    WorkingDays: Number(row.WorkingDays),
    CTCOffered: Number(row.CTCOffered),
    CurrentCTC: Number(row.CurrentCTC),
    ActualDays: Number(row.ActualDays),
    EarnedDays: Number(row.EarnedDays),
    ExtraDay: Number(row.ExtraDay),
    Leave: Number(row.Leave),
    Basic1: Number(row.Basic1),
    HRA1: Number(row.HRA1),
    Bonus1: Number(row.Bonus1),
    Conv1: Number(row.Conv1),
    Portfolio1: Number(row.Portfolio1),
    SpecialAllowance1: Number(row.SpecialAllowance1),
    OtherAllowance1: Number(row.OtherAllowance1),
    MedicalAllowance1: Number(row.MedicalAllowance1),
    Gross1: Number(row.Gross1),
    ESIElig: row.ESIElig,
    PFElig: row.PFElig,
    ESIC: Number(row.ESIC),
    EPF: Number(row.EPF),
    IncomeTax: Number(row.IncomeTax),
    AdvTaken: Number(row.AdvTaken),
    AdvPaid: Number(row.AdvPaid),
    LoanTaken: Number(row.LoanTaken),
    LoanDed: Number(row.LoanDed),
    Incentive: Number(row.Incentive),
    ExtraDayIncentive: Number(row.ExtraDayIncentive),
    Arrear: Number(row.Arrear),
    PLI: Number(row.PLI),
    NetSalary: Number(row.NetSalary),
    ESICCompany: Number(row.ESICCompany),
    EPFCompany: Number(row.EPFCompany),
    AdminChrg: Number(row.AdminChrg),
    CTC: Number(row.CTC),
    SHSH: Number(row.SHSH),
    MobileDeduction: Number(row.MobileDeduction),
    ShortCollection: Number(row.ShortCollection),
    AssetRecovery: Number(row.AssetRecovery),
    Insurance: Number(row.Insurance),
    ProTaxDeduction: Number(row.ProTaxDeduction),
    LeaveDeduction: Number(row.LeaveDeduction),
    OtherDeduction: Number(row.OtherDeduction),
    OtherDeductionRemarks: row.OtherDeductionRemarks,
    TotalDeduction: Number(row.TotalDeduction),
    SalDate: row.SalDate,
    UAN: row.UAN,
    EPFNo: row.EPFNo,
    ESICNo: row.ESICNo,
    ChequeNumber: row.ChequeNumber,
    ChequeDate: row.ChequeDate,
    PrintDate: row.PrintDate,
    LeftStatus: row.LeftStatus,
    TaxTotalGross: row.TaxTotalGross ?? "",
    TaxSection10: row.TaxSection10 ?? "",
    TaxBalance: row.TaxBalance ?? "",
    TaxUnderHd: row.TaxUnderHd ?? "",
    DeductionUnder24: row.DeductionUnder24 ?? "",
    TaxGrossTotal: row.TaxGrossTotal ?? "",
    TaxAggofChapter6: row.TaxAggofChapter6 ?? "",
    TotalIncome: row.TotalIncome ?? "",
    TaxOnTotalIncome: row.TaxOnTotalIncome ?? "",
    EduCess: row.EduCess ?? "",
    TaxPayEduCess: row.TaxPayEduCess ?? "",
    TaxDeductedTillPreviousMonth: row.TaxDeductedTillPreviousMonth ?? "",
    BalanceTax: row.BalanceTax ?? "",
    SalaryPaymentMode: row.SalaryPaymentMode,
    AcNo: row.AcNo ? String(row.AcNo) : "",
    IFSCCode: row.IFSCCode,
    AcBank: row.AcBank,
    AcBranch: row.AcBranch,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, "Salary Sheet");

  const runMonthLabel = String(run.run_month).replace("-", " ");
  const filename = `Salary Sheet ${runMonthLabel}.xlsx`;
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(buf);
}));
