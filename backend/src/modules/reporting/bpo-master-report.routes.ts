import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { BPO_MASTER_REPORTS, getBpoMasterReport } from "./bpo-master-report-catalog.js";
import { bpoMasterReportService } from "./bpo-master-report.service.js";
import { resolveBranchScope } from "./reporting.scope.js";

export const bpoMasterReportRouter = Router();
bpoMasterReportRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const ROLE_ALIASES: Record<string, string[]> = {
  finance_head: ["finance"],
  accounts_head: ["finance"],
  payroll_head: ["payroll"],
  payroll_branch: ["payroll"],
  payroll_hr: ["payroll"],
  recruitment_hr: ["recruiter"],
  quality_analyst: ["quality"],
  qa: ["quality"],
  visitor_security: ["security"],
  visitor_reception: ["security"],
  branch_hr: ["hr"],
  hr_branch: ["hr"],
  team_leader: ["manager"],
  tl: ["manager"],
};

function rolesFor(req: AuthenticatedRequest) {
  const raw = [...new Set([
    ...(req.authUser?.roles ?? []),
    ...(req.userRoles ?? []),
    req.authUser?.role,
  ].filter((role): role is string => Boolean(role)))];
  return [...new Set(raw.flatMap((role) => [role, ...(ROLE_ALIASES[role] ?? [])]))];
}

function canView(roles: string[], allowed: string[]) {
  return roles.includes("super_admin") || allowed.some((role) => roles.includes(role));
}

function canExport(roles: string[], allowed: string[]) {
  return roles.includes("super_admin") || allowed.some((role) => roles.includes(role));
}

function isExportRequest(req: AuthenticatedRequest) {
  return ["1", "true", "yes"].includes(String(req.query.export ?? "").toLowerCase());
}

function maskSensitiveValue(value: unknown) {
  if (value === null || value === undefined || value === "") return value;
  const text = String(value);
  if (text.length <= 4) return "RESTRICTED";
  return `****${text.slice(-4)}`;
}

bpoMasterReportRouter.get("/", h(async (req, res) => {
  const roles = rolesFor(req);
  const data = BPO_MASTER_REPORTS
    .filter((report) => canView(roles, report.viewRoles))
    .map((report) => ({
      ...report,
      canExport: canExport(roles, report.exportRoles),
    }));
  return res.json({
    success: true,
    data,
    meta: {
      reportCount: data.length,
      totalMasterReportCount: BPO_MASTER_REPORTS.length,
      employeeCodePolicy: "MANDATORY",
      dateStandard: "DD-MMM-YYYY",
      headerStandard: "UPPER_CASE",
      roles,
    },
  });
}));

bpoMasterReportRouter.get("/:code", h(async (req, res) => {
  const definition = getBpoMasterReport(String(req.params.code));
  if (!definition) return res.status(404).json({ success: false, message: "BPO master report not found" });

  const roles = rolesFor(req);
  if (!canView(roles, definition.viewRoles)) {
    return res.status(403).json({ success: false, message: "You do not have permission to view this BPO master report" });
  }
  const exportRequested = isExportRequest(req);
  const exportAllowed = canExport(roles, definition.exportRoles);
  if (exportRequested && !exportAllowed) {
    return res.status(403).json({ success: false, message: "You do not have permission to export this BPO master report" });
  }

  const branchScope = await resolveBranchScope(req.authUser.id);
  const requestedBranchId = req.query.branchId ? String(req.query.branchId) : undefined;
  if (
    requestedBranchId
    && !branchScope.isSuperAdmin
    && branchScope.branchIds.length > 0
    && !branchScope.branchIds.includes(requestedBranchId)
  ) {
    return res.status(403).json({ success: false, message: "Requested branch is outside your authorised reporting scope" });
  }

  const result = await bpoMasterReportService.run(definition.code, {
    month: req.query.month ? String(req.query.month) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    branchId: requestedBranchId,
    processId: req.query.processId ? String(req.query.processId) : undefined,
    employeeCode: req.query.employeeCode ? String(req.query.employeeCode) : undefined,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
    export: exportRequested,
  }, branchScope);

  const responseRows = !exportAllowed && result.rows.length
    ? result.rows.map((row) => {
        const sensitiveKeys = new Set(definition.columns.filter((column) => column.sensitive).map((column) => column.key));
        const masked = { ...row };
        for (const key of sensitiveKeys) masked[key] = maskSensitiveValue(masked[key]);
        return masked;
      })
    : result.rows;

  return res.json({
    success: true,
    data: {
      ...result,
      rows: responseRows,
      sensitiveDataMasked: !exportAllowed,
    },
  });
}));
