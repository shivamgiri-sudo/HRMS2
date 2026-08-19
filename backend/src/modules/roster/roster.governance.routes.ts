import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasProcessScope, hasRole } from "../../shared/accessGuard.js";
import { rosterGovernanceService, type RosterCycle } from "./roster.governance.service.js";
import { rosterGenerationService } from "./roster-generation.service.js";
import { rtaSyncService } from "./rta-sync.service.js";
import { weekoffAllocationService } from "./weekoff-allocation.service.js";
import { weekOffPolicyConfigService } from "./week-off-policy-config.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const ROSTER_OWNERS = ["manager", "wfm"];
const SCOPED_MONITORS = ["manager", "wfm", "assistant_manager", "tl"];

// Dispute resolution legitimately happens after publish (a dispute is raised against an
// already-published/acknowledged assignment, which bulkUpsertAssignments's narrower
// EDITABLE_ASSIGNMENT_STATUSES — draft/submitted/reviewed only — would wrongly forbid).
// What resolve-dispute must NOT be able to touch is a cycle whose attendance is already
// locked or whose payroll has moved on: those three statuses are excluded here, matching
// the concern bulkUpsertAssignments's own status gate exists for, without blocking the
// normal published/acknowledged dispute flow this route is actually for.
const DISPUTE_LOCKED_STATUSES = new Set(["attendance_locked", "payroll_input_ready", "closed"]);

router.use(requireAuth);

async function canOwnRoster(req: AuthenticatedRequest, processId: string, branchId?: string | null): Promise<boolean> {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin")) return true;
  return hasProcessScope(userId, processId, branchId, ...ROSTER_OWNERS);
}

async function canMonitorRoster(req: AuthenticatedRequest, processId: string, branchId?: string | null): Promise<boolean> {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr")) return true;
  return hasProcessScope(userId, processId, branchId, ...SCOPED_MONITORS);
}

async function requireCycleOwner(req: AuthenticatedRequest, res: Response): Promise<RosterCycle | null> {
  const cycle = await rosterGovernanceService.getCycle(req.params.id);
  if (!(await canOwnRoster(req, cycle.process_id, cycle.branch_id))) {
    res.status(403).json({ success: false, message: "Forbidden: roster ownership is limited to mapped Process Manager/WFM scope" });
    return null;
  }
  return cycle;
}

async function requireCycleMonitor(req: AuthenticatedRequest, res: Response): Promise<RosterCycle | null> {
  const cycle = await rosterGovernanceService.getCycle(req.params.id);
  if (!(await canMonitorRoster(req, cycle.process_id, cycle.branch_id))) {
    res.status(403).json({ success: false, message: "Forbidden: roster visibility is limited to mapped scope" });
    return null;
  }
  return cycle;
}

// ── Shift Templates ───────────────────────────────────────────────────────────
// Shift definition is maintained by Admin/WFM; Process Managers use approved
// templates when planning their scoped weekly roster.
router.get("/shifts/templates", h(async (req: AuthenticatedRequest, res: Response) => {
  const processId = req.query.process_id as string | undefined;
  if (await hasRole(req.authUser!.id, "admin", "hr")) {
    return res.json({ data: await rosterGovernanceService.listShiftTemplates(req.query as any) });
  }
  if (!processId || !(await hasProcessScope(req.authUser!.id, processId, null, ...SCOPED_MONITORS))) {
    return res.status(403).json({ success: false, message: "Forbidden: process scope is required" });
  }
  return res.json({ data: await rosterGovernanceService.listShiftTemplates(req.query as any) });
}));

router.post("/shifts/templates", h(async (req: AuthenticatedRequest, res: Response) => {
  const { shift_code, shift_name, start_time, end_time, effective_from, process_id, branch_id } = req.body;
  if (!shift_code || !shift_name || !start_time || !end_time || !effective_from || !process_id) {
    return res.status(400).json({ error: "shift_code, shift_name, start_time, end_time, effective_from and process_id are required" });
  }
  const admin = await hasRole(req.authUser!.id, "admin");
  const scopedWfm = await hasProcessScope(req.authUser!.id, process_id, branch_id ?? null, "wfm");
  if (!admin && !scopedWfm) {
    return res.status(403).json({ success: false, message: "Forbidden: shift templates require Admin or mapped WFM scope" });
  }
  const data = await rosterGovernanceService.createShiftTemplate(req.body, req.authUser!.id, req);
  return res.status(201).json({ data });
}));

