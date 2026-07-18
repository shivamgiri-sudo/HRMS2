import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { rosterSwapService, rosterConflictService, coverageService, attritionService } from "./wfm-ext.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const WFM_SCOPE_ROLES = ["wfm", "process_manager", "branch_head", "manager", "assistant_manager", "tl", "hr"];

router.use(requireAuth);

async function employeeScope(userId: string, aliases: { employee?: string } = {}) {
  const e = aliases.employee ?? "e";
  if (await hasRole(userId, "admin", "hr", "wfm", "ceo")) return { sql: "1=1", params: [] as unknown[] };
  return buildScopeWhereClause(
    userId,
    WFM_SCOPE_ROLES,
    {
      branchId: `${e}.branch_id`,
      processId: `${e}.process_id`,
      departmentId: `${e}.department_id`,
      managerEmployeeId: `${e}.reporting_manager_id`,
      employeeId: `${e}.id`,
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
}

async function computedCoverageSnapshot(input: any, userId: string) {
  const snapshotDate = String(input.snapshot_date ?? input.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw Object.assign(new Error("snapshot_date/date is required in YYYY-MM-DD format"), { statusCode: 400 });
  if (input.planned_headcount !== undefined) {
    return {
      snapshot_date: snapshotDate,
      process_id: input.process_id ?? null,
      branch_id: input.branch_id ?? null,
      planned_headcount: Number(input.planned_headcount ?? 0),
      actual_headcount: Number(input.actual_headcount ?? 0),
      absent_count: Number(input.absent_count ?? 0),
      leave_count: Number(input.leave_count ?? 0),
    };
  }

  const scope = await employeeScope(userId);
  const conds = ["a.roster_date = ?", `(${scope.sql})`];
  const params: unknown[] = [snapshotDate, ...scope.params];
  if (input.process_id) { conds.push("e.process_id = ?"); params.push(String(input.process_id)); }
  if (input.branch_id) { conds.push("e.branch_id = ?"); params.push(String(input.branch_id)); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT a.employee_id) AS planned_headcount,
            COUNT(DISTINCT CASE WHEN ad.attendance_status IN ('present','half_day') THEN ad.employee_id END) AS actual_headcount,
            COUNT(DISTINCT CASE WHEN ad.attendance_status = 'absent' THEN ad.employee_id END) AS absent_count,
            COUNT(DISTINCT CASE WHEN ad.attendance_status = 'leave_approved' THEN ad.employee_id END) AS leave_count
       FROM wfm_roster_assignment a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN attendance_daily_record ad ON ad.employee_id = a.employee_id AND ad.record_date = a.roster_date
      WHERE ${conds.join(" AND ")}`,
    params,
  );
  const row = rows[0] ?? {};
  return {
    snapshot_date: snapshotDate,
    process_id: input.process_id ?? null,
    branch_id: input.branch_id ?? null,
    planned_headcount: Number(row.planned_headcount ?? 0),
    actual_headcount: Number(row.actual_headcount ?? 0),
    absent_count: Number(row.absent_count ?? 0),
    leave_count: Number(row.leave_count ?? 0),
  };
}

// ── Roster Swap ───────────────────────────────────────────────────────────────
router.get("/roster/swaps", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr", "wfm", "manager", "assistant_manager", "tl", "branch_head", "process_manager")) {
    const scope = await employeeScope(userId);
    return res.json({ success: true, data: await rosterSwapService.list({ ...(req.query as any), ...scope }) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "Forbidden" });
  return res.json({ success: true, data: await rosterSwapService.list({ employee_id: emp.id, status: req.query.status as string | undefined }) });
}));

router.post("/roster/swaps", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const callerEmp = await getEmployeeForUser(userId);
  const privileged = await hasRole(userId, "admin", "hr", "wfm", "manager");
  const requester = privileged ? (req.body.requester_employee_id ?? req.body.requester_emp_id ?? callerEmp?.id) : callerEmp?.id;
  const target = req.body.swap_with_emp_id ?? req.body.target_employee_id;
  const swapDate = req.body.swap_date;
  if (!requester || !target || !swapDate) return res.status(400).json({ error: "requester/target employee and swap_date are required" });
  const data = await rosterSwapService.create({ requester_emp_id: requester, swap_with_emp_id: target, swap_date: swapDate, reason: req.body.reason });
  res.status(201).json({ success: true, data });
}));

router.post("/roster/swaps/:id/review", requireRole("admin", "hr", "wfm", "manager", "assistant_manager", "team_leader"), h(async (req: AuthenticatedRequest, res: Response) => {
  const status = String(req.body.status ?? req.body.action ?? "");
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ error: "status/action must be approved or rejected" });
  await rosterSwapService.review(req.params.id, status as "approved" | "rejected", req.authUser!.id, req);
  res.json({ success: true, ok: true });
}));

// ── Roster Conflicts ──────────────────────────────────────────────────────────
router.get("/roster/conflicts", requireRole("admin", "hr", "wfm", "manager", "assistant_manager", "team_leader", "branch_head", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await employeeScope(req.authUser!.id);
  const resolved = req.query.resolved !== undefined ? req.query.resolved === "true" : undefined;
  res.json({ success: true, data: await rosterConflictService.list({ ...(req.query as any), resolved, ...scope }) });
}));

router.post("/roster/conflicts/:id/resolve", requireRole("admin", "hr", "wfm", "manager", "assistant_manager", "team_leader"), h(async (req: AuthenticatedRequest, res: Response) => {
  await rosterConflictService.resolve(req.params.id, req.authUser!.id, req);
  res.json({ success: true, ok: true });
}));

// ── Coverage / Shrinkage Snapshots ────────────────────────────────────────────
router.get("/coverage", requireRole("admin", "hr", "wfm", "manager", "assistant_manager", "team_leader", "branch_head", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await employeeScope(req.authUser!.id);
  res.json(await coverageService.summarize({ ...(req.query as any), ...scope }));
}));

router.post("/coverage/snapshot", requireRole("admin", "hr", "wfm", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const snapshot = await computedCoverageSnapshot(req.body, req.authUser!.id);
  await coverageService.upsertSnapshot(snapshot, req.authUser!.id, req);
  res.json({ success: true, ok: true });
}));

// ── Attrition ─────────────────────────────────────────────────────────────────
router.get("/attrition/summary", requireRole("admin", "hr", "wfm", "manager", "branch_head", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const scope = await employeeScope(req.authUser!.id);
  res.json(await attritionService.getSummary({ ...(req.query as any), ...scope }));
}));

router.post("/attrition/record", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, exit_date } = req.body;
  if (!employee_id || !exit_date) return res.status(400).json({ error: "employee_id and exit_date required" });
  const id = await attritionService.recordExit({ ...req.body, recorded_by: req.authUser!.id }, req);
  res.status(201).json({ success: true, data: { id } });
}));

export { router as wfmExtRouter };
