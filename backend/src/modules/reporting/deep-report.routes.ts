import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  canViewDeepReportPack,
  getDeepReportPack,
  resolveAllDeepReportPacks,
  resolveDeepReportPack,
} from "./deep-report-packs.js";
import { deepReportService } from "./deep-report.service.js";

export const deepReportRouter = Router();
deepReportRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

function rolesFor(req: AuthenticatedRequest) {
  return [...new Set([
    ...(req.authUser?.roles ?? []),
    ...(req.userRoles ?? []),
    req.authUser?.role,
  ].filter((role): role is string => Boolean(role)))];
}

function canExport(roles: string[], exportRoles: string[]) {
  return roles.includes("super_admin") || exportRoles.some((role) => roles.includes(role));
}

deepReportRouter.get("/", h(async (req, res) => {
  const roles = rolesFor(req);
  const packs = resolveAllDeepReportPacks()
    .filter((pack) => canViewDeepReportPack(pack, roles))
    .map((pack) => ({
      ...pack,
      canExport: canExport(roles, pack.exportRoles),
    }));

  return res.json({
    success: true,
    data: packs,
    meta: {
      packCount: packs.length,
      detailedReportCount: new Set(
        packs.flatMap((pack) => pack.perspectives.flatMap((perspective) => perspective.reports.map((report) => report.code)))
      ).size,
      roles,
      architecture: "deep-section-packs-v1",
    },
  });
}));

deepReportRouter.get("/:code", h(async (req, res) => {
  const pack = getDeepReportPack(String(req.params.code));
  if (!pack) return res.status(404).json({ success: false, message: "Report section not found" });

  const roles = rolesFor(req);
  if (!canViewDeepReportPack(pack, roles)) {
    return res.status(403).json({ success: false, message: "You do not have access to this report section" });
  }

  return res.json({
    success: true,
    data: {
      ...resolveDeepReportPack(pack),
      canExport: canExport(roles, pack.exportRoles),
    },
  });
}));

deepReportRouter.get("/:code/overview", h(async (req, res) => {
  const pack = getDeepReportPack(String(req.params.code));
  if (!pack) return res.status(404).json({ success: false, message: "Report section not found" });

  const roles = rolesFor(req);
  if (!canViewDeepReportPack(pack, roles)) {
    return res.status(403).json({ success: false, message: "You do not have access to this report section" });
  }

  const data = await deepReportService.overview(pack, {
    branchId: req.query.branchId ? String(req.query.branchId) : undefined,
    processId: req.query.processId ? String(req.query.processId) : undefined,
    month: req.query.month ? String(req.query.month) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  });

  return res.json({ success: true, data });
}));
