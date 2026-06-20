import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { wfmController } from "./wfm.controller.js";
import { wfmService } from "./wfm.service.js";
import { getLiveTracker } from "./liveTracker.service.js";
import { rosterPreferenceService } from "./roster-preference.service.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { planningRuleService } from "./planningRule.service.js";
import { slotRequirementService } from "./slotRequirement.service.js";
import { weekoffDayRuleService } from "./weekoffDayRule.service.js";
import { calculate } from "./hcCalculation.service.js";

export const wfmRouter = Router();
wfmRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Attendance policy (customizable)
wfmRouter.get("/attendance-policy/:employeeId", requireRole("admin", "wfm", "manager"), async (req, res, next) => {
  try {
    const policy = await wfmService.getAttendancePolicy(req.params.employeeId);
    res.json(policy);
  } catch (error) {
    next(error);
  }
});

// Shifts
wfmRouter.get("/shifts",          requireRole("admin", "wfm", "manager"), h(wfmController.listShifts.bind(wfmController)));
wfmRouter.post("/shifts",         requireRole("admin", "wfm"), h(wfmController.createShift.bind(wfmController)));
wfmRouter.get("/shifts/:id",      requireRole("admin", "wfm", "manager"), h(wfmController.getShift.bind(wfmController)));
wfmRouter.put("/shifts/:id",      requireRole("admin", "wfm"), h(wfmController.updateShift.bind(wfmController)));

// Attendance calendar - monthly attendance data for employee
wfmRouter.get("/attendance", h(async (req: any, res: any) => {
  const { employee_id, month, year } = req.query;
  if (!employee_id || !month || !year) {
    return res.status(400).json({ success: false, error: "employee_id, month, and year are required" });
  }

  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    `SELECT record_date AS attendance_date,
            attendance_status AS status,
            clock_in_time AS first_punch,
            clock_out_time AS last_punch,
            ROUND(COALESCE(raw_minutes, TIMESTAMPDIFF(MINUTE, clock_in_time, clock_out_time), 0) / 60, 2) AS working_hours,
            0 AS break_minutes,
            COALESCE(clock_in_location, clock_out_location) AS punch_location,
            attendance_source AS source,
            override_reason AS remarks
     FROM attendance_daily_record
     WHERE employee_id = ?
       AND YEAR(record_date) = ?
       AND MONTH(record_date) = ?
     ORDER BY record_date ASC`,
    [employee_id, year, month]
  );

  return res.json({ success: true, data: rows });
}));

// Attendance sessions
wfmRouter.post("/sessions/clock-in",  h(wfmController.clockIn.bind(wfmController)));  // Employee self-service
wfmRouter.post("/sessions/clock-out", h(wfmController.clockOut.bind(wfmController))); // Employee self-service
wfmRouter.get("/sessions",            requireRole("admin", "wfm", "manager"), h(wfmController.listSessions.bind(wfmController)));
wfmRouter.post("/sessions/break",     h(wfmController.logBreak.bind(wfmController))); // Employee self-service

// Regularization reason codes
wfmRouter.get("/regularizations/reasons", h(async (req: any, res: any) => {
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const isManager = await checkRole(req.authUser.id, 'admin', 'hr', 'wfm', 'manager');
  const data = await wfmService.listReasons(isManager ? undefined : 'employee');
  return res.json({ success: true, data });
}));

// Regularization
wfmRouter.post("/regularizations", h(async (req: any, res: any) => {
  const { regularizationSchema } = await import("./wfm.validation.js");
  const input = regularizationSchema.parse(req.body);
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const isManager = await checkRole(req.authUser.id, 'admin', 'hr', 'wfm', 'manager');
  const requestedByType = isManager ? 'manager' : 'employee';
  const emp = isManager
    ? (req.body.employeeId ? { id: req.body.employeeId } : await getEmployeeForUser(req.authUser.id))
    : await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  // Employees can only submit for themselves
  if (!isManager) {
    const selfEmp = await getEmployeeForUser(req.authUser.id);
    if (!selfEmp || selfEmp.id !== emp.id) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
  }
  const data = await wfmService.submitRegularization(
    { ...input, employeeId: emp.id, requestedByType } as any,
    req.authUser.id
  );
  return res.status(201).json({ success: true, data, message: "Regularization submitted" });
}));

// GET /api/wfm/regularizations/mine — employee sees own regularization requests
wfmRouter.get("/regularizations/mine", h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await wfmService.listRegularizations({ employeeId: emp.id });
  return res.json({ success: true, data });
}));
wfmRouter.get("/regularizations",               requireRole("admin", "wfm", "manager"), h(wfmController.listRegularizations.bind(wfmController)));
wfmRouter.patch("/regularizations/:id/review",  requireRole("admin", "wfm", "manager"), h(wfmController.reviewRegularization.bind(wfmController)));

