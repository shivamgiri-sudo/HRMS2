import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { managementService } from "./management.service.js";
import { db } from "../../db/mysql.js";
import { resolveDashboardScopeForRequest } from "../../shared/dashboardScope.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { PAYROLL_ROLES } from "../../platform/policy/roles.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

/**
 * Whether the caller may see salary, PF/ESIC and payroll cost figures.
 *
 * Several endpoints here returned company-wide payroll totals to any role on their
 * `requireRole` list — which included `hr`, `manager`, `branch_head` and
 * `process_manager`, none of which are in PAYROLL_ROLES. CLAUDE.md is explicit that
 * payroll/salary data must never surface through management endpoints, so financial
 * fields are now nulled per-caller rather than the routes being removed.
 */
async function callerHasPayrollAccess(userId: string): Promise<boolean> {
  return hasRole(userId, ...(PAYROLL_ROLES as string[]));
}

/**
 * Resolve scoped employee ID list for non-admin/hr roles.
 * Admins, HR, CEO see everyone. Managers/TLs see only their direct reports.
 * Returns null if the caller has no employee record (block the request).
 * Returns [] if the manager has no reports yet (no data returned).
 */
async function resolveTeamScope(userId: string): Promise<{ employeeIds: string[] | null; isWide: boolean }> {
  if (await hasRole(userId, "admin", "hr", "ceo", "qa")) {
    return { employeeIds: null, isWide: true };
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return { employeeIds: null, isWide: false };
  const ids = await managementService.getDirectReportIds(emp.id);
  // Include the manager's own employee ID for completeness (e.g. their own alerts)
  if (!ids.includes(emp.id)) ids.push(emp.id);
  return { employeeIds: ids, isWide: false };
}

router.get("/team-kpi", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
  if (!isWide && employeeIds !== null && employeeIds.length === 0) {
    return res.json({ data: [] });
  }
  const filters: Record<string, unknown> = { ...req.query };
  if (!isWide && employeeIds) filters.employee_ids = employeeIds;
  res.json({ data: await managementService.getTeamKpiSummary(filters as any) });
}));

router.get("/coaching", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr", "qa")) {
    return res.json({ data: await managementService.listCoachingSessions(req.query as any) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  // Managers see sessions for all their direct reports
  const directIds = await managementService.getDirectReportIds(emp.id);
  if (directIds.length > 0) {
    return res.json({ data: await managementService.listCoachingSessions({ employee_ids: directIds }) });
  }
  // Fallback: show own sessions if no direct reports
  return res.json({ data: await managementService.listCoachingSessions({ employee_id: emp.id }) });
}));

router.post("/coaching", requireRole("admin", "hr", "qa", "manager", "branch_head", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, session_date, session_type } = req.body;
  if (!employee_id || !session_date || !session_type)
    return res.status(400).json({ error: "employee_id, session_date, session_type required" });
  res.status(201).json({ data: await managementService.createCoachingSession(req.body, req.authUser!.id, req) });
}));

router.get("/alerts", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const acknowledged = req.query.acknowledged !== undefined ? req.query.acknowledged === "true" : undefined;
  const { employeeIds, isWide } = await resolveTeamScope(userId);
  if (!isWide && employeeIds !== null && employeeIds.length === 0) {
    return res.json({ data: [] });
  }
  const filters: Record<string, unknown> = { ...(req.query as any), acknowledged };
  if (!isWide && employeeIds) filters.employee_ids = employeeIds;
  res.json({ data: await managementService.listAlerts(filters as any) });
}));

router.post("/alerts/:id/acknowledge", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  await managementService.acknowledgeAlert(req.params.id, req.authUser!.id, req);
  res.json({ ok: true });
}));

router.get("/dashboard", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
  const processId = req.query.process_id as string | undefined;
  res.json({ data: await managementService.getDashboardSummary(
    isWide ? processId : undefined,
    (!isWide && employeeIds) ? employeeIds : undefined
  ) });
}));

