import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireQueryScope } from "../../middleware/scopeMiddleware.js";
import { lobWhere, readLobFilter, type LobFilter } from "../../shared/lobFilter.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { consoleScopeGuard, branchParamGuard, employeeParamGuard } from "./console-scope.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  getEmployeeWfmCompliance,
  getBranchWfmCompliance,
} from "./wfm-compliance-analytics.service.js";
import { analyticsCache } from "../../shared/analyticsCache.js";
import { RULE_IDS, isValidMonth } from "./wfm-compliance.calc.js";
import {
  ATTENDANCE_EXCEPTION_IDS, getAttendanceExceptions, getRosterViolations, getSummary, getTrend, resolveMonth, type ScopeFilter,
} from "./wfm-compliance-console.service.js";
import { getBranchDetail, getEmployeeDetail, getRuleDetail, isRuleId } from "./wfm-compliance-detail.service.js";

const router = Router();

/**
 * Optional branch / process / LOB narrowing on the employee alias `e`, in that fixed order
 * (params match the placeholders). Replaces the copy-pasted `branchId && processId ? [...] : ...`
 * param arrays. Returns sql '' when nothing is selected.
 */
export function buildEmployeeScope(f: { branchId?: string; processId?: string; lob?: LobFilter }): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  if (f.branchId) { parts.push('AND e.branch_id = ?'); params.push(f.branchId); }
  if (f.processId) { parts.push('AND e.process_id = ?'); params.push(f.processId); }
  const lobSql = f.lob ? lobWhere(f.lob) : { sql: '', params: [] as string[] };
  if (lobSql.sql) { parts.push(lobSql.sql); params.push(...lobSql.params); }
  return { sql: parts.join(' '), params };
}

router.use(requireAuth);
// Branch / process scoping for the whole console (see console-scope.ts): validates the branchId / processId the
// caller named, injects their single branch when they named none, and checks :branchId / :employeeId path params.
router.use(consoleScopeGuard());
router.param("branchId", branchParamGuard());
router.param("employeeId", employeeParamGuard());

/**
 * Middleware to verify employee scope access for compliance queries.
 * branch_head/manager/operations_manager can only query employees in their assigned scope.
 */
async function verifyEmployeeScope(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const employeeId = req.query.employeeId as string;
    if (!employeeId) return next();

    // Get employee's branch/process to verify scope
    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    const emp = empRows[0] as { branch_id?: string; process_id?: string } | undefined;
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    // Verify caller has access to this employee's branch/process
    const hasAccess = await hasScopedAccess(
      userId,
      ["wfm", "manager", "branch_head", "operations_manager"],
      { branchId: emp.branch_id ?? null, processId: emp.process_id ?? null },
      { allowAdminBypass: true }
    );

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: employee is outside your assigned branch/process scope",
      });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/wfm-compliance/employee
 * Query params: employeeId (required), period (YYYY-MM, optional)
 * Roles: hr | wfm | admin | super_admin | manager | branch_head | operations_manager
 * Scope: branch_head/manager/operations_manager can only query employees in their assigned scope
 */
router.get(
  "/employee",
  requireRole("hr", "wfm", "admin", "super_admin", "manager", "branch_head", "operations_manager"),
  verifyEmployeeScope,
  (req, res, next) => {
    getEmployeeWfmCompliance(req, res).catch(next);
  }
);

/**
 * GET /api/wfm-compliance/branch
 * Query params: branchId (required), period (YYYY-MM, optional), processId (optional)
 * Roles: hr | wfm | admin | super_admin | manager | branch_head | operations_manager
 * Scope: branch_head/manager/operations_manager can only query branches in their assigned scope
 */
router.get(
  "/branch",
  requireRole("hr", "wfm", "admin", "super_admin", "manager", "branch_head", "operations_manager"),
  requireQueryScope(
    ["wfm", "manager", "branch_head", "operations_manager"],
    ["admin", "hr", "super_admin", "ceo"]
  ),
  (req, res, next) => {
    getBranchWfmCompliance(req, res).catch(next);
  }
);

// ── Roster Command Center "Compliance" tab ────────────────────────────────────
// summary / violations / trend / detail all read ONE shared computation
// (wfm-compliance-console.service.ts) so their numbers cannot disagree.

