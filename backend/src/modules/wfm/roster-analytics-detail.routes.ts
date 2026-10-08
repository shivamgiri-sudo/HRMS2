/**
 * Roster Analytics drill-down endpoints (mounted by roster-analytics.routes.ts under /api/roster-analytics).
 *   GET /shrinkage/:branchId/detail?weekStart&kind&key&processId&lobId
 *   GET /employee/:employeeId/detail?period
 *   GET /cost/detail?period&component&branchId&processId&lobId
 *   GET /forecast/:branchId/detail?date&processId&lobId
 */
import { Router } from "express";
import { requireRole } from "../../middleware/requireRole.js";
import { readLobFilter } from "../../shared/lobFilter.js";
import {
  isValidDate,
  isValidPeriod,
  mondayOf,
  previousPeriod,
} from "./roster-analytics.calc.js";
import {
  COST_COMPONENTS,
  SHRINKAGE_DETAIL_KINDS,
  getCostDetail,
  getEmployeeAnalyticsDetail,
  getForecastDayDetail,
  getShrinkageDetail,
  type CostComponent,
  type ShrinkageDetailKind,
} from "./roster-analytics-detail.service.js";

const ROLES = ["super_admin", "admin", "hr", "wfm", "branch_head", "operations_manager", "ceo", "coo"];
import { branchParamGuard, employeeParamGuard } from "./branch-scope.js";
const router = Router();
router.param("branchId", branchParamGuard());
router.param("employeeId", employeeParamGuard());

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const fail = (res: any, err: unknown, what: string) => {
  const msg = err instanceof Error ? err.message : "Unknown error";
  console.error(`[roster-analytics] ${what} error:`, msg);
  res.status(500).json({ error: `Failed to get ${what}: ${msg}` });
};

router.get(
  "/shrinkage/:branchId/detail",
  requireRole(...ROLES),
  async (req, res) => {
    try {
      const lob = readLobFilter(req, res);
      if (!lob) return;
      const kind = str(req.query.kind) as ShrinkageDetailKind | undefined;
      if (!kind || !SHRINKAGE_DETAIL_KINDS.includes(kind))
        return res
          .status(400)
          .json({
            error: `kind must be one of ${SHRINKAGE_DETAIL_KINDS.join(", ")}`,
          });
      const weekStart = str(req.query.weekStart) ?? mondayOf();
      if (!isValidDate(weekStart))
        return res.status(400).json({ error: "weekStart must be YYYY-MM-DD" });
      const key = str(req.query.key);
      if ((kind === "day" || kind === "manager" || kind === "process") && !key)
        return res.status(400).json({ error: "key is required for this kind" });
      if (kind === "day" && key && !isValidDate(key))
        return res
          .status(400)
          .json({ error: "key must be YYYY-MM-DD for kind=day" });
      res.json(
        await getShrinkageDetail(
          req.params.branchId,
          weekStart,
          kind,
          key,
          lob,
          str(req.query.processId),
        ),
      );
    } catch (err) {
      fail(res, err, "shrinkage detail");
    }
  },
);

router.get(
  "/employee/:employeeId/detail",
  requireRole(...ROLES),
  async (req, res) => {
    try {
      const period = str(req.query.period) ?? previousPeriod();
      if (!isValidPeriod(period))
        return res.status(400).json({ error: "period must be YYYY-MM" });
      const data = await getEmployeeAnalyticsDetail(
        req.params.employeeId,
        period,
      );
      if (!data) return res.status(404).json({ error: "Employee not found" });
      res.json(data);
    } catch (err) {
      fail(res, err, "employee analytics detail");
    }
  },
);

router.get("/cost/detail", requireRole(...ROLES), async (req, res) => {
  try {
    const lob = readLobFilter(req, res);
    if (!lob) return;
    const period = str(req.query.period) ?? previousPeriod();
    if (!isValidPeriod(period))
      return res.status(400).json({ error: "period must be YYYY-MM" });
    const component = (str(req.query.component) ?? "total") as CostComponent;
    if (!COST_COMPONENTS.includes(component))
      return res
        .status(400)
        .json({
          error: `component must be one of ${COST_COMPONENTS.join(", ")}`,
        });
    res.json(
      await getCostDetail(
        period,
        component,
        str(req.query.branchId),
        str(req.query.processId),
        lob,
      ),
    );
  } catch (err) {
    fail(res, err, "cost detail");
  }
});

router.get(
  "/forecast/:branchId/detail",
  requireRole(...ROLES),
  async (req, res) => {
    try {
      const lob = readLobFilter(req, res);
      if (!lob) return;
      const date = str(req.query.date);
      if (!date || !isValidDate(date))
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      res.json(
        await getForecastDayDetail(
          req.params.branchId,
          date,
          lob,
          str(req.query.processId),
        ),
      );
    } catch (err) {
      fail(res, err, "forecast detail");
    }
  },
);

export { router as rosterAnalyticsDetailRouter };
