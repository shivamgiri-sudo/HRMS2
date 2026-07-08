import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
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

router.get("/employee/:employeeId", requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr", "employee"), h(async (req: AuthenticatedRequest, res: Response) => {
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

router.get("/export-templates", requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const data = await pfCreationService.getExportTemplates();
  return res.json({ success: true, data });
}));

export { router as pfCreationRouter };
