import type { Request, Response } from "express";
import { createEmployeeSchema, employeeFiltersSchema, updateEmployeeSchema } from "./employee.validation.js";
import { employeeService } from "./employee.service.js";
import { redactEmployeeIdentifiers } from "../../shared/employeeIdentifierRedaction.js";

export const employeeController = {
  async createEmployee(req: Request, res: Response) {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await employeeService.createEmployee(parsed.data, (req as any).authUser?.id ?? "system");
    res.status(201).json({ data });
  },

  async listEmployees(req: Request, res: Response) {
    const parsed = employeeFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await employeeService.listEmployees({
      ...parsed.data,
      scopeFilter: (req as any).scopeFilter,
    });
    res.json({ data: result.data, total: result.total, page: result.page, limit: result.limit, stats: result.stats, process_breakdown: result.process_breakdown });
  },

  async getEmployee(req: Request, res: Response) {
    const data = await employeeService.getEmployee(req.params.id);
    // getEmployee is SELECT *, so the row carries aadhaar/pan/bank/uan and the at-rest
    // crypto columns. The route admits wfm, manager, branch_head, process_manager and
    // it_head, none of which have a business need for those. Redact per role — see
    // shared/employeeIdentifierRedaction.ts for the split and what it deliberately leaves alone.
    const authUser = (req as any).authUser;
    const roles: string[] = authUser?.roles?.length ? authUser.roles : (authUser?.role ? [authUser.role] : []);
    res.json({ data: redactEmployeeIdentifiers(data as unknown as Record<string, unknown>, roles) });
  },

  async updateEmployee(req: Request, res: Response) {
    const parsed = updateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await employeeService.updateEmployee(req.params.id, parsed.data, (req as any).authUser?.id ?? "system");
    res.json({ data });
  },

  async deactivateEmployee(req: Request, res: Response) {
    const reason = (req.body as { reason?: string } | undefined)?.reason
      ?? (req.query.reason as string | undefined);
    await employeeService.deactivateEmployee(
      req.params.id,
      (req as any).authUser?.id ?? "system",
      reason
    );
    res.status(204).send();
  },

  // updateMyProfile used to live here — a third, independent implementation of PATCH /me
  // with its own field allowlist (disagreeing with both employee.routes.ts's live handler
  // and the deleted employee.profile.service.ts's own version — e.g. this one alone mapped
  // nominee_name/nominee_relation onto employees columns). Never routed: employee.routes.ts
  // only wires c.createEmployee/listEmployees/getEmployee/updateEmployee/deactivateEmployee.
  // Removed as confirmed-dead (profile-trust-audit, 2026-08-13; re-verified zero callers
  // before deletion). The live self-editable-field allowlist is
  // employee.routes.ts's ALLOWED_FIELDS on the routed PATCH /me handler — see
  // fieldOwnership.ts for the single source of truth this replaces.
};
