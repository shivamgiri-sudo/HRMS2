import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  canViewDeepReportPack,
  getDeepReportPack,
  resolveAllDeepReportPacks,
  resolveDeepReportPack,
} from "./deep-report-packs.js";
import { deepReportService } from "./deep-report.service.js";
import { resolveBranchScope } from "./reporting.scope.js";

export const deepReportRouter = Router();
deepReportRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const ROLE_ALIASES: Record<string, string[]> = {
  visitor_security: ["security"],
  visitor_reception: ["security"],
  branch_hr: ["hr"],
  hr_branch: ["hr"],
  quality_analyst: ["quality"],
  payroll_hr: ["payroll"],
};

const ROUTE_ALIASES: Record<string, string> = {
  "/performance-dashboard": "/performance-hub",
  "/training": "/lms/coordinator",
  "/it-dashboard": "/it/dashboard",
};

function rolesFor(req: AuthenticatedRequest) {
  const rawRoles = [...new Set([
    ...(req.authUser?.roles ?? []),
    ...(req.userRoles ?? []),
    req.authUser?.role,
  ].filter((role): role is string => Boolean(role)))];
  return [...new Set(rawRoles.flatMap((role) => [role, ...(ROLE_ALIASES[role] ?? [])]))];
}

function normalisedRoutes(routes: Array<{ label: string; path: string }>) {
  return routes.map((route) => ({ ...route, path: ROUTE_ALIASES[route.path] ?? route.path }));
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
      relatedRoutes: normalisedRoutes(pack.relatedRoutes),
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

  const resolved = resolveDeepReportPack(pack);
  return res.json({
    success: true,
    data: {
      ...resolved,
      relatedRoutes: normalisedRoutes(resolved.relatedRoutes),
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

  const requestedBranchId = req.query.branchId ? String(req.query.branchId) : undefined;
  const branchScope = await resolveBranchScope(req.authUser.id);
  if (
    requestedBranchId
    && !branchScope.isSuperAdmin
    && branchScope.branchIds.length > 0
    && !branchScope.branchIds.includes(requestedBranchId)
  ) {
    return res.status(403).json({ success: false, message: "Requested branch is outside your authorised reporting scope" });
  }

  const data = await deepReportService.overview(pack, {
    branchId: requestedBranchId,
    processId: req.query.processId ? String(req.query.processId) : undefined,
    month: req.query.month ? String(req.query.month) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    authorizedBranchIds: branchScope.branchIds,
    scopeIsGlobal: branchScope.isSuperAdmin || branchScope.branchIds.length === 0,
  });

  return res.json({ success: true, data });
}));