const REPORT_ROLES = ["hr", "wfm", "admin", "super_admin", "operations_manager", "ceo"] as const;

function readScope(req: Request, res: Response): ScopeFilter | null {
  const lob = readLobFilter(req, res);
  if (!lob) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() && v !== "__all__" ? v.trim() : undefined);
  return { branchId: str(req.query.branchId), processId: str(req.query.processId), lob };
}

function readMonth(req: Request, res: Response): string | null {
  const raw = req.query.period ?? req.query.month;
  if (raw !== undefined && !isValidMonth(raw)) {
    res.status(400).json({ error: "period must be YYYY-MM" });
    return null;
  }
  return resolveMonth(raw);
}

const wantsRefresh = (req: Request) => req.query.refresh === "1" || req.query.refresh === "true";
const intParam = (v: unknown, dflt: number, min: number, max: number) => {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

router.get("/summary", requireRole(...REPORT_ROLES), analyticsCache("wfm-compliance-summary"), async (req, res, next) => {
  try {
    const scope = readScope(req, res); if (!scope) return;
    const month = readMonth(req, res); if (!month) return;
    res.json(await getSummary(scope, month, wantsRefresh(req)));
  } catch (err) { next(err); }
});

router.get("/violations", requireRole(...REPORT_ROLES), analyticsCache("wfm-compliance-violations"), async (req, res, next) => {
  try {
    const scope = readScope(req, res); if (!scope) return;
    const month = readMonth(req, res); if (!month) return;
    const kind = req.query.kind === "attendance" ? "attendance" : "roster";
    const ruleId = typeof req.query.ruleId === "string" && req.query.ruleId ? req.query.ruleId : undefined;
    const valid = kind === "roster" ? (RULE_IDS as string[]) : ATTENDANCE_EXCEPTION_IDS;
    if (ruleId && !valid.includes(ruleId)) return void res.status(400).json({ error: `ruleId must be one of ${valid.join(", ")}` });
    const severity = typeof req.query.severity === "string" && ["high", "medium", "low"].includes(req.query.severity) ? req.query.severity : undefined;
    const feed = {
      ruleId, severity, q: typeof req.query.q === "string" ? req.query.q : undefined,
      page: intParam(req.query.page, 1, 1, 100000), pageSize: intParam(req.query.pageSize ?? req.query.limit, 50, 1, 200),
    };
    res.json(kind === "roster" ? await getRosterViolations(scope, month, feed, wantsRefresh(req)) : await getAttendanceExceptions(scope, month, feed));
  } catch (err) { next(err); }
});

router.get("/trend", requireRole(...REPORT_ROLES), analyticsCache("wfm-compliance-trend"), async (req, res, next) => {
  try {
    const scope = readScope(req, res); if (!scope) return;
    const month = readMonth(req, res); if (!month) return;
    res.json(await getTrend(scope, month, wantsRefresh(req)));
  } catch (err) { next(err); }
});

// Drill-down endpoints (Drill-Down Mandate): dedicated GETs, never the list payload.
router.get("/detail/employee/:employeeId", requireRole(...REPORT_ROLES), async (req, res, next) => {
  try {
    const month = readMonth(req, res); if (!month) return;
    const detail = await getEmployeeDetail(String(req.params.employeeId), month);
    if (!detail) return void res.status(404).json({ error: "Employee not found" });
    res.json(detail);
  } catch (err) { next(err); }
});

router.get("/detail/rule/:ruleId", requireRole(...REPORT_ROLES), async (req, res, next) => {
  try {
    if (!isRuleId(req.params.ruleId)) return void res.status(404).json({ error: "Unknown rule" });
    const scope = readScope(req, res); if (!scope) return;
    const month = readMonth(req, res); if (!month) return;
    res.json(await getRuleDetail(req.params.ruleId, scope, month));
  } catch (err) { next(err); }
});

router.get("/detail/branch/:branchId", requireRole(...REPORT_ROLES), async (req, res, next) => {
  try {
    const scope = readScope(req, res); if (!scope) return;
    const month = readMonth(req, res); if (!month) return;
    const detail = await getBranchDetail(String(req.params.branchId), scope, month);
    if (!detail) return void res.status(404).json({ error: "No roster data for this branch in the period" });
    res.json(detail);
  } catch (err) { next(err); }
});

export const wfmComplianceAnalyticsRouter = router;
