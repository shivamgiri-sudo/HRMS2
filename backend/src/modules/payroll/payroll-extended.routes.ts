import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { isRunClosed } from "./run-status.js";
import { buildScopeWhereClause, hasAnyRole as hasAnyRoleAsync, getUserAssignmentScopes } from "../../shared/scopeAccess.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";
import { resolveAccountNumber, resolveAccountNumberWithConflict } from "../../shared/fieldEncryption.js";

/**
 * Roles whose payroll authority can be org-wide. Used with hasExportScope (below) for
 * the bank-file endpoints below, which refuse a branch-scoped caller rather than
 * emit a partial payment instruction.
 */
const PAYROLL_EXPORT_ROLES = ["finance", "payroll", "finance_head", "payroll_head", "payroll_admin"];
/** Report-style exports row-filter to these roles' assigned scope instead of denying. */
const PAYROLL_REPORT_SCOPE_ROLES = ["hr", "finance", "payroll", "finance_head", "payroll_head", "payroll_admin"];
const ORG_WIDE_REQUIRED_MSG =
  "This export requires org-wide payroll scope. A branch-scoped export would produce a partial payment file, which is indistinguishable from a complete one once downloaded.";

/**
 * The bank/NEFT export's own org-wide test — deliberately NOT hasOrgWideScope().
 *
 * hasOrgWideScope() short-circuits to true for anyone holding `admin` (scopeAccess.ts:~192)
 * before it ever looks at a scope row. Fixed 2026-08-17 (Section M RBAC audit): this file's
 * neft-summary, neft-export, bank-exception-report and golden-month-reconcile endpoints were
 * still using the raw hasOrgWideScope check, even though the identical vulnerability was
 * already found and fixed for /payment-file in bank-payment-readiness.routes.ts (c202fe10,
 * 2026-08-14), whose own commit message names this exact gap as an unfixed follow-up: "the
 * admin-implies-org-wide shortcut in hasOrgWideScope() still applies to every other endpoint
 * that uses it." Measured against production 2026-08-14: one active account holds `admin` +
 * `branch_admin` with ZERO scope_type='all' rows. Routed through hasOrgWideScope, that branch
 * administrator could pull org-wide NEFT/bank data and payroll totals through THIS file's
 * endpoints.
 *
 * super_admin is org-wide by definition; everyone else needs a real scope_type='all' row
 * against a payroll export role. Holding `admin` is not, by itself, org-wide payroll scope.
 * Same helper/logic as bank-payment-readiness.routes.ts's hasExportScope and
 * payroll.routes.ts's — duplicated per-file rather than shared, to keep this a minimal,
 * targeted fix on the files that were still vulnerable rather than a cross-file refactor.
 *
 * STATUS 2026-08-26 — the shortcut this helper was written to avoid is GONE.
 * hasOrgWideScope() no longer short-circuits on `admin`; it now reads
 *   super_admin -> true; else require an allowed role; else require a
 *   scope_type='all' row against those roles
 * which is character-for-character the logic below when called as
 * hasOrgWideScope(userId, PAYROLL_EXPORT_ROLES). This helper is therefore a
 * duplicate rather than a divergence, and the paragraphs above are kept as the
 * record of WHY it exists, not as a live warning about the shared function.
 *
 * It is deliberately NOT collapsed into hasOrgWideScope(). Doing so would edit the
 * gate on a live full-account-number/payment export for zero behavioural gain, and
 * this file's own history is the argument against that trade. Anyone consolidating
 * later must diff both implementations again first — do not assume this note is
 * still true.
 */
