import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getAvailableScopes,
  getOrgTree,
  getNodeDetail,
  searchOrgChart,
  getDataQualityReport,
} from "./org-chart.service.js";
import { logChartView, logChartSearch, logNodeDetail, logDataQualityCheck } from "./org-chart.audit.js";
import type { OrgChartScope } from "./org-chart.scope.js";

const router = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

router.use(requireAuth);

/**
 * GET /api/org-chart/scopes
 * Returns available scopes for the current user.
 */
router.get("/scopes", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const context = await getAvailableScopes(userId);

  return res.json({
    success: true,
    data: {
      available_scopes: context.availableScopes.map((s) => ({
        value: s.scopeType,
        label: s.scopeName,
        count: s.employeeCount,
        can_export: s.canExport,
        can_see_data_quality: s.canSeeDataQuality,
      })),
      default_scope: context.defaultScope,
      current_employee: context.employeeId
        ? {
            id: context.employeeId,
            name: null, // Will be resolved by frontend if needed
            designation: null,
            branch: context.branchName,
            process: context.processName,
          }
        : null,
    },
  });
}));

/**
 * GET /api/org-chart/tree
 * Returns org tree for the requested scope with filters.
 */
router.get("/tree", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const scope = (req.query.scope as OrgChartScope) || "my-chain";
  const filters = {
    branchId: req.query.branch_id as string | undefined,
    processId: req.query.process_id as string | undefined,
    departmentId: req.query.department_id as string | undefined,
    designationId: req.query.designation_id as string | undefined,
    status: (req.query.status as string | undefined) || "active",
  };

  const treeData = await getOrgTree(userId, scope, filters);

  // Audit log
  const context = await getAvailableScopes(userId);
  await logChartView(userId, context.employeeId, scope, treeData.scope.scope_id, filters, req);

  return res.json({
    success: true,
    data: treeData,
  });
}));

/**
 * GET /api/org-chart/node/:employeeId
 * Returns single node detail with reporting chain and direct reports.
 */
router.get("/node/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const targetEmployeeId = req.params.employeeId;

  const nodeData = await getNodeDetail(userId, targetEmployeeId);

  // Audit log
  const context = await getAvailableScopes(userId);
  await logNodeDetail(userId, context.employeeId, targetEmployeeId, req);

  return res.json({
    success: true,
    data: nodeData,
  });
}));

/**
 * GET /api/org-chart/search
 * Search org chart within allowed scope.
 */
router.get("/search", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const query = (req.query.q as string) || "";
  const scope = (req.query.scope as OrgChartScope) || "my-chain";

  if (!query.trim()) {
    return res.json({
      success: true,
      data: {
        results: [],
        scope_applied: scope,
        total_results: 0,
      },
    });
  }

  const searchResults = await searchOrgChart(userId, query, scope);

  // Audit log
  const context = await getAvailableScopes(userId);
  await logChartSearch(userId, context.employeeId, scope, null, query, req);

  return res.json({
    success: true,
    data: searchResults,
  });
}));

/**
 * GET /api/org-chart/data-quality
 * Returns data quality report (HR/Admin only).
 */
router.get(
  "/data-quality",
  requireRole("admin", "hr", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const scopeFilter = {
      branchId: req.query.branch_id as string | undefined,
      processId: req.query.process_id as string | undefined,
    };

    const qualityReport = await getDataQualityReport(userId, scopeFilter);

    // Audit log
    const context = await getAvailableScopes(userId);
    await logDataQualityCheck(
      userId,
      context.employeeId,
      scopeFilter.branchId ? "branch" : scopeFilter.processId ? "process" : "company",
      scopeFilter.branchId || scopeFilter.processId || null,
      req
    );

    return res.json({
      success: true,
      data: qualityReport,
    });
  })
);

/**
 * POST /api/org-chart/rebuild-cache
 * Rebuild org chart snapshot cache (Admin only).
 * Phase 2: Not implemented yet — returns 501 Not Implemented.
 */
router.post(
  "/rebuild-cache",
  requireRole("admin", "hr", "super_admin"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    return res.status(501).json({
      success: false,
      message: "Cache rebuild not implemented in Phase 1. Coming in Phase 2.",
    });
  })
);

/**
 * GET /api/org-chart/export
 * Export org chart to Excel or PDF (HR/Admin only).
 * Phase 2: Not implemented yet — returns 501 Not Implemented.
 */
router.get(
  "/export",
  requireRole("admin", "hr", "super_admin"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    return res.status(501).json({
      success: false,
      message: "Export functionality not implemented in Phase 1. Coming in Phase 2.",
    });
  })
);

export { router as orgChartRouter };
