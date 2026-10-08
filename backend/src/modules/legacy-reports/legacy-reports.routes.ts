import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { resolveDashboardScopeForRequest, DashboardScopeConfigurationError } from "../../shared/dashboardScope.js";
import { legacyReportsService, type LegacyFilter } from "./legacy-reports.service.js";

export const legacyReportsRouter = Router();

/** Salary voucher sensitivity: full payroll in one response. Narrow roles only. */
const ROLES = ["super_admin", "hr_admin", "payroll_hr", "finance_head"] as const;

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function parseFilter(query: Record<string, unknown>): LegacyFilter {
  return {
    branch:         query.branch         ? String(query.branch)         : undefined,
    process:        query.process        ? String(query.process)        : undefined,
    month:          query.month          ? String(query.month)          : undefined,
    from_date:      query.from_date      ? String(query.from_date)      : undefined,
    to_date:        query.to_date        ? String(query.to_date)        : undefined,
    employee_code:  query.employee_code  ? String(query.employee_code)  : undefined,
    employee_name:  query.employee_name  ? String(query.employee_name)  : undefined,
  };
}

legacyReportsRouter.use(requireAuth);

/**
 * Branch scoping (owner ruling 2026-10-01). ?branch= is a client filter, not scoping: hr_admin / payroll_hr are held
 * to the branch(es) their scope allows. Org-wide callers are untouched. A scoped caller's branch must be one of theirs;
 * when they name none and have exactly one, it is pinned; with several they must choose (fail closed, never "all").
 * Returns false after sending the 403.
 */
async function applyBranchScope(req: AuthenticatedRequest, res: any, filter: LegacyFilter): Promise<boolean> {
  let names: string[] | null = null;
  try {
    const scope = await resolveDashboardScopeForRequest(req.authUser as any, "");
    if (scope.level !== "ORG_ALL") {
      if (scope.level === "SELF_ONLY" || scope.level === "TEAM_ONLY" || scope.branchIds.length === 0) names = [];
      else {
        const [rows] = await db.execute<any[]>(
          `SELECT branch_name FROM branch_master WHERE id IN (${scope.branchIds.map(() => "?").join(",")})`, scope.branchIds);
        names = (rows as any[]).map((r) => String(r.branch_name));
      }
    }
  } catch (err) {
    if (!(err instanceof DashboardScopeConfigurationError)) throw err;
    names = [];
  }
  if (names === null) return true;
  const deny = (m: string) => { res.status(403).json({ success: false, message: m }); return false; };
  if (names.length === 0) return deny("Forbidden: no branch scope resolved for your account");
  if (filter.branch) {
    return names.includes(filter.branch) ? true : deny("Forbidden: this branch is outside your branch / assigned scope");
  }
  if (names.length === 1) { filter.branch = names[0]; return true; }
  return deny("Choose a branch inside your assigned scope");
}

/** List all available legacy report codes and labels. */
legacyReportsRouter.get(
  "/",
  requireRole(...ROLES),
  h(async (_req, res) => {
    res.json({ success: true, data: legacyReportsService.list() });
  }),
);

/** Run a report and return JSON rows. */
legacyReportsRouter.get(
  "/:code",
  requireRole(...ROLES),
  h(async (req, res) => {
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!(await applyBranchScope(req, res, filter))) return;
    const result = await legacyReportsService.run(req.params.code, filter);
    res.json({ success: true, data: result });
  }),
);

/** Download a report as CSV. */
legacyReportsRouter.get(
  "/:code/export",
  requireRole(...ROLES),
  h(async (req, res) => {
    const filter = parseFilter(req.query as Record<string, unknown>);
    if (!(await applyBranchScope(req, res, filter))) return;
    const result = await legacyReportsService.run(req.params.code, filter, { forExport: true });
    const xlsb   = legacyReportsService.toXlsb(result, req.params.code);
    const period = req.query.month ? `-${String(req.query.month)}` : "";
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="legacy-${req.params.code}${period}.xlsb"`,
    );
    res.send(xlsb);
  }),
);