async function hasExportScope(userId: string): Promise<boolean> {
  if (await hasAnyRoleAsync(userId, "super_admin")) return true;
  if (!(await hasAnyRoleAsync(userId, ...PAYROLL_EXPORT_ROLES))) return false;
  const scopes = await getUserAssignmentScopes(userId, PAYROLL_EXPORT_ROLES);
  return scopes.some((s) => s.scope_type === "all");
}

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
  // Gated the same way as the export it precedes: these totals are org-wide payroll
  // figures, and showing them to a caller who cannot produce the file is incoherent.
  if (!(await hasExportScope(req.authUser!.id))) {
    return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
  }
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
  // requireRole alone let a branch-scoped payroll user download decrypted bank account
  // numbers for the entire organisation. Denying rather than row-filtering is deliberate:
  // a silently branch-filtered bank file would be uploaded as if it paid everyone.
  if (!(await hasExportScope(req.authUser!.id))) {
    return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
  }
  const [runRows] = await db.execute<RowDataPacket[]>("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  const run = runRows[0];
  if (!run) return res.status(404).json({ error: "Run not found" });
  // isRunClosed (locked/disbursed/finalized, case-insensitive) — a literal ["locked","disbursed"]
  // list here previously blocked NEFT export for every FINALIZED production run.
  if (!isRunClosed(run.status)) return res.status(400).json({ error: "Run must be locked, finalized, or disbursed to generate NEFT export" });
  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spl.net_salary, e.employee_code, e.full_name, ebd.bank_name, ebd.ifsc_code, ebd.account_number_enc, ebd.account_number
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
      WHERE spl.run_id = ? AND spl.net_salary > 0
      ORDER BY e.employee_code`,
    [runId],
  );
  // An employee with no bank account cannot be paid by NEFT, so they must not appear
  // as a payment instruction.
  //
  // Previously every line was emitted, with the literal "NOT_LINKED" standing in for
  // the IFSC and account number, and — worse — their net pay was still added to the
  // TOTAL. The file therefore declared a disbursement total the bank could not
  // actually pay out, and the unpayable rows were indistinguishable from real ones to
  // anything consuming the file positionally.
  //
  // They are excluded from the payment rows and reported underneath instead. Dropping
  // them silently would be its own defect: an employee who is simply missing bank
  // details would vanish from payroll with nothing to say so. The sibling exporter in
  // disbursal.routes.ts filters them with an INNER JOIN and says nothing, which is why
  // the two exporters disagreed about who was payable.
  // Resolve encrypted account numbers before filtering
  (lines as RowDataPacket[]).forEach((l: any) => { l.account_number = resolveAccountNumber(l) ?? ""; });
  const isPayable = (l: RowDataPacket) =>
    Boolean(String((l as any).ifsc_code ?? "").trim()) && Boolean(String((l as any).account_number ?? "").trim());
  const payable = (lines as RowDataPacket[]).filter(isPayable);
  const unpayable = (lines as RowDataPacket[]).filter((l) => !isPayable(l));

  const csvRows = ["Sr No,Employee Code,Employee Name,Bank Name,IFSC Code,Account Number,Net Amount,Remarks"];
  let srNo = 1;
  let totalAmount = 0;
  for (const line of payable) {
    const amount = Number(line.net_salary).toFixed(2);
    csvRows.push(`${srNo},${line.employee_code},${String(line.full_name ?? "").replace(/,/g, " ")},${String(line.bank_name ?? "").replace(/,/g, " ")},${line.ifsc_code},${String(line.account_number)},${amount},SALARY ${run.run_month}`);
    srNo++;
    totalAmount += Number(line.net_salary);
  }
  csvRows.push(`TOTAL,,,,,,${totalAmount.toFixed(2)},`);

  // Reported after TOTAL, following the same convention that row already sets: a
  // non-numeric first column marking a summary line rather than a payment.
  if (unpayable.length > 0) {
    const withheld = unpayable.reduce((sum, l) => sum + Number(l.net_salary), 0);
    csvRows.push(
      `EXCLUDED,,,,,,${withheld.toFixed(2)},${unpayable.length} employee(s) have no bank account and are NOT in this file`,
    );
    for (const line of unpayable) {
      csvRows.push(
        `,${line.employee_code},${String(line.full_name ?? "").replace(/,/g, " ")},,,,${Number(line.net_salary).toFixed(2)},NOT PAID - bank account missing`,
      );
    }
  }
  res.setHeader("X-Neft-Excluded-Count", String(unpayable.length));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="NEFT_${run.run_month}_${runId.slice(0, 8)}.csv"`);
  return res.send(csvRows.join("\n"));
}));

