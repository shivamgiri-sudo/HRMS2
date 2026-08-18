import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { pfCreationService } from "./pf-creation.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

router.get("/queue", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getQueue({
    batchId: req.query.batchId as string | undefined,
    itemStatus: req.query.status as string | undefined,
    branchId: req.query.branchId as string | undefined,
    search: req.query.search as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  });
  return res.json({ success: true, data });
}));

router.post("/queue/generate-from-joiners", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.generateBatchFromJoiners(
    {
      branchId: req.body.branchId ?? null,
      establishmentId: req.body.establishmentId ?? null,
    },
    req.authUser!.id,
  );
  return res.status(201).json({ success: true, data });
}));

router.post("/validate", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { batchId } = req.body;
  if (!batchId) return res.status(400).json({ success: false, message: "batchId is required" });
  const data = await pfCreationService.validateBatch(batchId, req.authUser!.id);
  return res.json({ success: true, data });
}));

router.post("/export", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { batchId, templateId } = req.body;
  if (!batchId) return res.status(400).json({ success: false, message: "batchId is required" });
  const data = await pfCreationService.exportBatch(batchId, templateId ?? null, req.authUser!.id);
  return res.json({ success: true, data });
}));

router.post("/import-acknowledgement", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { batchId, records } = req.body;
  if (!batchId) return res.status(400).json({ success: false, message: "batchId is required" });
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ success: false, message: "records array is required" });
  }
  const data = await pfCreationService.importAcknowledgement(batchId, records, req.authUser!.id);
  return res.json({ success: true, data });
}));

/**
 * PF status for one employee.
 *
 * "employee" is in the allowed roles so a person can check their own PF
 * creation status — but requireRole only answers "may you call this", never
 * "about whom". Without the ownership check below, any authenticated employee
 * could read a colleague's record by changing the id in the URL, and
 * getEmployeePfStatus returns epfo_uan_assigned and epfo_member_id_assigned:
 * UAN and PF member ID, which the charter names as never-expose data.
 *
 * Privileged roles are unaffected — they short-circuit before the lookup, so
 * payroll and HR keep reading any employee exactly as before. Only the
 * self-service path is narrowed, which is what it was always meant to be.
 */
router.get("/employee/:employeeId", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr", "employee"), h(async (req: AuthenticatedRequest, res: Response) => {
  const isPrivileged = await hasAnyRole(
    req.authUser!.id,
    "admin", "super_admin", "payroll_hr", "payroll", "hr",
  );
  if (!isPrivileged) {
    const own = await getEmployeeForUser(req.authUser!.id);
    if (!own || own.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: not your PF record" });
    }
  }
  const data = await pfCreationService.getEmployeePfStatus(req.params.employeeId);
  return res.json({ success: true, data });
}));

router.patch("/employee/:employeeId", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const { uan_number, pf_member_id, pf_applicable, pf_establishment_id } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (uan_number !== undefined) {
    updates.push("uan_masked = ?");
    params.push(uan_number);
  }
  if (pf_applicable !== undefined) {
    updates.push("pf_applicable = ?");
    params.push(pf_applicable ? 1 : 0);
  }
  if (pf_establishment_id !== undefined) {
    updates.push("pf_establishment_id = ?");
    params.push(pf_establishment_id);
  }

  if (updates.length > 0) {
    updates.push("updated_at = NOW()");
    params.push(employeeId);
    await (await import("../../db/mysql.js")).db.execute(
      `UPDATE employee_epf_compliance_profile SET ${updates.join(", ")} WHERE employee_id = ?`,
      params,
    );
  }

  if (pf_member_id !== undefined || uan_number !== undefined) {
    const { db } = await import("../../db/mysql.js");
    const { randomUUID } = await import("crypto");
    if (uan_number) {
      await db.execute(
        `INSERT INTO employee_uan (id, employee_id, uan, member_id, is_active)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE uan = VALUES(uan), member_id = VALUES(member_id), is_active = 1`,
        [randomUUID(), employeeId, uan_number, pf_member_id ?? null],
      );
    }
  }

  const data = await pfCreationService.getEmployeePfStatus(employeeId);
  return res.json({ success: true, data, message: "Employee PF details updated." });
}));

