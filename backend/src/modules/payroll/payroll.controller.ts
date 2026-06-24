import type { Request, Response } from "express";
import {
  assignSalarySchema,
  advanceSchema,
  bulkAssignSchema,
  createComponentSchema,
  createRunSchema,
  createStructureSchema,
  runFiltersSchema,
  updatePrepLineSchema,
  updateRunStatusSchema,
  updateOvertimeSchema,
} from "./payroll.validation.js";
import { payrollService } from "./payroll.service.js";

export const payrollController = {
  // ─── Structures ────────────────────────────────────────────────────────────

  async listStructures(req: Request, res: Response) {
    const data = await payrollService.listStructures();
    res.json({ data });
  },

  async createStructure(req: Request, res: Response) {
    const parsed = createStructureSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.createStructure(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  // ─── Components ────────────────────────────────────────────────────────────

  async listComponents(req: Request, res: Response) {
    const data = await payrollService.listComponents();
    res.json({ data });
  },

  async createComponent(req: Request, res: Response) {
    const parsed = createComponentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.createComponent(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  // ─── Salary Assignment ─────────────────────────────────────────────────────

  async assignSalary(req: Request, res: Response) {
    const parsed = assignSalarySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.assignSalary(parsed.data, (req as any).authUser?.id ?? "system");
    res.status(201).json({ data });
  },

  async getEmployeeSalary(req: Request, res: Response) {
    const data = await payrollService.getEmployeeSalary(req.params.employeeId);
    res.json({ data });
  },

  async getEmployeeSalaryHistory(req: Request, res: Response) {
    // getEmployeeSalaryHistory not yet on service — safe runtime fallback
    const svc = payrollService as any;
    const data = await svc.getEmployeeSalaryHistory?.(req.params.employeeId) ?? [];
    res.json({ data });
  },

  // ─── Prep Runs ─────────────────────────────────────────────────────────────

  async createRun(req: Request, res: Response) {
    const parsed = createRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.createRun(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  async listRuns(req: Request, res: Response) {
    const parsed = runFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const filtersWithScope = { ...parsed.data, scopeFilter: (req as any).scopeFilter };
    const result = await payrollService.listRuns(filtersWithScope);
    // Parse run_month (YYYY-MM) into numeric month/year for frontend consumption
    const enriched = result.data.map((r: any) => {
      const [yr, mo] = (r.run_month ?? '').split('-').map(Number);
      return { ...r, month: mo || 0, year: yr || 0 };
    });
    res.json({ success: true, data: enriched, total: result.total, page: result.page, limit: result.limit });
  },

  async listPayrollRecords(req: Request, res: Response) {
    const parsed = runFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    // listPayrollRecords not yet on service — safe runtime fallback
    const svc = payrollService as any;
    if (typeof svc.listPayrollRecords !== "function") {
      return res.status(501).json({ success: false, message: "Not yet implemented" });
    }
    const result = await svc.listPayrollRecords({
      ...parsed.data,
      scopeFilter: (req as any).scopeFilter,
    });
    res.json({ success: true, data: result.data, total: result.total, page: result.page, limit: result.limit });
  },

  async getPayrollOverview(req: Request, res: Response) {
    const runMonth = typeof req.query.runMonth === "string"
      ? req.query.runMonth
      : new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(runMonth)) {
      return res.status(400).json({ success: false, message: "runMonth must be YYYY-MM" });
    }
    // getPayrollOverview not yet on service — safe runtime fallback
    const svc = payrollService as any;
    if (typeof svc.getPayrollOverview !== "function") {
      return res.status(501).json({ success: false, message: "Not yet implemented" });
    }
    const data = await svc.getPayrollOverview(runMonth);
    res.json({ success: true, data });
  },

  async getRun(req: Request, res: Response) {
    const data = await payrollService.getRun(req.params.id);
    res.json({ data });
  },

  async updateRunStatus(req: Request, res: Response) {
    const parsed = updateRunStatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.updateRunStatus(req.params.id, parsed.data, (req as any).userId ?? "system");
    res.json({ data });
  },

  // ─── Prep Lines ────────────────────────────────────────────────────────────

  async listLines(req: Request, res: Response) {
    const data = await payrollService.listLines(req.params.id);
    res.json({ data });
  },

  async updateLine(req: Request, res: Response) {
    const parsed = updatePrepLineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.updateLine(req.params.id, parsed.data, (req as any).userId ?? "system");
    res.json({ data });
  },

  async updateOvertime(req: Request, res: Response) {
    const parsed = updateOvertimeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    // updateOvertime not yet on service — safe runtime fallback
    const svc = payrollService as any;
    if (typeof svc.updateOvertime !== "function") {
      return res.status(501).json({ success: false, message: "Not yet implemented" });
    }
    const data = await svc.updateOvertime(
      req.params.lineId,
      parsed.data,
      (req as any).authUser?.id ?? "system"
    );
    res.json({ success: true, data });
  },

  // ─── Advances ──────────────────────────────────────────────────────────────

  async createAdvance(req: Request, res: Response) {
    const parsed = advanceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.createAdvance(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  async listAdvances(req: Request, res: Response) {
    const data = await payrollService.listAdvances(req.params.employeeId);
    res.json({ data });
  },

  // ─── Bulk assign ───────────────────────────────────────────────────────────

  async bulkAssignSalary(req: Request, res: Response) {
    const parsed = bulkAssignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await payrollService.bulkAssignSalary(parsed.data, (req as any).userId ?? "system");
    res.json({ data });
  },

  // ─── Statutory Config ──────────────────────────────────────────────────────

  async getStatutoryConfig(_req: Request, res: Response) {
    const data = await payrollService.getStatutoryConfig();
    res.json({ data });
  },
};