payrollExtendedRouter.get("/runs/:id/ecr", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  // ECR carries PF wage/UAN data for every employee on the run — same sensitivity as
  // neft-export/bank-exception-report above, but this endpoint had no scope check at
  // all, only the role list. A branch-scoped finance/payroll user could pull ECR data
  // for any runId regardless of branch. Same hasExportScope gate as its siblings.
  if (!(await hasExportScope(req.authUser!.id))) {
    return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
  }
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
// Accepts either /runs/:id/salary-sheet-export OR /salary-sheet-export?month=YYYY-MM&branchId=X
payrollExtendedRouter.get("/salary-sheet-export", requireRole("admin", "finance", "payroll", "hr", "payroll_head", "finance_head", "payroll_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { month, branchId } = req.query as { month?: string; branchId?: string };
  if (!month) return res.status(400).json({ success: false, message: "month query param required (YYYY-MM)" });

  // Find the most recent run for this month (optionally filtered by branch)
  let runQuery = "SELECT id, run_month FROM salary_prep_run WHERE run_month = ?";
  const params: (string | number)[] = [month];
  if (branchId) {
    runQuery += " AND branch_id = ?";
    params.push(branchId);
  }
  runQuery += " ORDER BY created_at DESC LIMIT 1";
  const [runRows] = await db.execute<RowDataPacket[]>(runQuery, params);
  const foundRun = runRows[0];
  if (!foundRun) return res.status(404).json({ success: false, message: `No payroll run found for ${month}${branchId ? ` (branch ${branchId})` : ""}` });

  // Redirect to the ID-based endpoint
  return res.redirect(`/api/payroll/runs/${foundRun.id}/salary-sheet-export`);
}));