// Live tracker
wfmRouter.get("/live", requireRole("admin", "wfm", "manager", "branch_head", "process_manager", "tl"), async (req: any, res: any, next: any) => {
  try {
    const schema = z.object({
      date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      processName: z.string().optional(),
      branchName:  z.string().optional(),
    });
    const filters = schema.parse(req.query);
    const data = await getLiveTracker(filters);
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// Roster Preferences
wfmRouter.post("/roster-preferences", requireAuth, h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ error: "Employee record not found" });
  const { preferredShiftId, preferredWeekOff, flexibility, notes, effectiveFrom } = req.body;
  if (!flexibility || !effectiveFrom) return res.status(400).json({ error: "flexibility and effectiveFrom required" });
  const result = await rosterPreferenceService.submit(emp.id, { preferredShiftId, preferredWeekOff, flexibility, notes, effectiveFrom });
  res.status(201).json({ data: result });
}));

wfmRouter.get("/roster-preferences/my", requireAuth, h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ error: "Employee record not found" });
  const prefs = await rosterPreferenceService.getMyPreferences(emp.id);
  res.json({ data: prefs });
}));

wfmRouter.get("/roster-preferences/pending", requireAuth, requireRole("admin", "hr", "manager", "wfm"), h(async (_req: any, res: any) => {
  const prefs = await rosterPreferenceService.getPending();
  res.json({ data: prefs });
}));

wfmRouter.patch("/roster-preferences/:id/approve", requireAuth, requireRole("admin", "hr", "manager", "wfm"), h(async (req: any, res: any) => {
  await rosterPreferenceService.approve(req.params.id, req.authUser!.id);
  res.json({ success: true });
}));

wfmRouter.patch("/roster-preferences/:id/reject", requireAuth, requireRole("admin", "hr", "manager", "wfm"), h(async (req: any, res: any) => {
  const { reason } = req.body;
  await rosterPreferenceService.reject(req.params.id, req.authUser!.id, reason || "Rejected");
  res.json({ success: true });
}));

// ── Week-Off Preference ────────────────────────────────────────────────────
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// POST /api/wfm/week-off-preference — employee submits preferred weekly off day
wfmRouter.post("/week-off-preference", requireAuth, h(async (req: any, res: any) => {
  const { z: zod } = await import("zod");
  const { db: dbConn } = await import("../../db/mysql.js");
  const schema = zod.object({
    preferredDay: zod.number().int().min(0).max(6),
    alternateDay: zod.number().int().min(0).max(6).nullable().optional(),
  });
  const body = schema.parse(req.body);
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ success: false, error: 'No employee record' });

  await dbConn.execute(
    `INSERT INTO week_off_preference (id, employee_id, preferred_day, alternate_day, approved, auto_approved)
     VALUES (UUID(), ?, ?, ?, 0, 0)
     ON DUPLICATE KEY UPDATE preferred_day = VALUES(preferred_day),
       alternate_day = VALUES(alternate_day), approved = 0, approved_by = NULL, approved_at = NULL`,
    [emp.id, body.preferredDay, body.alternateDay ?? null]
  );

  // Notify WFM lead(s) + reporting manager
  if ((emp as any).branch_id) {
    try {
      const { inboxService } = await import('../inbox/inbox.service.js');
      const empName = `${(emp as any).first_name} ${(emp as any).last_name ?? ''}`.trim();
      const [wfmRows] = await dbConn.execute(
        `SELECT e.user_id FROM user_assignment_scope uas
         JOIN employees e ON e.id = uas.manager_employee_id
         WHERE uas.role_key = 'wfm' AND uas.branch_id = ? AND e.user_id IS NOT NULL`,
        [(emp as any).branch_id]
      );
      for (const wfm of wfmRows as any[]) {
        if (!wfm.user_id) continue;
        await inboxService.createItem({
          user_id: wfm.user_id,
          type: 'week_off_preference',
          title: `Week Off Preference: ${empName}`,
          description: `${empName} (${(emp as any).employee_code}) has requested ${DAYS[body.preferredDay]} as weekly off day.`,
          entity_type: 'employee',
          entity_id: emp.id,
          action_url: '/attendance/week-off-preferences',
          priority: 'normal',
        });
      }
      // Notify RM with lower priority (visibility only)
      if ((emp as any).reporting_manager_id) {
        const [rmRows] = await dbConn.execute(
          `SELECT user_id FROM employees WHERE id = ? LIMIT 1`, [(emp as any).reporting_manager_id]
        );
        const rmUserId = (rmRows as any[])[0]?.user_id;
        if (rmUserId) {
          await inboxService.createItem({
            user_id: rmUserId,
            type: 'week_off_preference',
            title: `Week Off Request Submitted: ${empName}`,
            description: `${empName} submitted week-off preference for ${DAYS[body.preferredDay]}. WFM lead will review.`,
            entity_type: 'employee',
            entity_id: emp.id,
            action_url: '/attendance/week-off-preferences',
            priority: 'low',
          });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  const [rows] = await (await import("../../db/mysql.js")).db.execute(
    `SELECT wop.*, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name, e.employee_code
     FROM week_off_preference wop LEFT JOIN employees e ON e.id = wop.employee_id
     WHERE wop.employee_id = ? ORDER BY wop.created_at DESC LIMIT 1`, [emp.id]
  );
  return res.status(201).json({ success: true, data: (rows as any[])[0] });
}));

// GET /api/wfm/week-off-preference — list (wfm: filtered by branch; employee: own)
wfmRouter.get("/week-off-preference", requireAuth, h(async (req: any, res: any) => {
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const { db: dbConn } = await import("../../db/mysql.js");
  const isPrivileged = await checkRole(req.authUser.id, 'admin', 'hr', 'wfm', 'manager');
  let cond = '', params: unknown[] = [];
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(req.authUser.id);
    if (!emp) return res.status(403).json({ success: false, error: 'Forbidden' });
    cond = 'WHERE wop.employee_id = ?';
    params = [emp.id];
  } else if (req.query.branchId) {
    cond = 'WHERE e.branch_id = ?';
    params = [req.query.branchId];
  }
  const [rows] = await dbConn.execute(
    `SELECT wop.*, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
       e.employee_code, b.branch_name
     FROM week_off_preference wop
     LEFT JOIN employees e ON e.id = wop.employee_id
     LEFT JOIN branch_master b ON b.id = e.branch_id
     ${cond}
     ORDER BY wop.created_at DESC`, params
  );
  return res.json({ success: true, data: rows });
}));

// PATCH /api/wfm/week-off-preference/:id/approve — WFM lead approves/rejects
wfmRouter.patch("/week-off-preference/:id/approve", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const { z: zod } = await import("zod");
  const { db: dbConn } = await import("../../db/mysql.js");
  const { approved } = zod.object({ approved: zod.boolean() }).parse(req.body);
  await dbConn.execute(
    `UPDATE week_off_preference SET approved = ?, approved_by = ?, approved_at = NOW() WHERE id = ?`,
    [approved ? 1 : 0, req.authUser.id, req.params.id]
  );
  const [rows] = await dbConn.execute(
    `SELECT * FROM week_off_preference WHERE id = ? LIMIT 1`, [req.params.id]
  );
  return res.json({ success: true, data: (rows as any[])[0] });
}));

