import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  branchService, departmentService, lobService, designationService,
  campaignService, costCentreService, gradeBandService,
} from "./org.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

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

buildCrud("/branches",      branchService);
buildCrud("/departments",   departmentService);
buildCrud("/lobs",          lobService);
buildCrud("/designations",  designationService);
buildCrud("/campaigns",     campaignService);
buildCrud("/cost-centres",  costCentreService);
buildCrud("/grade-bands",   gradeBandService);

export { router as orgRouter };