payrollExtendedRouter.get("/runs/:id/salary-sheet-export", requireRole("admin", "finance", "payroll", "hr", "payroll_head", "finance_head", "payroll_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;
  const [runRows] = await db.execute<RowDataPacket[]>("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  const run = runRows[0];
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });

  // Unlike the bank file above this is a report, so it row-filters to the caller's
  // branch/process the way /runs and /records already do, rather than denying
  // outright. Previously requireRole alone let any hr/finance/payroll user export
  // the whole organisation's salary register, including decrypted account numbers.
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    PAYROLL_REPORT_SCOPE_ROLES,
    { branchId: "e.branch_id", processId: "e.process_id" },
    { allowAdminBypass: true },
  );
  // buildScopeWhereClause returns 1=0 for a caller with no assigned scope. Letting that
  // through would download an empty workbook, which reads as "this run has no payroll"
  // rather than "you have no access" — so say so instead.
  if (scoped.sql === "1=0") {
    return res.status(403).json({
      success: false,
      message: "No branch or process scope is assigned to your account, so there is nothing you are authorised to export.",
    });
  }

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
        COALESCE(eu.uan, e.uan_number, '')                        AS UAN,
        COALESCE(eu.member_id, e.epf_number, '')           AS EPFNo,
        COALESCE(e.esic_number, '')                        AS ESICNo,
        ''                                                 AS ChequeNumber,
        ''                                                 AS ChequeDate,
        ''                                                 AS PrintDate,
        -- employees has no status column, so this whole payroll register export threw
        -- ER_BAD_FIELD_ERROR. Same defect as the auth refresh query, but the right fix
        -- differs: auth needed a boolean gate (active_status), whereas LeftStatus is a
        -- descriptive report column, so it wants employment_status — 'Resigned',
        -- 'terminated', 'inactive', 'active' — which is what a reader of this export expects.
        COALESCE(e.employment_status, '')                  AS LeftStatus,
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
        ebd.account_number_enc                             AS AcNo_enc,
        ebd.account_number                                 AS AcNo_legacy,
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
      -- Both of these are one-row-per-employee joins and must say so, or the salary sheet
      -- silently gains a duplicate row per employee -- each carrying the full gross and net,
      -- and invisible in a thousand-row spreadsheet.
      --
      -- Neither duplicates today: employee_uan holds 0 rows and no employee has more than one
      -- bank record (verified live 2026-08-17). Both are about to change. employee_uan being
      -- empty is an open statutory blocker whose fix is to populate it, and the
      -- bank-change-approval workflow exists specifically to create a second bank row -- so
      -- the day either is resolved, this export starts double-counting unless scoped now.
      -- Same predicates the NEFT paths and the sibling query below already apply.
      LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
      LEFT JOIN employee_bank_detail ebd
             ON ebd.employee_id = e.id
            AND ebd.active_status = 1
            AND ebd.is_primary = 1
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
        AND (${scoped.sql})
      ORDER BY e.employee_code`,
    [runId, ...scoped.params],
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
    AcNo: resolveAccountNumber({ account_number_enc: row.AcNo_enc, account_number: row.AcNo_legacy }) ?? "",
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

// ─── P0: Bank exception report ────────────────────────────────────────────────
//
// Required gate before bank advice generation.  Returns two lists:
//   missing   — payable employees with no usable account in either source
//   conflicts — employees where both sources exist but decode to different values
//
// HR/Finance must resolve every entry to zero before the bank file is generated.
// Org-wide scope required (same gate as the NEFT export endpoints).
payrollExtendedRouter.get(
  "/runs/:runId/bank-exception-report",
  requireRole("super_admin", "admin", "finance", "payroll_head", "finance_head", "payroll_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;

    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as any[])[0];
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });

    // Fetch all payable lines joined to bank detail for conflict detection
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         spl.employee_id,
         spl.employee_code,
         COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
         spl.net_salary,
         ebd.id            AS bank_detail_id,
         ebd.bank_name,
         ebd.ifsc_code,
         ebd.account_number_enc,
         ebd.account_number AS account_number_legacy,
         ebd.verified,
         ebd.is_primary
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN employee_bank_detail ebd
         ON ebd.employee_id = e.id
        AND ebd.active_status = 1
        AND ebd.is_primary = 1
       WHERE spl.run_id = ?
       ORDER BY spl.employee_code ASC`,
      [runId],
    );

    const missing: any[] = [];
    const conflicts: any[] = [];
    const resolved_ok: number[] = [];

    for (const r of rows as any[]) {
      if (!r.bank_detail_id) {
        // No bank record at all
        missing.push({
          employee_id: r.employee_id,
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          net_salary: Number(r.net_salary ?? 0),
          reason: "no_bank_record",
        });
        continue;
      }

      const resolution = resolveAccountNumberWithConflict({
        account_number_enc: r.account_number_enc,
        account_number: r.account_number_legacy,
      });

      if (resolution.status === "missing") {
        missing.push({
          employee_id: r.employee_id,
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          net_salary: Number(r.net_salary ?? 0),
          bank_name: r.bank_name,
          ifsc_code: r.ifsc_code,
          reason: "both_sources_empty",
        });
      } else if (resolution.status === "conflict") {
        conflicts.push({
          employee_id: r.employee_id,
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          net_salary: Number(r.net_salary ?? 0),
          bank_name: r.bank_name,
          ifsc_code: r.ifsc_code,
          // Mask both — only last 4 visible, so neither raw value escapes in a report
          enc_account_masked: resolution.encValue
            ? `XXXX${resolution.encValue.slice(-4)}`
            : null,
          legacy_account_masked: resolution.legacyValue
            ? `XXXX${resolution.legacyValue.slice(-4)}`
            : null,
          conflict_detail: "encrypted and legacy columns disagree — HR must verify and re-upload",
        });
      } else {
        resolved_ok.push(r.employee_id);
      }
    }

    const total_payable = (rows as any[]).length;
    const unresolved_count = missing.length + conflicts.length;
    const gate_clear = unresolved_count === 0;

    return res.json({
      success: true,
      run_id: runId,
      run_month: run.run_month,
      total_payable,
      gate_clear,
      unresolved_count,
      missing_count: missing.length,
      conflict_count: conflicts.length,
      missing,
      conflicts,
      message: gate_clear
        ? "All payable employees have a usable, unambiguous bank account. Bank advice may proceed."
        : `${unresolved_count} employee(s) require HR/Finance resolution before bank advice can be generated.`,
    });
  }),
);