// ── Week-off Policy Default (tier 3-5 of Part A.1's hierarchy) ────────────────
// Round 2 (2026-08-13), P1 gap: week_off_policy_default was deliberately
// seeded with zero rows (never defaults to Sunday) and nothing could ever
// populate it except direct SQL. Admin/WFM config, same posture as shift
// templates directly above.
router.get("/week-off-policy-default", h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await weekOffPolicyConfigService.list({
    scope_type: req.query.scope_type as string | undefined,
    active_status: req.query.active_status as string | undefined,
  });
  return res.json({ success: true, data });
}));

router.get("/week-off-policy-default/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await weekOffPolicyConfigService.get(req.params.id);
  return res.json({ success: true, data });
}));

router.post("/week-off-policy-default", h(async (req: AuthenticatedRequest, res: Response) => {
  const { scope_type, process_id, branch_id } = req.body;
  const admin = await hasRole(req.authUser!.id, "admin");
  if (!admin) {
    const scopedWfm = scope_type === "process"
      ? await hasProcessScope(req.authUser!.id, process_id, branch_id ?? null, "wfm")
      : await hasRole(req.authUser!.id, "wfm");
    if (!scopedWfm) {
      return res.status(403).json({ success: false, message: "Forbidden: week-off policy defaults require Admin, or mapped WFM scope for a process-level policy" });
    }
  }
  const data = await weekOffPolicyConfigService.create(req.body, req.authUser!.id, req);
  return res.status(201).json({ success: true, data });
}));

router.patch("/week-off-policy-default/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await hasRole(req.authUser!.id, "admin", "wfm"))) {
    return res.status(403).json({ success: false, message: "Forbidden: Admin or WFM only" });
  }
  const data = await weekOffPolicyConfigService.update(req.params.id, req.body, req.authUser!.id, req);
  return res.json({ success: true, data });
}));

router.delete("/week-off-policy-default/:id", h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await hasRole(req.authUser!.id, "admin", "wfm"))) {
    return res.status(403).json({ success: false, message: "Forbidden: Admin or WFM only" });
  }
  await weekOffPolicyConfigService.deactivate(req.params.id, req.authUser!.id, req);
  return res.json({ success: true, message: "Week-off policy default deactivated" });
}));

// ── Roster Cycles ─────────────────────────────────────────────────────────────

// DEAD CODE — unreachable in production. rosterSelfSecureRouter (roster.self.secure.routes.ts)
// defines the identical path "/my-cycles" and is mounted at the same "/api/roster-gov" prefix
// FIRST (app.ts:471, this router mounts at app.ts:473) — Express resolves an exact-path
// collision by registration order, so that router's handler always wins and this one never
// runs. Confirmed during a 2026-08-06 route audit (the same class of bug fixed for
// /api/wfm/attendance/daily that session). NOT fixed by reordering the mounts: unlike that
// case, this handler is a real behavioral regression waiting to happen if it ever did start
// executing — it filters by process_id only, with no branch_id scoping at all, so an employee
// whose process spans multiple branches would see every branch's roster cycles, not just
// their own (rosterSelfSecureRouter's version explicitly scopes on both). Left in place,
// clearly marked, rather than deleted or silently "fixed" — edit rosterSelfSecureRouter's
// "/my-cycles" instead if this behavior needs to change; editing this one does nothing.
// GET /my-cycles — employee-scoped: returns cycles for the employee's own process only
router.get("/my-cycles", h(async (req: AuthenticatedRequest, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT process_id FROM employees WHERE id = ? LIMIT 1',
    [emp.id]
  );
  const processId = (rows as RowDataPacket[])[0]?.process_id as string | undefined;
  if (!processId) return res.json({ data: [] });

  const statusFilter = req.query.status as string | undefined;
  const queryParams: Record<string, unknown> = { process_id: processId };
  if (statusFilter) queryParams.status = statusFilter;
  const data = await rosterGovernanceService.listCycles(queryParams as any);
  return res.json({ data });
}));

