import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasProcessScope, hasRole } from "../../shared/accessGuard.js";
import { rosterGovernanceService, type RosterCycle } from "./roster.governance.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const ROSTER_OWNERS = ["manager", "wfm"];
const SCOPED_MONITORS = ["manager", "wfm", "assistant_manager", "tl"];

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

// ── Roster Cycles ─────────────────────────────────────────────────────────────

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

// Get employee's own roster assignments for a cycle
router.get("/my-roster/:cycleId", h(async (req: AuthenticatedRequest, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await rosterGovernanceService.getAssignments(req.params.cycleId, emp.id);
  return res.json({ success: true, data });
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

export { router as rosterGovRouter };