// ─── P0: Golden-month reconciliation ─────────────────────────────────────────
//
// Accepts an optional external control-file payload (headcount, gross, deductions,
// net, bank_advice_total, payslip_count) and produces a side-by-side diff against
// the locked run.  When no control payload is supplied, returns the run's own
// figures so the caller can build the comparison offline.
//
// Pre-production sign-off gate: all variances must be zero (or within the
// tolerance_rupees the caller supplies) before the run is considered golden.
payrollExtendedRouter.post(
  "/runs/:runId/golden-month-reconcile",
  requireRole("super_admin", "admin", "finance_head", "payroll_head", "payroll_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;

    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status, total_employees, total_gross, total_deductions, total_net
         FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as any[])[0];
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });

    // Recompute from prep lines rather than trusting the run totals column —
    // the totals column is updated on each calculation but could lag a manual edit.
    const [aggRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*)                         AS headcount,
         COALESCE(SUM(gross_salary), 0)   AS gross,
         COALESCE(SUM(total_deductions),0) AS deductions,
         COALESCE(SUM(net_salary), 0)     AS net
       FROM salary_prep_line WHERE run_id = ?`,
      [runId],
    );
    const agg = (aggRows as any[])[0];

    // Payable bank total: sum net for employees whose account resolves ok
    const [bankRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.net_salary, ebd.account_number_enc, ebd.account_number AS account_number_legacy
         FROM salary_prep_line spl
         LEFT JOIN employee_bank_detail ebd
           ON ebd.employee_id = spl.employee_id
          AND ebd.active_status = 1
          AND ebd.is_primary = 1
        WHERE spl.run_id = ?`,
      [runId],
    );
    const SCIENTIFIC_RE = /[Ee][+-]/;
    const VALID_ACCT_RE = /^[0-9]{6,20}$/;
    let bank_advice_total = 0;
    let bank_payable_count = 0;
    for (const b of bankRows as any[]) {
      const acct = resolveAccountNumber({ account_number_enc: b.account_number_enc, account_number: b.account_number_legacy });
      const ok = acct && !SCIENTIFIC_RE.test(acct) && VALID_ACCT_RE.test(acct);
      if (ok) { bank_advice_total += Number(b.net_salary ?? 0); bank_payable_count++; }
    }
    bank_advice_total = Math.round(bank_advice_total * 100) / 100;

    const [payslipRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM salary_payslip sp
         JOIN salary_prep_line spl ON spl.id = sp.prep_line_id
        WHERE spl.run_id = ?`,
      [runId],
    );
    const payslip_count = Number((payslipRows as any[])[0]?.cnt ?? 0);

    const system: Record<string, number> = {
      headcount:         Number(agg.headcount),
      gross:             Math.round(Number(agg.gross) * 100) / 100,
      deductions:        Math.round(Number(agg.deductions) * 100) / 100,
      net:               Math.round(Number(agg.net) * 100) / 100,
      bank_advice_total,
      bank_payable_count,
      payslip_count,
    };

    // Optional control file from request body
    const control: Record<string, number> | null = req.body?.control ?? null;
    const tolerance = Number(req.body?.tolerance_rupees ?? 0);

    if (!control) {
      return res.json({
        success: true,
        run_id: runId,
        run_month: run.run_month,
        status: run.status,
        system,
        control: null,
        variances: null,
        golden: null,
        message: "System figures returned. POST with { control: { headcount, gross, deductions, net, bank_advice_total, payslip_count }, tolerance_rupees } to reconcile.",
      });
    }

    const variances: Record<string, { system: number; control: number; diff: number; pass: boolean }> = {};
    let golden = true;
    for (const key of ["headcount", "gross", "deductions", "net", "bank_advice_total", "payslip_count"] as const) {
      const sys = system[key] ?? 0;
      const ctrl = control[key] ?? 0;
      const diff = Math.round((sys - ctrl) * 100) / 100;
      const pass = Math.abs(diff) <= tolerance;
      if (!pass) golden = false;
      variances[key] = { system: sys, control: ctrl, diff, pass };
    }

    // Audit the reconciliation attempt
    const { logSensitiveAction } = await import("../../shared/auditLog.js");
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "GOLDEN_MONTH_RECONCILE",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: runId,
      change_summary: { run_month: run.run_month, golden, variances, tolerance },
    });

    return res.json({
      success: true,
      run_id: runId,
      run_month: run.run_month,
      status: run.status,
      system,
      control,
      variances,
      golden,
      tolerance_rupees: tolerance,
      message: golden
        ? `Golden month PASS — all figures reconcile within ±₹${tolerance}.`
        : "Golden month FAIL — variances exceed tolerance. Resolve before production sign-off.",
    });
  }),
);