router.get("/cycles", h(async (req: AuthenticatedRequest, res: Response) => {
  const processId = req.query.process_id as string | undefined;
  if (await hasRole(req.authUser!.id, "admin", "hr")) {
    return res.json({ data: await rosterGovernanceService.listCycles(req.query as any) });
  }
  if (!processId || !(await hasProcessScope(req.authUser!.id, processId, (req.query.branch_id as string | undefined) ?? null, ...SCOPED_MONITORS))) {
    return res.status(403).json({ success: false, message: "Forbidden: mapped process scope is required" });
  }
  return res.json({ data: await rosterGovernanceService.listCycles(req.query as any) });
}));

// Process Manager and WFM both own weekly roster planning in their mapped scope.
router.post("/cycles", h(async (req: AuthenticatedRequest, res: Response) => {
  const { process_id, branch_id, week_start_date, week_end_date } = req.body;
  if (!process_id || !week_start_date || !week_end_date) {
    return res.status(400).json({ error: "process_id, week_start_date, week_end_date are required" });
  }
  if (!(await canOwnRoster(req, process_id, branch_id ?? null))) {
    return res.status(403).json({ success: false, message: "Forbidden: only mapped Process Manager/WFM may create roster cycles" });
  }
  const data = await rosterGovernanceService.createCycle(req.body, req.authUser!.id, req);
  return res.status(201).json({ data });
}));

// Draft-to-publish and closing status ownership remains with mapped Process
// Manager/WFM (or Admin override), not TL/Assistant Manager.
router.post("/cycles/:id/status", h(async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "status is required" });
  if (!(await requireCycleOwner(req, res))) return;
  const data = await rosterGovernanceService.advanceCycleStatus(req.params.id, status, req.authUser!.id, req);
  return res.json({ data });
}));

// ── Daily Assignments ─────────────────────────────────────────────────────────
router.get("/cycles/:id/assignments", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (await hasRole(userId, "admin", "hr")) {
    return res.json({ data: await rosterGovernanceService.getAssignments(req.params.id) });
  }
  const cycle = await rosterGovernanceService.getCycle(req.params.id);
  if (await hasProcessScope(userId, cycle.process_id, cycle.branch_id, ...SCOPED_MONITORS)) {
    return res.json({ data: await rosterGovernanceService.getAssignments(req.params.id) });
  }
  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await rosterGovernanceService.getAssignments(req.params.id, emp.id);
  return res.json({ data });
}));

router.post("/cycles/:id/assignments/bulk", h(async (req: AuthenticatedRequest, res: Response) => {
  const { assignments } = req.body;
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: "assignments array is required and must not be empty" });
  }
  if (!(await requireCycleOwner(req, res))) return;
  const data = await rosterGovernanceService.bulkUpsertAssignments(req.params.id, assignments, req.authUser!.id, req);
  return res.json({ data });
}));

// ── Employee Self-Acknowledgement ─────────────────────────────────────────────
router.post("/cycles/:id/acknowledge", h(async (req: AuthenticatedRequest, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await rosterGovernanceService.acknowledgeRoster(req.params.id, emp.id, req.authUser!.id, req);
  return res.json({ data });
}));

// DEAD CODE — unreachable in production, same class of collision as "/my-cycles" above:
// rosterSelfSecureRouter defines the identical "/my-roster/:cycleId" and is mounted first
// (app.ts:471 vs app.ts:473), so its handler always wins. Unlike "/my-cycles", the two
// implementations here are functionally close (both scope to the caller's own employee_id),
// so this specific one is lower-risk dead code — but it's still never invoked. Edit
// rosterSelfSecureRouter's "/my-roster/:cycleId" instead if this behavior needs to change.
// Get employee's own roster assignments for a cycle
router.get("/my-roster/:cycleId", h(async (req: AuthenticatedRequest, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await rosterGovernanceService.getAssignments(req.params.cycleId, emp.id);
  return res.json({ success: true, data });
}));

