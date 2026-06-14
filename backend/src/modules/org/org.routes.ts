import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
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

export { router as orgRouter };
