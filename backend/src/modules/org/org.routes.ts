import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import * as XLSX from "xlsx";
import {
  branchService, departmentService, lobService, designationService,
  campaignService, costCentreService, gradeBandService,
  locationService, policyService, processService,
} from "./org.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// All list/get: any authenticated user (needed for dropdowns)
// Create/update/delete: admin or hr

function buildCrud(
  path: string,
  svc: { list(): any; getById(id: string): any; create(d: any): any; update(id: string, d: any): any; delete(id: string): any }
) {
  router.get(path, h(async (_req: Request, res: Response) => {
    res.json({ data: await svc.list() });
  }));
  router.get(`${path}/:id`, h(async (req: Request, res: Response) => {
    const item = await svc.getById(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json({ data: item });
  }));
  router.post(path, requireRole("admin", "hr"), h(async (req: Request, res: Response) => {
    const item = await svc.create(req.body);
    res.status(201).json({ data: item });
  }));
  router.put(`${path}/:id`, requireRole("admin", "hr"), h(async (req: Request, res: Response) => {
    const item = await svc.update(req.params.id, req.body);
    res.json({ data: item });
  }));
  router.delete(`${path}/:id`, requireRole("admin"), h(async (req: Request, res: Response) => {
    await svc.delete(req.params.id);
    res.json({ ok: true });
  }));
}

// Canonical filter source for all pages. Use this instead of building filters from employee/report rows.
router.get("/filter-options", h(async (_req: Request, res: Response) => {
  const [managers] = await db.execute<any[]>(
    `SELECT e.id, e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name
       FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
        AND EXISTS (SELECT 1 FROM employees team WHERE team.reporting_manager_id = e.id OR team.manager_id = e.id)
      ORDER BY full_name ASC`
  );
  res.json({
    success: true,
    data: {
      branches: await branchService.list(),
      departments: await departmentService.list(),
      processes: await processService.list(),
      costCentres: await costCentreService.list(),
      designations: await designationService.list(),
      locations: await locationService.list(),
      managers,
    },
    meta: { activeOnly: true },
  });
}));

// Call Centre Code: register GET before buildCrud to avoid /:id swallowing the static segment
router.get("/branches/cc-code-map",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (_req: any, res: any) => {
    const data = await branchService.getCallCentreCodeMap();
    res.json({ data });
  })
);

buildCrud("/branches",      branchService);
buildCrud("/departments",   departmentService);
buildCrud("/lobs",          lobService);
buildCrud("/designations",  designationService);
buildCrud("/campaigns",     campaignService);
buildCrud("/cost-centres",  costCentreService);
buildCrud("/grade-bands",   gradeBandService);
buildCrud("/locations",     locationService);
buildCrud("/policies",      policyService);
buildCrud("/processes",     processService);

// Call Centre Code: PATCH can safely follow buildCrud (different HTTP method, no collision)
router.patch("/branches/:id/call-centre-code",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (req: any, res: any) => {
    const { ccCode } = req.body;
    if (!ccCode || typeof ccCode !== "string" || ccCode.trim().length === 0) {
      return res.status(400).json({ error: "ccCode is required" });
    }
    await branchService.updateCallCentreCode(req.params.id, ccCode.trim().toUpperCase());
    res.json({ success: true });
  })
);

// ── Excel export: branches + processes + cost centres ─────────────────────────
router.get("/export/masters",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (_req: Request, res: Response) => {
    const [branches, processes, costCentres] = await Promise.all([
      branchService.list(),
      processService.list(),
      costCentreService.list(),
    ]);

    const wb = XLSX.utils.book_new();

    // Sheet 1: Branch Master
    const branchRows = (branches as any[]).map((b) => ({
      "Branch Code": b.branch_code ?? "",
      "Branch Name": b.branch_name ?? "",
      "City": b.city ?? "",
      "State": b.state ?? "",
      "Call Centre Code": b.call_centre_code ?? "",
      "Status": Number(b.active_status) === 1 ? "Active" : "Inactive",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(branchRows), "Branch Master");

    // Sheet 2: Process Master
    const processRows = (processes as any[]).map((p) => ({
      "Process Code": p.process_code ?? "",
      "Process Name": p.process_name ?? "",
      "Client Name": p.client_name ?? "",
      "Branch": p.branch_name ?? "",
      "Business LOB": p.business_lob ?? "",
      "Workload Type": p.workload_type ?? "",
      "Status": Number(p.active_status) === 1 ? "Active" : "Inactive",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(processRows), "Process Master");

    // Sheet 3: Cost Centre Master
    const ccRows = (costCentres as any[]).map((c) => ({
      "Cost Centre Code": c.cost_centre_code ?? "",
      "Cost Centre Name": c.cost_centre_name ?? "",
      "Branch ID": c.branch_id ?? "",
      "Department ID": c.department_id ?? "",
      "Status": Number(c.active_status) === 1 ? "Active" : "Inactive",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ccRows), "Cost Centre Master");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="org-masters-${today}.xlsx"`);
    res.send(buf);
  })
);

export { router as orgRouter };