// ── Shift Rotation Type ────────────────────────────────────────────────────────

// GET /api/wfm/rotation-summary?processId=&branchId= — per-type employee counts
wfmRouter.get("/rotation-summary", requireAuth, requireRole("admin", "wfm", "hr", "manager"), h(async (req: any, res: any) => {
  const { processId, branchId } = req.query;
  if (!processId) return res.status(400).json({ error: "processId is required" });
  const { db: dbConn } = await import("../../db/mysql.js");
  const params: unknown[] = [processId];
  let branchWhere = "";
  if (branchId) { branchWhere = " AND e.branch_id = ?"; params.push(branchId); }

  const [rows] = await dbConn.execute(
    `SELECT COALESCE(e.shift_rotation_type, 'frozen') AS rotation_type,
            COUNT(*) AS employee_count
       FROM employees e
      WHERE e.process_id = ? AND e.active_status = 1${branchWhere}
      GROUP BY rotation_type`,
    params
  );

  const [empRows] = await dbConn.execute(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            COALESCE(e.shift_rotation_type, 'frozen') AS shift_rotation_type,
            e.designation
       FROM employees e
      WHERE e.process_id = ? AND e.active_status = 1${branchWhere}
      ORDER BY e.employee_code ASC`,
    params
  );

  return res.json({ success: true, data: { summary: rows, employees: empRows } });
}));

// PATCH /api/wfm/employees/:id/shift-rotation — set rotation type for one employee
wfmRouter.patch("/employees/:id/shift-rotation", requireAuth, requireRole("admin", "wfm", "hr"), h(async (req: any, res: any) => {
  const { shift_rotation_type } = req.body;
  const allowed = ["frozen", "weekly", "daily", "rotating"];
  if (!shift_rotation_type || !allowed.includes(shift_rotation_type)) {
    return res.status(400).json({ error: `shift_rotation_type must be one of: ${allowed.join(", ")}` });
  }
  const { db: dbConn } = await import("../../db/mysql.js");
  const [result] = await dbConn.execute(
    "UPDATE employees SET shift_rotation_type = ? WHERE id = ? AND active_status = 1",
    [shift_rotation_type, req.params.id]
  ) as any;
  if (!result.affectedRows) return res.status(404).json({ error: "Employee not found or inactive" });
  return res.json({ success: true, message: `shift_rotation_type set to '${shift_rotation_type}'` });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// PLANNING RULES  /api/wfm/planning-rules
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/planning-rules?processId=&branchId=
wfmRouter.get("/planning-rules", requireAuth, requireRole("admin", "wfm", "hr", "manager"), h(async (req: any, res: any) => {
  const { processId, branchId } = req.query;
  if (!processId) return res.status(400).json({ error: "processId is required" });
  const data = await planningRuleService.list(processId, branchId);
  return res.json({ success: true, data });
}));

// POST /api/wfm/planning-rules
wfmRouter.post("/planning-rules", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const { process_id, workload_type, effective_from } = req.body;
  if (!process_id || !workload_type || !effective_from) {
    return res.status(400).json({ error: "process_id, workload_type and effective_from are required" });
  }
  const data = await planningRuleService.create(req.body, req.authUser!.id);
  return res.status(201).json({ success: true, data });
}));

// PATCH /api/wfm/planning-rules/:id
wfmRouter.patch("/planning-rules/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const data = await planningRuleService.update(req.params.id, req.body, req.authUser!.id);
  return res.json({ success: true, data });
}));

// DELETE /api/wfm/planning-rules/:id  (soft deactivate)
wfmRouter.delete("/planning-rules/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  await planningRuleService.deactivate(req.params.id, req.authUser!.id);
  return res.json({ success: true, message: "Planning rule deactivated" });
}));

// POST /api/wfm/planning-rules/calculate  (pure HC calculation — no DB, for preview)
wfmRouter.post("/planning-rules/calculate", requireAuth, requireRole("admin", "wfm", "hr", "manager"), h(async (req: any, res: any) => {
  const result = calculate(req.body);
  return res.json({ success: true, data: result });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// SLOT REQUIREMENTS  /api/wfm/slot-requirements
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/slot-requirements?processId=&fromDate=&toDate=&coverageStatus=
wfmRouter.get("/slot-requirements", requireAuth, requireRole("admin", "wfm", "hr", "manager"), h(async (req: any, res: any) => {
  const { processId, branchId, fromDate, toDate, coverageStatus } = req.query;
  if (!processId) return res.status(400).json({ error: "processId is required" });
  const data = await slotRequirementService.list({ processId, branchId, fromDate, toDate, coverageStatus });
  return res.json({ success: true, data });
}));

// POST /api/wfm/slot-requirements  (manual entry / upsert)
wfmRouter.post("/slot-requirements", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const data = await slotRequirementService.upsert(req.body, req.authUser!.id);
  return res.status(201).json({ success: true, data });
}));

// POST /api/wfm/slot-requirements/calculate  (calculate HC for a single slot)
wfmRouter.post("/slot-requirements/calculate", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const { slotId } = req.body;
  if (!slotId) return res.status(400).json({ error: "slotId is required" });
  const data = await slotRequirementService.calculateHc(slotId, req.authUser!.id);
  return res.json({ success: true, data });
}));

// POST /api/wfm/slot-requirements/calculate-bulk  (recalculate all slots for process/date range)
wfmRouter.post("/slot-requirements/calculate-bulk", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const { processId, fromDate, toDate } = req.body;
  if (!processId || !fromDate || !toDate) {
    return res.status(400).json({ error: "processId, fromDate and toDate are required" });
  }
  const data = await slotRequirementService.calculateHcBulk(processId, fromDate, toDate, req.authUser!.id);
  return res.json({ success: true, data });
}));

// PATCH /api/wfm/slot-requirements/:id
wfmRouter.patch("/slot-requirements/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const data = await slotRequirementService.upsert({ ...req.body, id: req.params.id }, req.authUser!.id);
  return res.json({ success: true, data });
}));

// DELETE /api/wfm/slot-requirements/:id (soft delete with mandatory reason)
wfmRouter.delete("/slot-requirements/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const { reason } = req.body;
  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: "delete_reason is required (minimum 5 characters)" });
  }
  await slotRequirementService.delete(req.params.id, req.authUser!.id, String(reason).trim());
  return res.json({ success: true });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// WEEK-OFF DAY RULES  /api/wfm/weekoff/day-rules
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/weekoff/day-rules?processId=&weekStartDate=
wfmRouter.get("/weekoff/day-rules", requireAuth, requireRole("admin", "wfm", "hr", "manager"), h(async (req: any, res: any) => {
  const { processId, weekStartDate } = req.query;
  if (!processId) return res.status(400).json({ error: "processId is required" });
  const data = await weekoffDayRuleService.list(processId, weekStartDate);
  return res.json({ success: true, data });
}));

// POST /api/wfm/weekoff/day-rules  (upsert — create or update for that week)
wfmRouter.post("/weekoff/day-rules", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const data = await weekoffDayRuleService.upsert(req.body, req.authUser!.id);
  return res.status(201).json({ success: true, data });
}));

// PATCH /api/wfm/weekoff/day-rules/:id
wfmRouter.patch("/weekoff/day-rules/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const data = await weekoffDayRuleService.upsert({ ...req.body, id: req.params.id }, req.authUser!.id);
  return res.json({ success: true, data });
}));

// DELETE /api/wfm/weekoff/day-rules/:id (soft delete with mandatory reason)
wfmRouter.delete("/weekoff/day-rules/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const { reason } = req.body;
  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: "delete_reason is required (minimum 5 characters)" });
  }
  await weekoffDayRuleService.delete(req.params.id, req.authUser!.id, String(reason).trim());
  return res.json({ success: true });
}));

// GET /api/wfm/weekoff/day-rules/capacity-grid?processId=&weekStartDate=
// Returns 7-element capacity check grid including min_hc, max_weekoff, allocated counts
wfmRouter.get("/weekoff/day-rules/capacity-grid", requireAuth, requireRole("admin", "wfm", "hr", "manager"), h(async (req: any, res: any) => {
  const { processId, weekStartDate } = req.query;
  if (!processId || !weekStartDate) return res.status(400).json({ error: "processId and weekStartDate are required" });
  const { db: dbConn } = await import("../../db/mysql.js");

  // Count currently-rostered employees per day-of-week for the week
  const weekEnd = (() => {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const [empRows] = await dbConn.execute(
    `SELECT DAYOFWEEK(roster_date) - 1 AS dow, COUNT(*) AS cnt
       FROM wfm_roster_assignment
      WHERE process_name IN (SELECT process_name FROM process_master WHERE id = ?)
        AND roster_date BETWEEN ? AND ?
        AND (final_roster_status IS NULL OR final_roster_status != 'published_to_rta')
        AND is_week_off = 0
      GROUP BY dow`,
    [processId, weekStartDate, weekEnd]
  ) as any;

  const rosteredByDay: Record<number, number> = {};
  for (const r of empRows as any[]) rosteredByDay[r.dow] = Number(r.cnt);

  const data = await weekoffDayRuleService.getDayCapacityGrid(processId, weekStartDate, rosteredByDay);
  return res.json({ success: true, data });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// MANAGER REVIEW ACTIONS  /api/wfm/manager/weekoff-review
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/manager/weekoff-review  — disputes needing manager action
wfmRouter.get("/manager/weekoff-review", requireAuth, requireRole("admin", "hr", "wfm", "manager", "branch_head"), h(async (req: any, res: any) => {
  const { db: dbConn } = await import("../../db/mysql.js");
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const isPrivileged = await checkRole(req.authUser!.id, "admin", "hr", "wfm");

  let scopeWhere = "";
  const params: unknown[] = [];

  if (!isPrivileged) {
    // Manager can only see their mapped employees
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: "No employee record" });
    scopeWhere = `AND (e.reporting_manager_id = ? OR EXISTS (
      SELECT 1 FROM user_process_scope ups WHERE ups.user_id = ? AND ups.process_id = pm.id
    ))`;
    params.push(emp.id, req.authUser!.id);
  }

  const [rows] = await dbConn.execute(
    `SELECT wra.*,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code, e.designation,
            pm.process_name, bm.branch_name,
            wst.shift_name, wst.start_time, wst.end_time,
            wrc.week_start_date, wrc.week_end_date
       FROM wfm_roster_assignment wra
       JOIN employees e ON e.id = wra.employee_id
       LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       LEFT JOIN branch_master bm ON bm.branch_name = wra.branch_name
       LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
       LEFT JOIN weekly_roster_cycle wrc ON wrc.id = wra.cycle_id
      WHERE wra.final_roster_status = 'pending_manager_action'
        AND wra.employee_ack_status = 'rejected'
        ${scopeWhere}
      ORDER BY wra.roster_date ASC`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// POST /api/wfm/manager/weekoff-review/:assignmentId/realign
wfmRouter.post("/manager/weekoff-review/:assignmentId/realign", requireAuth, requireRole("admin", "hr", "wfm", "manager", "branch_head"), h(async (req: any, res: any) => {
  const { assignmentId } = req.params;
  const { new_roster_date, new_shift_template_id, reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason is required" });
  const { db: dbConn } = await import("../../db/mysql.js");
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");

  // Verify manager scope before mutation
  const isPrivileged = await checkRole(req.authUser!.id, "admin", "hr", "wfm");
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: "No employee record" });
    const [scopeCheck] = await dbConn.execute<RowDataPacket[]>(
      `SELECT 1 FROM wfm_roster_assignment wra
        JOIN employees e ON e.id = wra.employee_id
        JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_process_scope ups WHERE ups.user_id = ? AND ups.process_id = pm.id
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  const updates: string[] = [
    "final_roster_status = 'realigned_by_manager'",
    "manager_action_status = 'realigned'",
    "manager_action_by = ?",
    "manager_action_at = NOW()",
    "manager_action_reason = ?",
  ];
  const vals: unknown[] = [req.authUser!.id, reason];

  if (new_roster_date) { updates.push("roster_date = ?"); vals.push(new_roster_date); }
  if (new_shift_template_id) { updates.push("shift_template_id = ?"); vals.push(new_shift_template_id); }
  vals.push(assignmentId);

  await dbConn.execute(`UPDATE wfm_roster_assignment SET ${updates.join(", ")} WHERE id = ?`, vals);

  // Write audit row
  const { db: dbAudit } = await import("../../db/mysql.js");
  await dbAudit.execute(
    `INSERT INTO roster_decision_audit
       (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
        override_by, override_reason, override_at, acted_by_role, old_value_json, new_value_json)
     SELECT UUID(), COALESCE(generation_run_id,''), COALESCE(cycle_id,''), employee_id, roster_date,
            'manager_realigned', 'manager_realign_action', ?, ?, NOW(), 'manager',
            JSON_OBJECT('status','pending_manager_action'),
            JSON_OBJECT('status','realigned_by_manager','new_roster_date',?,'new_shift_template_id',?)
       FROM wfm_roster_assignment WHERE id = ?`,
    [req.authUser!.id, reason, new_roster_date ?? null, new_shift_template_id ?? null, assignmentId]
  );

  return res.json({ success: true, message: "Assignment realigned" });
}));

// POST /api/wfm/manager/weekoff-review/:assignmentId/force-approve
wfmRouter.post("/manager/weekoff-review/:assignmentId/force-approve", requireAuth, requireRole("admin", "hr", "wfm", "manager", "branch_head"), h(async (req: any, res: any) => {
  const { assignmentId } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason is required" });
  const { db: dbConn } = await import("../../db/mysql.js");
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");

  // Verify manager scope before mutation
  const isPrivileged = await checkRole(req.authUser!.id, "admin", "hr", "wfm");
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: "No employee record" });
    const [scopeCheck] = await dbConn.execute<RowDataPacket[]>(
      `SELECT 1 FROM wfm_roster_assignment wra
        JOIN employees e ON e.id = wra.employee_id
        JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_process_scope ups WHERE ups.user_id = ? AND ups.process_id = pm.id
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  await dbConn.execute(
    `UPDATE wfm_roster_assignment
        SET final_roster_status = 'force_approved_by_manager',
            manager_action_status = 'force_approved',
            manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
      WHERE id = ?`,
    [req.authUser!.id, reason, assignmentId]
  );

  await dbConn.execute(
    `INSERT INTO roster_decision_audit
       (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
        override_by, override_reason, override_at, acted_by_role)
     SELECT UUID(), COALESCE(generation_run_id,''), COALESCE(cycle_id,''), employee_id, roster_date,
            'force_approved', 'manager_force_approve', ?, ?, NOW(), 'manager'
       FROM wfm_roster_assignment WHERE id = ?`,
    [req.authUser!.id, reason, assignmentId]
  );

  return res.json({ success: true, message: "Assignment force-approved" });
}));

// POST /api/wfm/manager/weekoff-review/:assignmentId/escalate
wfmRouter.post("/manager/weekoff-review/:assignmentId/escalate", requireAuth, requireRole("admin", "hr", "wfm", "manager", "branch_head"), h(async (req: any, res: any) => {
  const { assignmentId } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason is required" });
  const { db: dbConn } = await import("../../db/mysql.js");
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");

  // Verify manager scope before mutation
  const isPrivileged = await checkRole(req.authUser!.id, "admin", "hr", "wfm");
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: "No employee record" });
    const [scopeCheck] = await dbConn.execute<RowDataPacket[]>(
      `SELECT 1 FROM wfm_roster_assignment wra
        JOIN employees e ON e.id = wra.employee_id
        JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_process_scope ups WHERE ups.user_id = ? AND ups.process_id = pm.id
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  await dbConn.execute(
    `UPDATE wfm_roster_assignment
        SET final_roster_status = 'escalated_to_hr',
            manager_action_status = 'escalated',
            manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
      WHERE id = ?`,
    [req.authUser!.id, reason, assignmentId]
  );

  await dbConn.execute(
    `INSERT INTO roster_decision_audit
       (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
        override_by, override_reason, override_at, acted_by_role)
     SELECT UUID(), COALESCE(generation_run_id,''), COALESCE(cycle_id,''), employee_id, roster_date,
            'escalated_to_hr', 'manager_escalate', ?, ?, NOW(), 'manager'
       FROM wfm_roster_assignment WHERE id = ?`,
    [req.authUser!.id, reason, assignmentId]
  );

  return res.json({ success: true, message: "Escalated to HR/WFM" });
}));