// ── Amendments ────────────────────────────────────────────────────────────────
// List all amendments (change-log entries) for a published/active cycle
router.get("/cycles/:cycleId/amendments", h(async (req: AuthenticatedRequest, res: Response) => {
  const cycle = await rosterGovernanceService.getCycle(req.params.cycleId);
  if (!(await canMonitorRoster(req, cycle.process_id, cycle.branch_id))) {
    return res.status(403).json({ success: false, message: "Forbidden: mapped roster scope is required" });
  }
  const amendments = await rosterGovernanceService.listChangeLogs(req.params.cycleId);
  return res.json({ amendments });
}));

// Create a post-publish amendment — requires roster ownership scope
router.post("/cycles/:cycleId/amendments", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId, date, newShiftId, newAssignmentType, reason } = req.body;
  if (!employeeId || !date || !newAssignmentType || !reason) {
    return res.status(400).json({ error: "employeeId, date, newAssignmentType, reason are required" });
  }
  const cycle = await rosterGovernanceService.getCycle(req.params.cycleId);
  if (!(await canOwnRoster(req, cycle.process_id, cycle.branch_id))) {
    return res.status(403).json({ success: false, message: "Forbidden: only mapped Process Manager/WFM may create amendments" });
  }
  const amendment = await rosterGovernanceService.createAmendment(
    req.params.cycleId,
    { employeeId, date, newShiftId, newAssignmentType, reason },
    req.authUser!.id,
    req
  );
  return res.status(201).json({ amendment });
}));

// ── Change Log ────────────────────────────────────────────────────────────────
router.get("/cycles/:id/changes", h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireCycleMonitor(req, res))) return;
  const data = await rosterGovernanceService.listChangeLogs(req.params.id, req.query.employee_id as string | undefined);
  return res.json({ data });
}));

// Only mapped roster owners can record approved roster-truth changes after publish.
// TL/Assistant Manager use coverage actions below to raise/close scoped exceptions.
router.post("/cycles/:id/changes", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, change_type, reason, change_date } = req.body;
  if (!employee_id || !change_type || !reason || !change_date) {
    return res.status(400).json({ error: "employee_id, change_type, reason, change_date are required" });
  }
  if (!(await requireCycleOwner(req, res))) return;
  const data = await rosterGovernanceService.logRosterChange(req.params.id, req.body, req.authUser!.id, req);
  return res.status(201).json({ data });
}));

// ── Coverage Actions ──────────────────────────────────────────────────────────
// Mapped TL/AM may monitor, raise and close accountability/actions without
// rewriting the published roster truth.
router.post("/coverage-actions", h(async (req: AuthenticatedRequest, res: Response) => {
  const { cycle_id, action_date } = req.body;
  if (!cycle_id || !action_date) {
    return res.status(400).json({ error: "cycle_id and action_date are required" });
  }
  const cycle = await rosterGovernanceService.getCycle(cycle_id);
  if (!(await canMonitorRoster(req, cycle.process_id, cycle.branch_id))) {
    return res.status(403).json({ success: false, message: "Forbidden: mapped roster scope is required" });
  }
  const data = await rosterGovernanceService.createCoverageAction({ ...req.body, process_id: cycle.process_id }, req.authUser!.id, req);
  return res.status(201).json({ data });
}));

router.post("/coverage-actions/:id/resolve", h(async (req: AuthenticatedRequest, res: Response) => {
  const action = await rosterGovernanceService.getCoverageAction(req.params.id);
  const cycle = await rosterGovernanceService.getCycle(action.cycle_id);
  if (!(await canMonitorRoster(req, cycle.process_id, cycle.branch_id))) {
    return res.status(403).json({ success: false, message: "Forbidden: mapped roster scope is required" });
  }
  const data = await rosterGovernanceService.resolveCoverageAction(req.params.id, req.authUser!.id, req);
  return res.json({ data });
}));

