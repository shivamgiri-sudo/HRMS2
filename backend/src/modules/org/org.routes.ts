import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getUserAssignmentScopes } from "../../shared/scopeAccess.js";
import {
  branchService, departmentService, lobService, designationService,
  campaignService, costCentreService, gradeBandService,
  locationService, policyService,
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

// Static sub-routes must be registered BEFORE buildCrud to avoid /:id swallowing them

// GET /api/org/branches/cc-code-map
router.get("/branches/cc-code-map",
  requireRole("admin", "hr"),
  h(async (_req: any, res: any) => {
    const data = await branchService.getCallCentreCodeMap();
    res.json({ data });
  })
);

// GET /api/org/cost-centres/by-branch
// Returns active cost centres scoped to the caller's assigned branch(es).
// Branch-scoped HR sees only their branch; admin/global-HR sees all active.
router.get(
  "/cost-centres/by-branch",
  requireRole("admin", "hr"),
  h(async (req: any, res: Response) => {
    const scopes = await getUserAssignmentScopes(req.authUser!.id);
    const branchIds = [...new Set(
      scopes
        .map((s: any) => s.branch_id)
        .filter((id: string | null) => id != null)
    )] as string[];

    if (branchIds.length === 0) {
      // No branch restriction — admin or global HR: return all active cost centres
      const { db } = await import("../../db/mysql.js");
      const [rows] = await db.execute(
        `SELECT id, cost_centre_code, cost_centre_name, branch_id
           FROM cost_centre_master
          WHERE active_status = 1
          ORDER BY cost_centre_code`
      );
      return res.json({ data: rows });
    }

    // Branch-scoped HR: only cost centres belonging to their branch(es)
    const { db } = await import("../../db/mysql.js");
    const placeholders = branchIds.map(() => "?").join(", ");
    const [rows] = await db.execute(
      `SELECT id, cost_centre_code, cost_centre_name, branch_id
         FROM cost_centre_master
        WHERE active_status = 1
          AND branch_id IN (${placeholders})
        ORDER BY cost_centre_code`,
      branchIds
    );
    return res.json({ data: rows });
  })
);

// POST /api/org/cost-centres/sync-from-billing  (admin only)
// Pulls active cost_master records from db_bill and deactivates any stale
// entries in mas_hrms that no longer exist in db_bill.
router.post(
  "/cost-centres/sync-from-billing",
  requireRole("admin"),
  h(async (_req: any, res: Response) => {
    const { db } = await import("../../db/mysql.js");
    const { billDb } = await import("../../db/mysql.js");

    // 1. Fetch active codes from db_bill
    const [billRows] = await billDb.execute<any[]>(
      "SELECT cost_center, CostCenterName, branch FROM cost_master WHERE active = 1 AND (close = 0 OR close IS NULL)"
    );
    const billActive = new Map<string, { name: string; branch: string }>();
    for (const r of billRows) {
      const code = r.cost_center?.trim();
      if (code) billActive.set(code, { name: r.CostCenterName ?? code, branch: r.branch ?? "" });
    }

    // 2. Fetch all from mas_hrms
    const [hrmsRows] = await db.execute<any[]>(
      "SELECT id, cost_centre_code, active_status FROM cost_centre_master"
    );

    const toDeactivate: string[] = [];
    const toReactivate: string[] = [];

    for (const r of hrmsRows) {
      const inBill = billActive.has(r.cost_centre_code);
      if (inBill && r.active_status === 0) toReactivate.push(r.id);
      if (!inBill && r.active_status === 1) toDeactivate.push(r.id);
    }

    // 3. Apply changes
    if (toDeactivate.length > 0) {
      const ph = toDeactivate.map(() => "?").join(",");
      await db.execute(`UPDATE cost_centre_master SET active_status = 0, updated_at = NOW() WHERE id IN (${ph})`, toDeactivate);
    }
    if (toReactivate.length > 0) {
      const ph = toReactivate.map(() => "?").join(",");
      await db.execute(`UPDATE cost_centre_master SET active_status = 1, updated_at = NOW() WHERE id IN (${ph})`, toReactivate);
    }

    // 4. Count result
    const [after] = await db.execute<any[]>("SELECT COUNT(*) AS cnt FROM cost_centre_master WHERE active_status = 1");

    return res.json({
      success: true,
      deactivated: toDeactivate.length,
      reactivated: toReactivate.length,
      active_after_sync: (after as any)[0].cnt,
    });
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

export { router as orgRouter };
