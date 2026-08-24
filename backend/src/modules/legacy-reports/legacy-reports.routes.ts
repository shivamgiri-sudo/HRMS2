import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
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
    const result = await legacyReportsService.run(
      req.params.code,
      parseFilter(req.query as Record<string, unknown>),
    );
    res.json({ success: true, data: result });
  }),
);

/** Download a report as CSV. */
legacyReportsRouter.get(
  "/:code/export",
  requireRole(...ROLES),
  h(async (req, res) => {
    const result = await legacyReportsService.run(
      req.params.code,
      parseFilter(req.query as Record<string, unknown>),
      { forExport: true },
    );
    const csv    = legacyReportsService.toCsv(result);
    const period = req.query.month ? `-${String(req.query.month)}` : "";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="legacy-${req.params.code}${period}.csv"`,
    );
    res.send(csv);
  }),
);