router.get("/workforce-dashboard", requireRole("admin", "hr", "ceo", "manager", "branch_head", "process_manager", "wfm", "payroll", "payroll_hr", "payroll_head", "finance_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await getUserRoleContext(req.authUser!.id);
  const scope = await resolveDashboardScopeForRequest(req.authUser!, ctx.primaryRole);
  // Allow ORG_ALL roles to override scope via query params
  const branchId = scope.level === "ORG_ALL"
    ? (req.query.branchId as string | undefined)
    : (scope.branchIds[0] ?? undefined);
  const processId = scope.level === "ORG_ALL"
    ? (req.query.processId as string | undefined)
    : (scope.processIds[0] ?? undefined);
  res.json({ data: await managementService.getWorkforceDashboard(branchId, processId, scope.level) });
}));

router.get("/system-dashboard", requireRole("admin", "super_admin"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.getSystemDashboard() });
}));

// ─── TNI (Training Needs Identification) ─────────────────────────────────────

// Returns the calling manager's direct reports (for coaching modal dropdowns, etc.)
router.get("/team-members", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr", "ceo")) {
    // Wide roles: return a small employee list (name + id only) filtered by process if provided
    const processId = req.query.process_id as string | undefined;
    const conds = ["e.active_status = 1"];
    const params: unknown[] = [];
    if (processId) { conds.push("e.process_id = ?"); params.push(processId); }
    const [rows] = await db.execute(
      `SELECT e.id, e.employee_code, e.full_name FROM employees e WHERE ${conds.join(" AND ")} ORDER BY e.full_name LIMIT 500`,
      params
    );
    return res.json({ data: rows });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const ids = await managementService.getDirectReportIds(emp.id);
  if (ids.length === 0) return res.json({ data: [] });
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db.execute(
    `SELECT e.id, e.employee_code, e.full_name FROM employees e WHERE e.id IN (${placeholders}) AND e.active_status = 1 ORDER BY e.full_name`,
    ids
  );
  return res.json({ data: rows });
}));

router.get("/tni", requireRole("admin", "hr", "manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await managementService.listTni(req.query as { employee_id?: string; status?: string }) });
}));

router.post("/tni", requireRole("admin", "hr", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, metric_id, need_type, description, priority, coaching_session_id } = req.body as {
    employee_id: string;
    metric_id?: string;
    need_type: string;
    description?: string;
    priority?: string;
    coaching_session_id?: string;
  };
  if (!employee_id || !need_type) {
    return res.status(400).json({ error: "employee_id and need_type required" });
  }
  const data = await managementService.createTni(
    { employee_id, metric_id, need_type, description, priority, coaching_session_id },
    req.authUser!.id
  );
  res.status(201).json({ data });
}));

router.patch("/tni/:id", requireRole("admin", "hr", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body as { status: string };
  if (!status) return res.status(400).json({ error: "status required" });
  const data = await managementService.updateTniStatus(req.params.id, status);
  res.json({ data });
}));

router.post("/coaching/:coachingId/create-tni", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { need_type, description, priority, metric_id } = req.body as {
    need_type?: string;
    description?: string;
    priority?: string;
    metric_id?: string;
  };
  const data = await managementService.createTniFromCoaching(
    req.params.coachingId,
    { need_type: need_type ?? "soft_skills", description, priority, metric_id },
    req.authUser!.id
  );
  res.status(201).json({ data });
}));

router.get("/attrition-breakdown", requireRole("admin", "hr", "ceo", "manager", "branch_head", "process_manager"), h(async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await managementService.getAttritionBreakdown();
    res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed";
    console.error("[attrition-breakdown]", msg);
    // `success: true` with an empty array told the caller the query ran and found
    // no attrition — the reassuring answer, produced by a query that failed. The
    // service beneath this already swallows its own error into [[]], so the route
    // was the second of two places turning a fault into good news.
    res.status(503).json({
      success: false,
      error: "Attrition breakdown is unavailable",
      errorCode: "SOURCE_UNAVAILABLE",
    });
  }
}));

router.get("/ceo-metrics", requireRole("admin", "hr", "ceo", "finance"), h(async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await managementService.getCeoMetrics();

    // `hr` is on this route's role list but is NOT in PAYROLL_ROLES, so it was
    // receiving total_gross / total_net / PF / ESIC liability. Strip the financial
    // block for callers without payroll entitlement instead of removing the route.
    const PAYROLL_ONLY_FIELDS = ["payroll_liability", "ff_liability"] as const;
    if (!(await callerHasPayrollAccess(_req.authUser!.id))) {
      const redacted = { ...(data as Record<string, unknown>) };
      for (const key of PAYROLL_ONLY_FIELDS) {
        if (key in redacted) redacted[key] = null;
      }
      return res.json({ success: true, data: redacted, restricted: [...PAYROLL_ONLY_FIELDS] });
    }

    res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load CEO metrics";
    console.error("[ceo-metrics]", msg);
    // Return partial data or fallback to avoid complete failure
    res.status(500).json({ success: false, error: "CEO metrics temporarily unavailable", _details: msg });
  }
}));