// ── Portal Aggregate ──────────────────────────────────────────────────────────
// Internal publishing read: actual external client delivery continues through
// the Client Portal published-data/auth boundary, never employee-level rows.
router.get("/portal-aggregate", h(async (req: AuthenticatedRequest, res: Response) => {
  const { process_id, week_start_date, branch_id } = req.query as { process_id?: string; week_start_date?: string; branch_id?: string };
  if (!process_id || !week_start_date) {
    return res.status(400).json({ error: "process_id and week_start_date query params are required" });
  }
  const broad = await hasRole(req.authUser!.id, "admin", "hr");
  const scoped = await hasProcessScope(req.authUser!.id, process_id, branch_id ?? null, "wfm", "manager");
  if (!broad && !scoped) return res.status(403).json({ success: false, message: "Forbidden" });
  const data = await rosterGovernanceService.getPortalAggregate({ process_id, week_start_date });
  return res.json({ data });
}));

// ── Roster Auto-Generation ─────────────────────────────────────────────────────

// POST /cycles/:id/generate — trigger auto-roster engine for a cycle
router.post("/cycles/:id/generate", h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireCycleOwner(req, res))) return;
  const data = await rosterGenerationService.generateForCycle(req.params.id, req.authUser!.id, req);
  return res.status(201).json({ data });
}));

// GET /cycles/:id/generation-runs — list generation run history
router.get("/cycles/:id/generation-runs", h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireCycleMonitor(req, res))) return;
  const data = await rosterGenerationService.listGenerationRuns(req.params.id);
  return res.json({ data });
}));

// GET /runs/:runId/decision-audit — paginated per-employee decision trace
router.get("/runs/:runId/decision-audit", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  if (!(await hasRole(userId, "admin", "hr", "wfm", "manager"))) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const page = parseInt((req.query.page as string) || "1", 10);
  const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
  const data = await rosterGenerationService.getDecisionAudit(req.params.runId, page, limit);
  return res.json({ data });
}));

// ── Employee Acknowledgement & Dispute ─────────────────────────────────────────

