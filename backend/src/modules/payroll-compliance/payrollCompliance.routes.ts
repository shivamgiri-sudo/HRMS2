import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { payrollComplianceService } from "./payrollCompliance.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

router.post("/runs/:runId/compliance-check", requireRole("admin", "hr", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await payrollComplianceService.validateRun(req.params.runId);
  return res.json({ success: true, data });
}));

router.get("/runs/:runId/compliance-issues", requireRole("admin", "hr", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pci.*, e.employee_code, e.full_name
       FROM payroll_compliance_issue pci
       LEFT JOIN employees e ON e.id = pci.employee_id
      WHERE pci.run_id = ?
      ORDER BY FIELD(pci.severity,'blocking','critical','warning','info'), pci.created_at DESC`,
    [req.params.runId]
  );
  return res.json({ success: true, data: rows });
}));

router.put("/employees/:employeeId/component-snapshot", requireRole("admin", "hr", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    components: z.array(z.object({
      component_code: z.string().min(1).max(80),
      component_name: z.string().min(1).max(160),
      component_type: z.enum(["earning", "deduction", "employer_cost"]),
      amount: z.number(),
      taxable: z.boolean().optional(),
      pf_applicable: z.boolean().optional(),
      esic_applicable: z.boolean().optional(),
    })).min(1),
  });
  const body = schema.parse(req.body);
  const data = await payrollComplianceService.upsertComponentSnapshot(
    req.params.employeeId,
    body.effectiveFrom,
    body.components.map(c => ({ ...c, source: "snapshot" as const })),
    req.authUser?.id ?? null
  );
  await payrollComplianceService.logSensitiveAccess({
    actorUserId: req.authUser?.id,
    employeeId: req.params.employeeId,
    moduleKey: "payroll",
    actionKey: "COMPONENT_SNAPSHOT_UPSERT",
    purpose: "Preserve existing employee salary component breakup for payroll calculation",
    metadata: { count: body.components.length },
    req,
  });
  return res.json({ success: true, data });
}));

router.get("/employees/:employeeId/component-snapshot", requireRole("admin", "hr", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM payroll_employee_component_snapshot
      WHERE employee_id = ?
      ORDER BY effective_from DESC, component_type, component_code`,
    [req.params.employeeId]
  );
  await payrollComplianceService.logSensitiveAccess({
    actorUserId: req.authUser?.id,
    employeeId: req.params.employeeId,
    moduleKey: "payroll",
    actionKey: "COMPONENT_SNAPSHOT_VIEW",
    purpose: "Payroll component verification",
    req,
  });
  return res.json({ success: true, data: rows });
}));

router.post("/lines/:lineId/manual-adjustment", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const schema = z.object({
    adjustmentType: z.enum(["earning", "deduction", "lwp_override", "attendance_override", "statutory_override"]),
    componentCode: z.string().min(1).max(80),
    componentName: z.string().min(1).max(160),
    amount: z.number(),
    reason: z.string().min(8).max(700),
  });
  const body = schema.parse(req.body);
  const [lineRows] = await db.execute<RowDataPacket[]>("SELECT id, run_id, employee_id FROM salary_prep_line WHERE id = ? LIMIT 1", [req.params.lineId]);
  const line = lineRows[0] as any;
  if (!line) return res.status(404).json({ success: false, message: "Payroll line not found" });

  const data = await payrollComplianceService.addManualAdjustment({
    runId: line.run_id,
    lineId: line.id,
    employeeId: line.employee_id,
    adjustmentType: body.adjustmentType,
    componentCode: body.componentCode,
    componentName: body.componentName,
    amount: body.amount,
    reason: body.reason,
    actorUserId: req.authUser?.id ?? null,
  });
  return res.json({ success: true, data, message: "Manual payroll adjustment saved. Recalculate the payroll run to apply final net pay." });
}));

router.get("/runs/:runId/components", requireRole("admin", "hr", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT splc.*, e.employee_code, e.full_name
       FROM salary_prep_line_component splc
       JOIN employees e ON e.id = splc.employee_id
      WHERE splc.run_id = ?
      ORDER BY e.employee_code, FIELD(splc.component_type,'earning','deduction','employer_cost'), splc.component_code`,
    [req.params.runId]
  );
  return res.json({ success: true, data: rows });
}));

router.get("/runs/:runId/register/:registerType", requireRole("admin", "hr", "finance", "payroll", "ceo"), h(async (req: AuthenticatedRequest, res: Response) => {
  const registerType = req.params.registerType;
  const allowed = new Set(["salary", "pf", "esic", "pt", "tds", "bank", "variance"]);
  if (!allowed.has(registerType)) return res.status(400).json({ success: false, message: "Invalid register type" });

  let sql = "";
  if (registerType === "salary") {
    sql = `SELECT spl.employee_code, e.full_name, spl.working_days, spl.present_days, spl.lwp_days,
                  spl.gross_before_lwp, spl.gross_salary, spl.total_deductions, spl.net_salary,
                  spl.lwp_deduction, spl.advance_recovery, spl.manual_adjustment_total
             FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
            WHERE spl.run_id = ? ORDER BY spl.employee_code`;
  } else if (registerType === "pf") {
    sql = `SELECT spl.employee_code, e.full_name, spl.basic, spl.pf_employee, spl.pf_employer
             FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
            WHERE spl.run_id = ? AND (spl.pf_employee > 0 OR spl.pf_employer > 0)
            ORDER BY spl.employee_code`;
  } else if (registerType === "esic") {
    sql = `SELECT spl.employee_code, e.full_name, spl.gross_salary, spl.esic_employee, spl.esic_employer
             FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
            WHERE spl.run_id = ? AND (spl.esic_employee > 0 OR spl.esic_employer > 0)
            ORDER BY spl.employee_code`;
  } else if (registerType === "pt") {
    sql = `SELECT spl.employee_code, e.full_name, b.state AS state_code, spl.gross_salary, spl.professional_tax
             FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN branch_master b ON b.id = e.branch_id
            WHERE spl.run_id = ? AND spl.professional_tax > 0
            ORDER BY b.state, spl.employee_code`;
  } else if (registerType === "tds") {
    sql = `SELECT spl.employee_code, e.full_name, spl.gross_before_lwp, spl.tds_amount, spl.calculation_notes
             FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
            WHERE spl.run_id = ? AND spl.tds_amount > 0
            ORDER BY spl.employee_code`;
  } else if (registerType === "bank") {
    sql = `SELECT spl.employee_code, e.full_name, ebd.bank_name, ebd.account_number, ebd.ifsc_code, spl.net_salary
             FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
             LEFT JOIN employee_bank_details ebd ON ebd.employee_id = e.id AND ebd.active_status = 1
            WHERE spl.run_id = ?
            ORDER BY spl.employee_code`;
  } else {
    sql = `SELECT spl.employee_code, e.full_name, spl.net_salary, spl.manual_adjustment_total, spl.calculation_notes
             FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
            WHERE spl.run_id = ? AND ABS(spl.manual_adjustment_total) > 0
            ORDER BY spl.employee_code`;
  }

  const [rows] = await db.execute<RowDataPacket[]>(sql, [req.params.runId]);
  await db.execute(
    `INSERT INTO payroll_register_export_log (id, run_id, register_type, filter_json, generated_by, row_count)
     VALUES (UUID(), ?, ?, ?, ?, ?)`,
    [req.params.runId, `${registerType}_register`, JSON.stringify(req.query ?? {}), req.authUser?.id ?? null, rows.length]
  );

  return res.json({ success: true, data: rows, count: rows.length });
}));

export { router as payrollComplianceRouter };