// POST /api/wfm/manager/weekoff-review/:assignmentId/reject-request
wfmRouter.post("/manager/weekoff-review/:assignmentId/reject-request", requireAuth, requireRole("admin", "hr", "wfm", "manager", "branch_head"), h(async (req: any, res: any) => {
  const { assignmentId } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason is required" });
  const { db: dbConn } = await import("../../db/mysql.js");
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");

  // Verify manager scope before mutation
  const isPrivileged = await checkRole(req.authUser!.id, "admin", "hr", "wfm");
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp) return res.status(403).json({ error: "No employee record" });
    const [scopeCheck] = await dbConn.execute<RowDataPacket[]>(
      `SELECT 1 FROM wfm_roster_assignment wra
        JOIN employees e ON e.id = wra.employee_id
        JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_process_scope ups WHERE ups.user_id = ? AND ups.process_id = pm.id
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  await dbConn.execute(
    `UPDATE wfm_roster_assignment
        SET final_roster_status = 'force_approved_by_manager',
            manager_action_status = 'rejected_request',
            manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
      WHERE id = ?`,
    [req.authUser!.id, reason, assignmentId]
  );

  await dbConn.execute(
    `INSERT INTO roster_decision_audit
       (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
        override_by, override_reason, override_at, acted_by_role)
     SELECT UUID(), COALESCE(generation_run_id,''), COALESCE(cycle_id,''), employee_id, roster_date,
            'manager_rejected_request', 'manager_reject_employee_request', ?, ?, NOW(), 'manager'
       FROM wfm_roster_assignment WHERE id = ?`,
    [req.authUser!.id, reason, assignmentId]
  );

  return res.json({ success: true, message: "Employee request rejected — original assignment retained" });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE SELF-SERVICE  /api/wfm/my-weekoff
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/my-weekoff  — employee sees their own roster assignments pending ack
wfmRouter.get("/my-weekoff", requireAuth, h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ error: "No employee record" });
  const { db: dbConn } = await import("../../db/mysql.js");
  const [rows] = await dbConn.execute(
    `SELECT wra.*,
            wst.shift_name, wst.start_time, wst.end_time,
            wrc.week_start_date, wrc.week_end_date, wrc.ack_deadline
       FROM wfm_roster_assignment wra
       LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
       LEFT JOIN weekly_roster_cycle wrc ON wrc.id = wra.cycle_id
      WHERE wra.employee_id = ?
        AND wra.final_roster_status IN ('pending_employee_ack','acknowledged','rejected_by_employee',
          'pending_manager_action','realigned_by_manager','force_approved_by_manager')
      ORDER BY wra.roster_date DESC LIMIT 90`,
    [(emp as any).id]
  );
  return res.json({ success: true, data: rows });
}));

// POST /api/wfm/my-weekoff/:assignmentId/acknowledge
wfmRouter.post("/my-weekoff/:assignmentId/acknowledge", requireAuth, h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ error: "No employee record" });
  const { db: dbConn } = await import("../../db/mysql.js");

  // Verify ownership
  const [rows] = await dbConn.execute(
    "SELECT id FROM wfm_roster_assignment WHERE id = ? AND employee_id = ? LIMIT 1",
    [req.params.assignmentId, (emp as any).id]
  ) as any;
  if (!(rows as any[])[0]) return res.status(403).json({ error: "Assignment not found or not yours" });

  await dbConn.execute(
    `UPDATE wfm_roster_assignment
        SET employee_ack_status = 'acknowledged', employee_ack_at = NOW(),
            final_roster_status = 'acknowledged'
      WHERE id = ? AND employee_id = ?`,
    [req.params.assignmentId, (emp as any).id]
  );
  return res.json({ success: true, message: "Acknowledged" });
}));

// POST /api/wfm/my-weekoff/:assignmentId/reject
wfmRouter.post("/my-weekoff/:assignmentId/reject", requireAuth, h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ error: "No employee record" });
  const { reason } = req.body;
  if (!reason || String(reason).trim().length < 5) return res.status(400).json({ error: "A reason of at least 5 characters is required" });
  const { db: dbConn } = await import("../../db/mysql.js");

  const [rows] = await dbConn.execute(
    "SELECT id FROM wfm_roster_assignment WHERE id = ? AND employee_id = ? LIMIT 1",
    [req.params.assignmentId, (emp as any).id]
  ) as any;
  if (!(rows as any[])[0]) return res.status(403).json({ error: "Assignment not found or not yours" });

  await dbConn.execute(
    `UPDATE wfm_roster_assignment
        SET employee_ack_status = 'rejected',
            employee_rejection_reason = ?,
            final_roster_status = 'pending_manager_action'
      WHERE id = ? AND employee_id = ?`,
    [String(reason).trim(), req.params.assignmentId, (emp as any).id]
  );
  return res.json({ success: true, message: "Rejection recorded. Your reporting manager has been notified." });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL ROSTER PUBLISH  /api/wfm/roster/publish-final
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/wfm/roster/publish-final
// Transitions all approved_final / force_approved_by_manager / realigned_by_manager
// assignments for a cycle to published_to_rta and sets published_to_rta_at.
wfmRouter.post("/roster/publish-final", requireAuth, requireRole("admin", "wfm", "hr"), h(async (req: any, res: any) => {
  const { cycleId } = req.body;
  if (!cycleId) return res.status(400).json({ error: "cycleId is required" });
  const { db: dbConn } = await import("../../db/mysql.js");

  const [result] = await dbConn.execute(
    `UPDATE wfm_roster_assignment
        SET final_roster_status = 'published_to_rta',
            published_to_rta_at = NOW()
      WHERE cycle_id = ?
        AND final_roster_status IN ('approved_final','force_approved_by_manager','realigned_by_manager','acknowledged')`,
    [cycleId]
  ) as any;

  return res.json({ success: true, published: result.affectedRows });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// RTA FINAL ROSTER STATE  /api/wfm/rta/final-roster-state
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/rta/final-roster-state?processId=&date=
// Returns per-employee RTA state for today or a given date.
// Only returns published/approved/force_approved/realigned records.
wfmRouter.get("/rta/final-roster-state", requireAuth, requireRole("admin", "wfm", "hr", "manager", "operations"), h(async (req: any, res: any) => {
  const { processId, date } = req.query;
  if (!date) return res.status(400).json({ error: "date is required" });
  const { db: dbConn } = await import("../../db/mysql.js");

  const params: unknown[] = [date];
  let processCond = "";
  if (processId) { processCond = " AND pm.id = ?"; params.push(processId); }

  const [rows] = await dbConn.execute(
    `SELECT wra.id, wra.employee_id, wra.roster_date, wra.is_week_off,
            wra.final_roster_status, wra.employee_ack_status,
            wra.manager_action_status, wra.system_decision_reason,
            wst.shift_name, wst.start_time, wst.end_time,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
            e.employee_code, pm.process_name, bm.branch_name,
            -- Derived RTA exception label
            CASE
              WHEN wra.is_week_off = 1 AND wra.final_roster_status IN
                ('approved_final','force_approved_by_manager','realigned_by_manager','published_to_rta')
                THEN 'Week Off'
              WHEN wra.final_roster_status = 'pending_manager_action'
                THEN 'Pending Manager Action'
              WHEN wra.final_roster_status = 'escalated_to_hr'
                THEN 'Roster Dispute'
              WHEN wra.final_roster_status = 'pending_employee_ack'
                THEN 'Pending Acknowledgement'
              WHEN wra.final_roster_status IN ('acknowledged','approved_final','published_to_rta')
                THEN 'Scheduled'
              ELSE wra.final_roster_status
            END AS rta_exception_label
       FROM wfm_roster_assignment wra
       JOIN employees e ON e.id = wra.employee_id
       LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       LEFT JOIN branch_master bm ON bm.branch_name = wra.branch_name
       LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
      WHERE wra.roster_date = ?
        AND wra.final_roster_status IN (
          'pending_employee_ack','acknowledged','rejected_by_employee',
          'pending_manager_action','realigned_by_manager',
          'force_approved_by_manager','escalated_to_hr',
          'approved_final','published_to_rta'
        )${processCond}
      ORDER BY e.employee_code ASC`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// GET /api/wfm/attendance/day-detail/:employeeId/:date
// Combined attendance + COSEC daily aggregate + individual punches for one employee on one date
wfmRouter.get(
  "/attendance/day-detail/:employeeId/:date",
  requireAuth,
  h(async (req: any, res: any) => {
    const { employeeId, date } = req.params;
    // Allow: privileged roles, OR employee viewing their own record
    const { hasRole: checkRole2 } = await import("../../shared/accessGuard.js");
    const isPrivileged = await checkRole2(req.authUser!.id, "admin", "hr", "wfm", "manager", "ceo", "finance", "payroll");
    if (!isPrivileged) {
      const emp = await getEmployeeForUser(req.authUser!.id);
      if (!emp || emp.id !== employeeId) {
        return res.status(403).json({ success: false, error: "Forbidden" });
      }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "Invalid date format. Use YYYY-MM-DD" });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)) {
      return res.status(400).json({ success: false, error: "Invalid employeeId" });
    }

    const { db: dbConn } = await import("../../db/mysql.js");

    // Run all 3 queries in parallel for 3x faster response
    const [[attRows], [cosecRows], [punchRows]] = await Promise.all([
      // 1. Attendance record + biometric log
      dbConn.execute(
        `SELECT adr.*,
                DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
                e.employee_code,
                COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                e.working_hours_start,
                e.working_hours_end,
                DATE_FORMAT(bal.first_punch_in, '%Y-%m-%d %H:%i:%s') AS first_punch,
                DATE_FORMAT(bal.last_punch_out, '%Y-%m-%d %H:%i:%s') AS last_punch,
                bal.raw_minutes AS bio_minutes_log
           FROM attendance_daily_record adr
           JOIN employees e ON e.id = adr.employee_id
           LEFT JOIN biometric_attendance_log bal
             ON bal.employee_id = adr.employee_id AND bal.punch_date = adr.record_date
          WHERE adr.employee_id = ? AND adr.record_date = ?
          LIMIT 1`,
        [employeeId, date]
      ),
      // 2. COSEC daily aggregate (authoritative work minutes)
      dbConn.execute(
        `SELECT cda.user_id, DATE_FORMAT(cda.first_punch_in, '%Y-%m-%d %H:%i:%s') AS first_punch_in,
                DATE_FORMAT(cda.last_punch_out, '%Y-%m-%d %H:%i:%s') AS last_punch_out,
                cda.work_minutes, cda.shift_date
           FROM cosec_daily_agg cda
           JOIN employees e ON (e.employee_code = cda.user_id OR e.biometric_code = cda.user_id)
          WHERE e.id = ? AND cda.shift_date = ?
          LIMIT 1`,
        [employeeId, date]
      ),
      // 3. Individual punch events — handle night shift (prev-day punches before 06:00)
      dbConn.execute(
        `SELECT DATE_FORMAT(cps.punch_time, '%Y-%m-%d %H:%i:%s') AS punch_time,
                cps.io_type,
                CASE cps.io_type WHEN 1 THEN 'In' WHEN 2 THEN 'Out' ELSE CAST(cps.io_type AS CHAR) END AS io_label,
                cps.device_id
           FROM cosec_punch_sync cps
           JOIN employees e ON (e.employee_code = cps.user_id OR e.biometric_code = cps.user_id)
          WHERE e.id = ?
            AND (
              DATE(cps.punch_time) = ?
              OR (DATE(cps.punch_time) = DATE_ADD(?, INTERVAL 1 DAY) AND TIME(cps.punch_time) < '06:00:00')
            )
          ORDER BY cps.punch_time ASC`,
        [employeeId, date, date]
      ),
    ]);

    return res.json({
      success: true,
      data: {
        attendance_record: (attRows as any[])[0] ?? null,
        cosec_daily_agg: (cosecRows as any[])[0] ?? null,
        raw_punches: punchRows as any[],
      },
    });
  })
);