// GET /cycles/:id/assignments/:employeeId/ack — get ack state for employee's week
router.get("/cycles/:id/assignments/:employeeId/ack", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  const isOwn = emp?.id === req.params.employeeId;
  if (!isOwn) {
    const cycle = await rosterGovernanceService.getCycle(req.params.id);
    if (!(await canMonitorRoster(req, cycle.process_id, cycle.branch_id))) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT acknowledgement_status, acknowledged_at, dispute_reason, dispute_resolved_at, dispute_resolution
       FROM roster_daily_assignment
      WHERE cycle_id = ? AND employee_id = ?
      ORDER BY roster_date ASC`,
    [req.params.id, req.params.employeeId]
  );
  return res.json({ data: rows });
}));

// POST /assignments/:id/acknowledge — employee acknowledges a specific assignment
router.post("/assignments/:id/acknowledge", h(async (req: AuthenticatedRequest, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM roster_daily_assignment WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const assignment = rows[0];
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  if (assignment.employee_id !== emp.id) {
    return res.status(403).json({ success: false, message: "You can only acknowledge your own assignments" });
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  await db.execute(
    "UPDATE roster_daily_assignment SET acknowledgement_status = 'acknowledged', acknowledged_at = ? WHERE id = ?",
    [now, req.params.id]
  );
  return res.json({ success: true, message: "Acknowledged" });
}));

// POST /assignments/:id/dispute — employee raises a dispute
router.post("/assignments/:id/dispute", h(async (req: AuthenticatedRequest, res: Response) => {
  const { dispute_reason } = req.body;
  if (!dispute_reason?.trim()) {
    return res.status(400).json({ error: "dispute_reason is required" });
  }
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM roster_daily_assignment WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const assignment = rows[0];
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });
  if (assignment.employee_id !== emp.id) {
    return res.status(403).json({ success: false, message: "You can only dispute your own assignments" });
  }

  await db.execute(
    "UPDATE roster_daily_assignment SET acknowledgement_status = 'disputed', dispute_reason = ? WHERE id = ?",
    [dispute_reason.trim(), req.params.id]
  );
  return res.json({ success: true, message: "Dispute raised. Your manager has been notified." });
}));

// ── Manager Dispute Review Queue ────────────────────────────────────────────────

// GET /manager-review-queue — all disputed assignments across manager's processes
router.get("/manager-review-queue", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdmin = await hasRole(userId, "admin", "hr", "wfm");
  let processFilter = "";
  const params: unknown[] = [];

  if (!isAdmin) {
    // Load processes where this user has manager/wfm scope
    /*
     * There is no user_process_scope table - this raised ER_NO_SUCH_TABLE, so the manager review
     * queue returned 500 for every non-admin. The scope table is user_assignment_scope, which
     * roleResolver already treats as the scope authority, and its column is role_key, not role.
     *
     * process_manager is added to the list deliberately. Of the four roles named here, not one
     * holds a row with a process_id: manager 7 rows, wfm 7, branch_head 4, assistant_manager 0,
     * all with process_id NULL. process_manager holds 16 of its 22 with a process, and the
     * charter gives Process Manager publication authority for their mapped process, so it is the
     * role this queue was for. Renaming the table alone would have turned a 500 into a 403 for
     * everybody, which is harder to notice and no more usable.
     *
     * active_status is now checked, so a revoked assignment stops granting scope. Rows still
     * scope down to the user's own processes below, so nobody sees a process they are not mapped
     * to.
     */
    const [scopeRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT process_id FROM user_assignment_scope
        WHERE user_id = ?
          AND role_key IN ('process_manager','manager','wfm','assistant_manager','branch_head')
          AND active_status = 1
          AND process_id IS NOT NULL`,
      [userId]
    );
    if (!scopeRows.length) return res.status(403).json({ success: false, message: "Forbidden: no manager scope found" });
    const pids = scopeRows.map((r: any) => r.process_id);
    processFilter = `AND wrc.process_id IN (${pids.map(() => "?").join(",")})`;
    params.push(...pids);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rda.id, rda.cycle_id, rda.employee_id, rda.roster_date,
            rda.shift_template_id, rda.is_week_off, rda.acknowledgement_status,
            rda.dispute_reason, rda.dispute_resolved_at, rda.dispute_resolution,
            e.employee_code, e.first_name, e.last_name,
            wrc.process_id, wrc.week_start_date, wrc.week_end_date,
            wst.shift_name, wst.start_time, wst.end_time
       FROM roster_daily_assignment rda
       JOIN employees e ON e.id = rda.employee_id
       JOIN weekly_roster_cycle wrc ON wrc.id = rda.cycle_id
       LEFT JOIN wfm_shift_template wst ON wst.id = rda.shift_template_id
      WHERE rda.acknowledgement_status = 'disputed'
        AND rda.dispute_resolved_at IS NULL
        ${processFilter}
      ORDER BY rda.roster_date ASC`,
    params
  );
  return res.json({ data: rows });
}));

// POST /assignments/:id/resolve-dispute — manager resolves dispute
router.post("/assignments/:id/resolve-dispute", h(async (req: AuthenticatedRequest, res: Response) => {
  const { dispute_resolution, new_shift_template_id } = req.body;
  if (!dispute_resolution?.trim()) {
    return res.status(400).json({ error: "dispute_resolution is required" });
  }
  const userId = req.authUser!.id;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rda.*, wrc.process_id, wrc.branch_id, wrc.status AS cycle_status
       FROM roster_daily_assignment rda
       JOIN weekly_roster_cycle wrc ON wrc.id = rda.cycle_id
      WHERE rda.id = ? LIMIT 1`,
    [req.params.id]
  );
  const assignment = rows[0];
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });

  if (!(await canOwnRoster(req, assignment.process_id, assignment.branch_id))) {
    return res.status(403).json({ success: false, message: "Forbidden: roster ownership required to resolve disputes" });
  }

  // Every other assignment-mutating path in this file checks cycle status before
  // writing (see bulkUpsertAssignments's EDITABLE_ASSIGNMENT_STATUSES); this route
  // never did, so a shift could be silently changed on an assignment whose cycle was
  // already attendance-locked or payroll-closed.
  if (DISPUTE_LOCKED_STATUSES.has(assignment.cycle_status)) {
    return res.status(409).json({
      error: `Cannot resolve a dispute on a ${assignment.cycle_status} cycle — attendance/payroll has already moved on`,
    });
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const setClause = new_shift_template_id
    ? "acknowledgement_status = 'acknowledged', dispute_resolved_by = ?, dispute_resolved_at = ?, dispute_resolution = ?, shift_template_id = ?"
    : "acknowledgement_status = 'acknowledged', dispute_resolved_by = ?, dispute_resolved_at = ?, dispute_resolution = ?";
  const setParams = new_shift_template_id
    ? [userId, now, dispute_resolution.trim(), new_shift_template_id, req.params.id]
    : [userId, now, dispute_resolution.trim(), req.params.id];

  await db.execute(`UPDATE roster_daily_assignment SET ${setClause} WHERE id = ?`, setParams);
  return res.json({ success: true, message: "Dispute resolved" });
}));