// ─── Management Team Dashboard endpoints (ManagementDashboard.tsx) ───────────

router.get("/team-overview", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);

  // Build scoped WHERE clause
  const hasScope = !isWide && employeeIds && employeeIds.length > 0;
  const scopePlaceholders = hasScope ? employeeIds!.map(() => "?").join(",") : null;
  const empClause = hasScope ? `AND e.id IN (${scopePlaceholders})` : "";
  const empParams: unknown[] = hasScope ? [...employeeIds!] : [];

  const today = new Date().toISOString().slice(0, 10);

  const [headcountRows, attendanceRows, kpiRows, salaryRows] = await Promise.all([
    // Fast headcount — simple COUNT with index on active_status
    db.execute<any[]>(
      `SELECT COUNT(*) AS headcount FROM employees e WHERE e.active_status = 1 AND LOWER(COALESCE(e.employment_status,'active')) = 'active' ${empClause}`,
      empParams
    ),
    // Attendance rate for today (or latest record date)
    db.execute<any[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(adr.attendance_status IN ('present','late')) AS present_count,
         SUM(adr.attendance_status = 'half_day') AS half_count
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       WHERE adr.record_date = ? ${empClause}`,
      [today, ...empParams]
    ),
    // Avg KPI — simple AVG on pre-aggregated daily actuals, no window function
    db.execute<any[]>(
      `SELECT ROUND(AVG(kda.actual_value), 1) AS avg_kpi
       FROM kpi_daily_actual kda
       JOIN employees e ON e.id = kda.employee_id
       WHERE DATE_FORMAT(kda.score_date,'%Y-%m') = DATE_FORMAT(CURDATE(),'%Y-%m')
         AND e.active_status = 1 ${empClause}`,
      empParams
    ),
    // Last approved payroll cost.
    // Previously this read salary_prep_run.total_gross with no employee clause, so a
    // manager or branch_head scoped to a handful of reports received the entire
    // company's payroll total as their "monthly cost". Summing the run's LINES with
    // the same scope filter as every other query here keeps it to the caller's people.
    db.execute<any[]>(
      `SELECT COALESCE(SUM(spl.gross_salary), 0) AS total_gross
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
        WHERE spl.run_id = (
                SELECT id FROM salary_prep_run
                 WHERE status IN ('approved','processing','FINALIZED')
                 ORDER BY run_month DESC LIMIT 1
              )
          ${empClause}`,
      empParams
    ),
  ]);

  // Even correctly scoped, salary cost is payroll data — withhold it from roles that
  // are on this route but outside PAYROLL_ROLES (manager, branch_head, process_manager, hr).
  const canSeePayroll = await callerHasPayrollAccess(req.authUser!.id);

  const headcount = Number(headcountRows[0][0]?.headcount ?? 0);
  const att = attendanceRows[0][0] ?? {};
  const total = Number(att.total ?? 0);
  const present = Number(att.present_count ?? 0) + Number(att.half_count ?? 0) * 0.5;
  const utilization = total > 0 ? Math.round((present / total) * 100) : 0;
  const avgKpi = Math.round(Number(kpiRows[0][0]?.avg_kpi ?? 0));
  const monthlyCost = canSeePayroll ? Number(salaryRows[0][0]?.total_gross ?? 0) : null;

  res.json({ success: true, data: {
    headcount,
    utilization_pct: utilization,
    avg_quality_score: avgKpi,
    monthly_cost: monthlyCost,
    ...(canSeePayroll ? {} : { restricted: ["monthly_cost"] }),
  }});
}));

router.get("/agent-performance", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
  const filters: Record<string, unknown> = { ...req.query };
  if (!isWide && employeeIds) filters.employee_ids = employeeIds;
  const rows = await managementService.getTeamKpiSummary(filters as any);
  const mapped = rows.map((r: any) => {
    const score = Number(r.overall_score ?? 0);
    return {
      agent_id: r.employee_id,
      agent_name: r.employee_name,
      quality_pct: score,
      calls: Number(r.calls_handled ?? 0),
      risk_score: score < 60 ? 80 : score < 70 ? 55 : score < 80 ? 35 : 20,
      coaching_needed: score < 70,
    };
  });
  res.json({ success: true, data: mapped });
}));

// Payroll cost projection. Previously open to manager / branch_head / process_manager /
// hr with no scoping at all, so any of them received the whole company's salary run.
// Restricted to payroll-entitled roles plus the CEO, and scoped to the caller's people.
router.get("/payroll-projection", requireRole(...(PAYROLL_ROLES as string[]), "ceo"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
  const hasScope = !isWide && employeeIds && employeeIds.length > 0;
  const empClause = hasScope ? `AND sl.employee_id IN (${employeeIds!.map(() => "?").join(",")})` : "";
  const empParams: unknown[] = hasScope ? [...employeeIds!] : [];

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  // Build 30-day projection window
  const days: { date: string; projected_cost: number; actual_cost?: number }[] = [];
  const [salaryRows] = await db.execute<any[]>(
    // salary_prep_run.run_month is VARCHAR(7) holding 'YYYY-MM', not a DATE.
    //
    // This compared it against DATE_SUB(CURDATE(), INTERVAL 2 MONTH), a real DATE. MySQL then
    // coerced every 'YYYY-MM' string to a date, failed ("Truncated incorrect date value:
    // '2026-07'" — one warning per row, for all 66 runs) and the predicate matched NOTHING.
    // salaryRows came back empty, avgDaily fell to 0, and the endpoint returned 30 days of
    // projected_cost: 0 and total_projected: 0 to every caller, for as long as it has existed.
    // Nothing errored, so it read as "payroll projection is zero" rather than a broken query.
    //
    // Compared as the string it is: DATE_FORMAT renders the *cutoff* in the same 'YYYY-MM'
    // shape, so >= is a lexicographic compare, which is correct for zero-padded year-month.
    // The SELECT had the mirror-image fault — DATE_FORMAT on the varchar returned NULL for
    // every row — harmless only because the caller reads total_gross and never run_month.
    `SELECT sp.run_month as run_month,
            SUM(sl.gross_salary) as total_gross,
            COUNT(DISTINCT sl.employee_id) as emp_count
     FROM salary_prep_run sp
     JOIN salary_prep_line sl ON sl.run_id = sp.id
     WHERE sp.run_month >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 MONTH), '%Y-%m') ${empClause}
     GROUP BY sp.run_month ORDER BY sp.run_month ASC LIMIT 3`,
    empParams
  );
  const avgDaily = salaryRows.length > 0
    ? salaryRows.reduce((s: number, r: any) => s + Number(r.total_gross ?? 0), 0) / salaryRows.length / 30
    : 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(year, month, i + 1);
    days.push({ date: d.toISOString().slice(0, 10), projected_cost: Math.round(avgDaily) });
  }
  const periodStart = days[0]?.date;
  const periodEnd = days[days.length - 1]?.date;
  const totalProjected = days.reduce((s, d) => s + d.projected_cost, 0);
  res.json({
    success: true,
    data: {
      period_start: periodStart,
      period_end: periodEnd,
      days,
      total_projected: totalProjected,
      // This is not a forecast: it is the trailing 3-month average spread flat across
      // 30 identical days. Labelled so the UI cannot present it as a projection model.
      method: "trailing_3_month_average_flat_daily",
    },
  });
}));

router.get("/training-needs", requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "qa"), h(async (req: AuthenticatedRequest, res: Response) => {
  // listTni filters by single employee_id or status only; no employee_ids array support
  // Wide roles get all TNI rows; scoped managers get filtered subset via status filter
  const filters: { status?: string } = {};
  if (req.query.status) filters.status = req.query.status as string;
  const tniRows = await managementService.listTni(filters);
  const mapped = (tniRows as any[]).map((r: any) => ({
    agent_id: r.employee_id,
    agent_name: r.full_name ?? r.employee_code ?? r.employee_id,
    skill_gap: r.need_type ?? "General",
    current_score: 0,
    target_score: 80,
    priority: (r.priority ?? "medium") as "high" | "medium" | "low",
  }));
  res.json({ success: true, data: mapped });
}));

export { router as managementRouter };