router.get("/reports/readiness", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getReadinessReport(req.query.branchId as string | undefined);
  return res.json({ success: true, data });
}));

router.get("/batches", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getBatches({
    status: req.query.status as string | undefined,
    branchId: req.query.branchId as string | undefined,
    establishmentId: req.query.establishmentId as string | undefined,
  });
  return res.json({ success: true, data });
}));

router.get("/batches/:batchId", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getBatchDetail(req.params.batchId);
  if (!data) return res.status(404).json({ success: false, message: "Batch not found" });
  return res.json({ success: true, data });
}));

router.get("/establishments", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getEstablishments();
  return res.json({ success: true, data });
}));

/**
 * Admin CRUD for pf_establishment_master.
 *
 * The table ships with zero rows (backend/sql/370_pf_creation_automation.sql
 * is DDL only) — there is no CRUD here to seed a placeholder establishment.
 * A real EPFO establishment code has to come from Finance; these routes only
 * let an authorised user record/edit/deactivate rows that a human enters.
 *
 * GET /establishments/all lists every row (active and inactive) for the admin
 * table; GET /establishments (above) stays filtered to active_status = 1 —
 * that is the read path EcrDownloadTab's establishment picker already calls,
 * unchanged by this addition.
 */
router.get("/establishments/all", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getAllEstablishments();
  return res.json({ success: true, data });
}));

router.post("/establishments", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { establishment_code, establishment_name, branch_id, legal_entity, address, region_office } = req.body ?? {};
  const data = await pfCreationService.createEstablishment(
    {
      establishment_code,
      establishment_name,
      branch_id: branch_id ?? null,
      legal_entity: legal_entity ?? null,
      address: address ?? null,
      region_office: region_office ?? null,
    },
    req.authUser!.id,
  );
  return res.status(201).json({ success: true, data, message: "PF establishment created." });
}));

router.put("/establishments/:id", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { establishment_code, establishment_name, branch_id, legal_entity, address, region_office } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (establishment_code !== undefined) updates.establishment_code = establishment_code;
  if (establishment_name !== undefined) updates.establishment_name = establishment_name;
  if (branch_id !== undefined) updates.branch_id = branch_id;
  if (legal_entity !== undefined) updates.legal_entity = legal_entity;
  if (address !== undefined) updates.address = address;
  if (region_office !== undefined) updates.region_office = region_office;

  const data = await pfCreationService.updateEstablishment(req.params.id, updates, req.authUser!.id);
  return res.json({ success: true, data, message: "PF establishment updated." });
}));

// Soft activate/deactivate only — no hard DELETE, so a batch or ECR file that
// already references this establishment_id never loses its foreign key.
// Restricted to admin/super_admin: deactivating a live establishment removes
// it from the ECR picker and can block a Payroll user mid-filing.
router.patch("/establishments/:id/status", requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { active_status } = req.body ?? {};
  if (active_status !== 0 && active_status !== 1) {
    return res.status(400).json({ success: false, message: "active_status must be 0 or 1" });
  }
  const data = await pfCreationService.setEstablishmentActiveStatus(req.params.id, active_status, req.authUser!.id);
  return res.json({ success: true, data, message: active_status === 1 ? "Establishment activated." : "Establishment deactivated." });
}));

router.get("/export-templates", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getExportTemplates();
  return res.json({ success: true, data });
}));

// GET /api/payroll/pf/ecr-monthly?month=YYYY-MM&establishmentId=<uuid>
router.get(
  "/ecr-monthly",
  requireRole("admin", "super_admin", "payroll_hr", "payroll", "payroll_head", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { month, establishmentId } = req.query as Record<string, string>;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, error: "month must be YYYY-MM" });
    }
    if (!establishmentId) {
      return res.status(400).json({ success: false, error: "establishmentId is required" });
    }
    const result = await pfCreationService.generateEcrFile(month, establishmentId);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`
    );
    return res.send(result.content);
  })
);

export { router as pfCreationRouter };