// ── Week-Off Capacity & FCFS Allocation ────────────────────────────────────────

// GET /weekoff/capacity?processId=&weekStartDate= — capacity summary per day-of-week
router.get("/weekoff/capacity", h(async (req: AuthenticatedRequest, res: Response) => {
  const { processId, weekStartDate } = req.query as { processId?: string; weekStartDate?: string };
  if (!processId || !weekStartDate) {
    return res.status(400).json({ error: "processId and weekStartDate are required" });
  }
  const userId = req.authUser!.id;
  if (!(await hasRole(userId, "admin", "hr", "wfm", "manager")) &&
      !(await hasProcessScope(userId, processId, null, "manager", "wfm"))) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const data = await weekoffAllocationService.getCapacitySummary(processId, weekStartDate);
  return res.json({ data });
}));

// POST /weekoff/run-allocation — trigger FCFS allocation engine for a cycle
// Accepts either cycleId directly or weekStartDate (will look up the matching cycle)
router.post("/weekoff/run-allocation", h(async (req: AuthenticatedRequest, res: Response) => {
  const { processId, cycleId, weekStartDate } = req.body;
  if (!processId || (!cycleId && !weekStartDate)) {
    return res.status(400).json({ error: "processId and either cycleId or weekStartDate are required" });
  }
  const userId = req.authUser!.id;
  if (!(await hasRole(userId, "admin", "wfm")) &&
      !(await hasProcessScope(userId, processId, null, "wfm"))) {
    return res.status(403).json({ success: false, message: "Forbidden: WFM or Admin role required" });
  }

  let resolvedCycleId = cycleId;
  if (!resolvedCycleId && weekStartDate) {
    const [cycleRows] = await db.execute<import("mysql2").RowDataPacket[]>(
      `SELECT id FROM weekly_roster_cycle
        WHERE process_id = ? AND week_start_date = ?
        ORDER BY created_at DESC LIMIT 1`,
      [processId, weekStartDate]
    );
    if (cycleRows.length === 0) {
      return res.status(404).json({ success: false, error: `No roster cycle found for process ${processId} on week starting ${weekStartDate}. Create a cycle first.` });
    }
    resolvedCycleId = cycleRows[0].id;
  }

  const data = await weekoffAllocationService.runFcfsAllocation(processId, resolvedCycleId, userId, req);
  return res.json({ data });
}));

// ── RTA Sync ───────────────────────────────────────────────────────────────────

// GET /cycles/:id/rta-sync-log
router.get("/cycles/:id/rta-sync-log", h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireCycleMonitor(req, res))) return;
  const data = await rtaSyncService.getSyncLogs(req.params.id);
  return res.json({ data });
}));

// POST /cycles/:id/push-to-rta — manual resync of published roster → RTA reconciliation
router.post("/cycles/:id/push-to-rta", h(async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireCycleOwner(req, res))) return;
  const syncType = (req.body.sync_type as "initial_publish" | "rerun" | "manual_resync") || "manual_resync";
  const data = await rtaSyncService.syncCycleToRta(req.params.id, syncType, req.authUser!.id, req);
  return res.json({ data });
}));

export { router as rosterGovRouter };
