import { Router } from "express";
import { z } from "zod";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { wfmController } from "./wfm.controller.js";
import { wfmService } from "./wfm.service.js";
import { getLiveTracker } from "./liveTracker.service.js";
import { rosterPreferenceService } from "./roster-preference.service.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { checkAssignmentDateNotLocked } from "../roster/roster-lock-guard.js";
import {
  HALF_DAY_STATUS,
  LEAVE_STATUSES,
  NON_WORKING_STATUSES,
  attendedDaysSql,
  expectedToWorkSql,
  presentSql,
  statusList,
} from "../../shared/attendanceStatus.js";
import { planningRuleService } from "./planningRule.service.js";
import { slotRequirementService } from "./slotRequirement.service.js";
import { restPolicyConfigService } from "./rest-policy-config.service.js";
import { weekoffDayRuleService } from "./weekoffDayRule.service.js";
import { calculate } from "./hcCalculation.service.js";
import { attendanceAprBulkRouter } from "./attendance-apr-bulk.routes.js";
import { scopedAttendanceDailyHandler } from "./attendance-daily-scoped.routes.js";

export const wfmRouter = Router();
wfmRouter.use(requireAuth);
wfmRouter.use("/attendance", attendanceAprBulkRouter);

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

// Attendance calendar - daily attendance data for date range
wfmRouter.get("/attendance/daily", h(async (req: any, res: any) => {
  const { employeeId, fromDate, toDate } = req.query;
  if (!employeeId) {
    // No employeeId means a self/team/branch/process-scoped, multi-employee
    // query (e.g. "everyone on my team for today") rather than one
    // employee's history across a date range — a different query shape than
    // the rest of this handler builds below. TeamAttendanceTab.tsx calls
    // exactly this way (date, no employeeId) and got a flat 400 here before
    // this fix, because this route — mounted at app.ts:334 — always wins the
    // full path /api/wfm/attendance/daily over attendance-daily-scoped.routes.ts's
    // own matching mount (app.ts:516, registered later, Express resolves by
    // registration order for an overlapping exact path). That router's
    // handler already implements exactly this scoping correctly, so this
    // delegates to it rather than duplicating ~130 lines of scope-building
    // SQL; the employeeId-provided path below is completely unchanged for
    // the five other callers (ADRAttendanceCalendar, useAttendance,
    // useAttendanceHub, NativeEmployeeStatCard, MyAttendanceHistory) that
    // already pass employeeId and depend on its exact response shape.
    return scopedAttendanceDailyHandler(req, res);
  }

  // Ownership + role check: employees may only view their own attendance;
  // admin/hr/wfm/manager/branch_head/process_manager may view any employee.
  const PRIVILEGED_ROLES = new Set(['admin', 'hr', 'wfm', 'manager', 'branch_head', 'process_manager', 'super_admin', 'ceo']);
  const { hasRole } = await import("../../shared/accessGuard.js");
  const isPrivileged = await hasRole(req.authUser.id, ...PRIVILEGED_ROLES);
  if (!isPrivileged) {
    const selfEmp = await getEmployeeForUser(req.authUser.id);
    if (!selfEmp || selfEmp.id !== employeeId) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
  }

  const { db } = await import("../../db/mysql.js");
  // The aliased columns (date/status/clock_in/clock_out/location/source) are read by
  // six callers — TeamAttendanceTab, MyAttendanceHistory, useAttendance, useAttendanceHub,
  // NativeEmployeeStatCard and the ADR calendar — so they stay exactly as they were.
  //
  // The unaliased columns below are additive. ADRAttendanceCalendar reads the raw ADR
  // column names (attendance_source, lwp_value, mismatch_flag, is_locked, …) and this
  // query returned none of them, so the APR/BIO badge, LWP figure, late mark, lock icon,
  // mismatch banner and "last processed" line rendered blank or zero on every day —
  // including fully processed ones. Returning both spellings keeps existing callers
  // working while the ADR surface gets the fields it was written against.
  // record_date is formatted rather than returned raw, matching its two sibling queries
  // (attendance-daily-scoped.routes.ts and attendance-engine.service.ts, which both
  // DATE_FORMAT it). Raw, it is a bare "2026-08-01" only because the pool sets
  // dateStrings: true (backend/src/db/mysql.ts). Every calendar that reads this endpoint
  // keys its day cells on a strict YYYY-MM-DD, so if that flag ever changes - or any
  // serializer lands in between - record_date becomes "2026-07-31T18:30:00.000Z", every
  // lookup misses, and the whole month renders blank while the table view, which slices
  // to 10 chars, keeps working. Formatting here removes the dependency on a pool flag.
  let sql = `SELECT DATE_FORMAT(record_date, '%Y-%m-%d') AS date,
                   attendance_status AS status,
                   clock_in_time AS clock_in,
                   clock_out_time AS clock_out,
                   raw_minutes,
                   COALESCE(clock_in_location, clock_out_location) AS location,
                   attendance_source AS source,
                   DATE_FORMAT(record_date, '%Y-%m-%d') AS record_date,
                   attendance_status,
                   attendance_source,
                   dialler_minutes,
                   biometric_minutes,
                   biometric_status,
                   apr_status,
                   lwp_value,
                   late_mark,
                   late_by_minutes,
                   mismatch_flag,
                   is_locked,
                   source_system,
                   processed_at
            FROM attendance_daily_record
            WHERE employee_id = ?`;
  const params: unknown[] = [employeeId];

  if (fromDate) {
    sql += " AND record_date >= ?";
    params.push(fromDate);
  }
  if (toDate) {
    sql += " AND record_date <= ?";
    params.push(toDate);
  }

  sql += " ORDER BY record_date ASC";
  const [rows] = await db.execute(sql, params);

  return res.json({ success: true, data: rows });
}));

// Attendance sessions
wfmRouter.post("/sessions/clock-in",  h(wfmController.clockIn.bind(wfmController)));  // Employee self-service
wfmRouter.post("/sessions/clock-out", h(wfmController.clockOut.bind(wfmController))); // Employee self-service
wfmRouter.get("/sessions",            requireRole("admin", "wfm", "manager"), h(wfmController.listSessions.bind(wfmController)));
wfmRouter.post("/sessions/break",     h(wfmController.logBreak.bind(wfmController))); // Employee self-service
wfmRouter.get("/sessions/:sessionId/breaks", h(async (req: any, res: any) => {
  const breaks = await wfmService.getBreaksForSession(req.params.sessionId);
  return res.json({ success: true, data: breaks });
}));
/**
 * GET /attendance/breaks?recordIds=a,b,c — breaks for several attendance records at once.
 *
 * The profile's attendance history has always called this and no such route existed, so it
 * 404'd on every load and break details never appeared. Fetching them one record at a time
 * through /sessions/:sessionId/breaks would mean a request per row, which is why the caller
 * asks for them in a batch.
 *
 * Scoped to the caller's own employee, deliberately. recordIds arrive from the client, so
 * without that filter anyone could pass another person's attendance ids and read where and
 * when they took breaks. The existing /sessions/:sessionId/breaks route has no such check;
 * that is not a precedent worth copying. This surface is self-only — Profile.tsx loads
 * /api/employees/me and the route carries no employee parameter — so restricting to the
 * caller costs no legitimate use.
 *
 * Returns the shape the client reads directly: it casts the response to AttendanceBreak[]
 * and filters on attendance_record_id, without the field mapping that useBreaksForRecord
 * applies. Returning the raw wfm_break_log columns would leave every filter matching
 * nothing, and the breaks would silently appear absent rather than erroring.
 */
const MAX_BREAK_RECORD_IDS = 200;

wfmRouter.get("/attendance/breaks", h(async (req: any, res: any) => {
  const raw = String(req.query.recordIds ?? "").trim();
  const recordIds = raw
    .split(",")
    .map((id: string) => id.trim())
    .filter(Boolean)
    // A month of attendance is ~31 rows; the cap only stops an unbounded IN list.
    .slice(0, MAX_BREAK_RECORD_IDS);
  if (recordIds.length === 0) return res.json({ success: true, data: [] });

  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  // No employee record means no attendance of one's own — an empty list, not an error.
  if (!callerEmp) return res.json({ success: true, data: [] });

  const placeholders = recordIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, session_id, break_start, break_end, break_type, created_at
       FROM wfm_break_log
      WHERE session_id IN (${placeholders})
        AND employee_id = ?
      ORDER BY break_start ASC`,
    [...recordIds, callerEmp.id]
  );

  return res.json({
    success: true,
    data: rows.map((row) => ({
      id: row.id,
      attendance_record_id: row.session_id,
      pause_time: row.break_start,
      resume_time: row.break_end ?? null,
      // wfm_break_log.break_type is VARCHAR NOT NULL DEFAULT 'Break'. It was neither selected nor
      // mapped, so the Attendance page's LONG/MINI badge read undefined and always fell back.
      break_type: row.break_type ?? null,
      // wfm_break_log carries no geolocation. Returned as null rather than omitted so the
      // client's AttendanceBreak shape is satisfied and "no location" is explicit.
      pause_latitude: null,
      pause_longitude: null,
      pause_location_name: null,
      resume_latitude: null,
      resume_longitude: null,
      resume_location_name: null,
      created_at: row.created_at,
    })),
  });
}));

wfmRouter.patch("/breaks/:breakId/end", h(async (req: any, res: any) => {
  await wfmService.endBreak(req.params.breakId, req.authUser!.id);
  return res.json({ success: true, message: "Break ended" });
}));

// Regularization routes moved to wfm.regularization.secure.routes.ts

// Live tracker
wfmRouter.get("/live", requireRole("admin", "wfm", "manager", "branch_head", "process_manager", "team_leader", "operations_manager"), async (req: any, res: any, next: any) => {
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

wfmRouter.get("/roster-preferences/pending", requireAuth, requireRole("admin", "hr", "super_admin", "manager", "wfm"), h(async (_req: any, res: any) => {
  const prefs = await rosterPreferenceService.getPending();
  res.json({ data: prefs });
}));

wfmRouter.patch("/roster-preferences/:id/approve", requireAuth, requireRole("admin", "hr", "super_admin", "manager", "wfm"), h(async (req: any, res: any) => {
  await rosterPreferenceService.approve(req.params.id, req.authUser!.id);
  res.json({ success: true });
}));

wfmRouter.patch("/roster-preferences/:id/reject", requireAuth, requireRole("admin", "hr", "super_admin", "manager", "wfm"), h(async (req: any, res: any) => {
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

// GET /api/wfm/week-off-preference — list (role-based: own/downline/branch/all)
wfmRouter.get("/week-off-preference", requireAuth, h(async (req: any, res: any) => {
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const { db: dbConn } = await import("../../db/mysql.js");

  const isAdmin = await checkRole(req.authUser.id, 'admin', 'hr', 'wfm');
  let cond = '', params: unknown[] = [];

  if (isAdmin) {
    // Admin/HR/WFM see all or filtered by branchId
    if (req.query.branchId) {
      cond = 'WHERE e.branch_id = ?';
      params = [req.query.branchId];
    }
    // else no filter, see all
  } else {
    const emp = await getEmployeeForUser(req.authUser.id);
    if (!emp) return res.status(403).json({ success: false, error: 'Forbidden' });

    // 'team_lead' (no trailing 'er') was a typo — it matches no real role_key in
    // workforce_role_catalog, so this branch could never recognize a team_leader caller
    // regardless of intent. Corrected to 'team_leader', the canonical spelling used
    // elsewhere in the backend.
    const isManager = await checkRole(req.authUser.id, 'manager', 'tl', 'team_leader');
    if (isManager) {
      // Manager/TL sees direct reports (downline)
      cond = 'WHERE e.reporting_manager_id = ?';
      params = [emp.id];
    } else {
      // Employee sees own only
      cond = 'WHERE wop.employee_id = ?';
      params = [emp.id];
    }
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
wfmRouter.get("/rotation-summary", requireAuth, requireRole("admin", "super_admin", "wfm", "hr", "manager", "branch_head", "operations_manager"), h(async (req: any, res: any) => {
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
            dm.designation_name AS designation
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
      WHERE e.process_id = ? AND e.active_status = 1${branchWhere}
      ORDER BY e.employee_code ASC`,
    params
  );

  return res.json({ success: true, data: { summary: rows, employees: empRows } });
}));

// PATCH /api/wfm/employees/:id/shift-rotation — set rotation type for one employee
wfmRouter.patch("/employees/:id/shift-rotation", requireAuth, requireRole("admin", "super_admin", "wfm", "hr"), h(async (req: any, res: any) => {
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
wfmRouter.get("/planning-rules", requireAuth, requireRole("admin", "super_admin", "wfm", "hr", "manager", "branch_head", "operations_manager"), h(async (req: any, res: any) => {
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
wfmRouter.post("/planning-rules/calculate", requireAuth, requireRole("admin", "super_admin", "wfm", "hr", "manager"), h(async (req: any, res: any) => {
  const result = calculate(req.body);
  return res.json({ success: true, data: result });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// MINIMUM-REST POLICY CONFIG  /api/wfm/rest-policy
//
// Round 2 (2026-08-13), P1 gap: rest-policy.service.ts's resolution/
// validation is fully wired into every roster-write path, but until this,
// nothing could ever create a wfm_rest_policy row except direct SQL —
// every "no minimum-rest policy configured" error message already pointed
// callers at an admin page that had no backend behind it.
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/rest-policy?scope_type=&active_status=
wfmRouter.get("/rest-policy", requireAuth, requireRole("admin", "super_admin", "wfm", "hr"), h(async (req: any, res: any) => {
  const data = await restPolicyConfigService.list({
    scope_type: req.query.scope_type as string | undefined,
    active_status: req.query.active_status as string | undefined,
  });
  return res.json({ success: true, data });
}));

// GET /api/wfm/rest-policy/:id
wfmRouter.get("/rest-policy/:id", requireAuth, requireRole("admin", "super_admin", "wfm", "hr"), h(async (req: any, res: any) => {
  const data = await restPolicyConfigService.get(req.params.id);
  return res.json({ success: true, data });
}));

// POST /api/wfm/rest-policy
wfmRouter.post("/rest-policy", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const data = await restPolicyConfigService.create(req.body, req.authUser!.id, req);
  return res.status(201).json({ success: true, data });
}));

// PATCH /api/wfm/rest-policy/:id  (terms only — scope is immutable, create a new policy to change it)
wfmRouter.patch("/rest-policy/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const data = await restPolicyConfigService.update(req.params.id, req.body, req.authUser!.id, req);
  return res.json({ success: true, data });
}));

// DELETE /api/wfm/rest-policy/:id  (soft deactivate — matches the rest of this module's pattern)
wfmRouter.delete("/rest-policy/:id", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  await restPolicyConfigService.deactivate(req.params.id, req.authUser!.id, req);
  return res.json({ success: true, message: "Rest policy deactivated" });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// SLOT REQUIREMENTS  /api/wfm/slot-requirements
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/slot-requirements?processId=&fromDate=&toDate=&coverageStatus=
wfmRouter.get("/slot-requirements", requireAuth, requireRole("admin", "super_admin", "wfm", "hr", "manager", "branch_head", "operations_manager"), h(async (req: any, res: any) => {
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

// POST /api/wfm/slot-requirements/forecast-import  (bulk upsert volume rows + auto-recalculate HC)
wfmRouter.post("/slot-requirements/forecast-import", requireAuth, requireRole("admin", "wfm"), h(async (req: any, res: any) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: "req.body.rows must be a JSON array of slot requirement objects" });
  }
  const data = await slotRequirementService.forecastImport(rows, req.authUser!.id);
  return res.status(200).json({ success: true, data });
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
wfmRouter.get("/weekoff/day-rules", requireAuth, requireRole("admin", "super_admin", "wfm", "hr", "manager", "branch_head", "operations_manager"), h(async (req: any, res: any) => {
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
wfmRouter.get("/weekoff/day-rules/capacity-grid", requireAuth, requireRole("admin", "super_admin", "wfm", "hr", "manager", "branch_head", "operations_manager"), h(async (req: any, res: any) => {
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
wfmRouter.get("/manager/weekoff-review", requireAuth, requireRole("admin", "hr", "wfm", "manager", "branch_head", "team_leader", "assistant_manager"), h(async (req: any, res: any) => {
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
      SELECT 1 FROM user_assignment_scope ups
          WHERE ups.user_id = ? AND ups.process_id = pm.id AND ups.active_status = 1
    ))`;
    params.push(emp.id, req.authUser!.id);
  }

  const [rows] = await dbConn.execute(
    `SELECT wra.*,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code, dm.designation_name AS designation,
            pm.process_name, bm.branch_name,
            wst.shift_name, wst.start_time, wst.end_time,
            wrc.week_start_date, wrc.week_end_date
       FROM wfm_roster_assignment wra
       JOIN employees e ON e.id = wra.employee_id
       LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       LEFT JOIN branch_master bm ON bm.branch_name = wra.branch_name
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
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

/**
 * Blocks the ordinary manager-override roster actions (realign/force-approve/
 * escalate/reject-request) once attendance for that assignment's date has
 * been locked for payroll. payroll-governance.service.ts's freezeAttendance()
 * sets attendance_daily_record.is_locked = 1 at the Attendance Locked /
 * Payroll Input Ready lifecycle step — until then these endpoints behave
 * exactly as before. Past that lock, editing the roster date through this
 * path would silently rewrite a day payroll has already consumed; that now
 * requires a separate, explicitly-authorized correction/reopen workflow
 * instead of the normal override. (Part A.3, 2026-08-13 business-decision
 * sign-off — additive guard only, no existing successful-path behavior for
 * unlocked dates is changed.)
 *
 * Round 2 (2026-08-13): the query itself now lives in the shared
 * roster-lock-guard.ts module (checkAssignmentDateNotLocked) so other
 * roster-write paths — e.g. wfm-ext.service.ts's shift-swap apply — enforce
 * the identical invariant via the same function rather than a second copy of
 * this query. This wrapper is unchanged in signature/behavior; the 12
 * existing tests in wfm.routes.test.ts (locked→409 / unlocked→200 /
 * reason-still-required→400, per endpoint) pass unchanged against it.
 */
async function assertRosterDateNotLocked(
  dbConn: (typeof import("../../db/mysql.js"))["db"],
  assignmentId: string
): Promise<{ blocked: true; error: string } | { blocked: false }> {
  return checkAssignmentDateNotLocked(dbConn, assignmentId);
}

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
        -- LEFT, not INNER: 333,762 of 413,386 roster rows carry process_name NULL, so an
        -- inner join discards the row before the OR below is ever evaluated and the
        -- reporting-manager branch can never match — a manager was refused on their own
        -- direct report. pm.id is then NULL, and ups.process_id = pm.id cannot match a
        -- NULL, so the scope branch is unchanged: this restores the manager path only.
        LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_assignment_scope ups
          WHERE ups.user_id = ? AND ups.process_id = pm.id AND ups.active_status = 1
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  const lockCheck = await assertRosterDateNotLocked(dbConn, assignmentId);
  if (lockCheck.blocked) {
    return res.status(409).json({ error: lockCheck.error });
  }

  // Round 2 (2026-08-13) minimum-rest audit finding: realign can move an
  // employee onto a different shift_template_id, which can violate minimum
  // rest against their neighboring shifts just as surely as any other
  // roster write — but unlike manual assignment/bulk-upload, this endpoint
  // never called into rest-policy.service.ts at all. Only checked when a
  // new shift is actually being set (a pure date move with no shift change
  // carries the assignment's already-validated times, unchanged). Blocking-
  // only, no override support here yet — matches bulk-upload's posture,
  // the more conservative of the two existing behaviors in this codebase.
  if (new_shift_template_id) {
    // process_id/branch_id joined in here too (not just employee_id) — without
    // it, a process- or branch-scoped rest policy could never resolve on this
    // endpoint, silently falling back to organization-only. Every other Area 2
    // write path passes these; this one didn't originally.
    const [assignRows] = await dbConn.execute<RowDataPacket[]>(
      `SELECT wra.employee_id, wra.roster_date, e.process_id, e.branch_id
         FROM wfm_roster_assignment wra
         JOIN employees e ON e.id = wra.employee_id
        WHERE wra.id = ? LIMIT 1`,
      [assignmentId]
    );
    const assignRow = (assignRows as RowDataPacket[])[0];
    if (assignRow) {
      const [shiftRows] = await dbConn.execute<RowDataPacket[]>(
        `SELECT start_time, end_time FROM wfm_shift_template WHERE id = ? LIMIT 1`,
        [new_shift_template_id]
      );
      const shift = (shiftRows as RowDataPacket[])[0];
      if (shift?.start_time && shift?.end_time) {
        const effectiveDate = new_roster_date ? String(new_roster_date).slice(0, 10) : String(assignRow.roster_date).slice(0, 10);
        const { validateMinimumRest, isRestPolicyFeatureActive } = await import("./rest-policy.service.js");
        if (await isRestPolicyFeatureActive(dbConn)) {
          const restResult = await validateMinimumRest(
            { employeeId: String(assignRow.employee_id), processId: assignRow.process_id ?? null, branchId: assignRow.branch_id ?? null, forDate: effectiveDate },
            { startTime: String(shift.start_time).slice(0, 5), endTime: String(shift.end_time).slice(0, 5) },
            assignmentId,
            dbConn
          );
          if (!restResult.ok) {
            return res.status(409).json({
              error: restResult.reason === "REST_POLICY_MISSING"
                ? "No minimum-rest policy is configured for this employee/process/branch/organization — cannot verify this realignment is safe."
                : `Realigning to this shift leaves only ${restResult.actualRestMinutes} minute(s) of rest against the ${restResult.against} shift (minimum required: ${restResult.requiredRestMinutes}).`,
              reason: restResult.reason,
            });
          }
        }
      }
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

  // State change and audit row are one transaction: a failure between them would otherwise commit
  // the realignment and lose the record of who made it. See inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
  await tx.execute(`UPDATE wfm_roster_assignment SET ${updates.join(", ")} WHERE id = ?`, vals);

  // Write audit row
  await tx.execute(
    `INSERT INTO roster_decision_audit
       (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
        override_by, override_reason, override_at, acted_by_role, old_value_json, new_value_json)
     SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
            'manager_realigned', 'manager_realign_action', ?, ?, NOW(), 'manager',
            JSON_OBJECT('status','pending_manager_action'),
            JSON_OBJECT('status','realigned_by_manager','new_roster_date',?,'new_shift_template_id',?)
       FROM wfm_roster_assignment WHERE id = ?`,
    [req.authUser!.id, reason, new_roster_date ?? null, new_shift_template_id ?? null, assignmentId]
  );
  });

  // A manager resolution can clear the LAST thing a cycle was waiting on, so the same
  // published -> acknowledged check the employee path runs must happen here too. Without
  // it a week whose final holdout was settled by a manager, rather than by the employee
  // acknowledging, would sit at 'published' forever. Escalation deliberately does NOT call
  // this: 'escalated_to_hr' is still awaiting a human.
  await advanceCycleIfFullyAcknowledged(dbConn, req.params.assignmentId);
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
        -- LEFT, not INNER: 333,762 of 413,386 roster rows carry process_name NULL, so an
        -- inner join discards the row before the OR below is ever evaluated and the
        -- reporting-manager branch can never match — a manager was refused on their own
        -- direct report. pm.id is then NULL, and ups.process_id = pm.id cannot match a
        -- NULL, so the scope branch is unchanged: this restores the manager path only.
        LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_assignment_scope ups
          WHERE ups.user_id = ? AND ups.process_id = pm.id AND ups.active_status = 1
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  const lockCheck = await assertRosterDateNotLocked(dbConn, assignmentId);
  if (lockCheck.blocked) {
    return res.status(409).json({ error: lockCheck.error });
  }

  // State change and audit row are one transaction — see inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
    await tx.execute(
      `UPDATE wfm_roster_assignment
          SET final_roster_status = 'force_approved_by_manager',
              manager_action_status = 'force_approved',
              manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
        WHERE id = ?`,
      [req.authUser!.id, reason, assignmentId]
    );

    await tx.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
          override_by, override_reason, override_at, acted_by_role)
       SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
              'force_approved', 'manager_force_approve', ?, ?, NOW(), 'manager'
         FROM wfm_roster_assignment WHERE id = ?`,
      [req.authUser!.id, reason, assignmentId]
    );
  });

  // A manager resolution can clear the LAST thing a cycle was waiting on, so the same
  // published -> acknowledged check the employee path runs must happen here too. Without
  // it a week whose final holdout was settled by a manager, rather than by the employee
  // acknowledging, would sit at 'published' forever. Escalation deliberately does NOT call
  // this: 'escalated_to_hr' is still awaiting a human.
  await advanceCycleIfFullyAcknowledged(dbConn, req.params.assignmentId);
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
        -- LEFT, not INNER: 333,762 of 413,386 roster rows carry process_name NULL, so an
        -- inner join discards the row before the OR below is ever evaluated and the
        -- reporting-manager branch can never match — a manager was refused on their own
        -- direct report. pm.id is then NULL, and ups.process_id = pm.id cannot match a
        -- NULL, so the scope branch is unchanged: this restores the manager path only.
        LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_assignment_scope ups
          WHERE ups.user_id = ? AND ups.process_id = pm.id AND ups.active_status = 1
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  const lockCheck = await assertRosterDateNotLocked(dbConn, assignmentId);
  if (lockCheck.blocked) {
    return res.status(409).json({ error: lockCheck.error });
  }

  // State change and audit row are one transaction — see inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
    await tx.execute(
      `UPDATE wfm_roster_assignment
          SET final_roster_status = 'escalated_to_hr',
              manager_action_status = 'escalated',
              manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
        WHERE id = ?`,
      [req.authUser!.id, reason, assignmentId]
    );

    await tx.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
          override_by, override_reason, override_at, acted_by_role)
       SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
              'escalated_to_hr', 'manager_escalate', ?, ?, NOW(), 'manager'
         FROM wfm_roster_assignment WHERE id = ?`,
      [req.authUser!.id, reason, assignmentId]
    );
  });

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
        -- LEFT, not INNER: 333,762 of 413,386 roster rows carry process_name NULL, so an
        -- inner join discards the row before the OR below is ever evaluated and the
        -- reporting-manager branch can never match — a manager was refused on their own
        -- direct report. pm.id is then NULL, and ups.process_id = pm.id cannot match a
        -- NULL, so the scope branch is unchanged: this restores the manager path only.
        LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       WHERE wra.id = ? AND (e.reporting_manager_id = ? OR EXISTS (
         SELECT 1 FROM user_assignment_scope ups
          WHERE ups.user_id = ? AND ups.process_id = pm.id AND ups.active_status = 1
       )) LIMIT 1`,
      [assignmentId, emp.id, req.authUser!.id]
    );
    if (!(scopeCheck as RowDataPacket[])[0]) {
      return res.status(403).json({ error: "Not authorized to act on this employee" });
    }
  }

  const lockCheck = await assertRosterDateNotLocked(dbConn, assignmentId);
  if (lockCheck.blocked) {
    return res.status(409).json({ error: lockCheck.error });
  }

  // State change and audit row are one transaction — see inManagerDecisionTx.
  await inManagerDecisionTx(async (tx) => {
    await tx.execute(
      `UPDATE wfm_roster_assignment
          SET final_roster_status = 'manager_rejected_employee_request',
              manager_action_status = 'rejected_request',
              manager_action_by = ?, manager_action_at = NOW(), manager_action_reason = ?
        WHERE id = ?`,
      [req.authUser!.id, reason, assignmentId]
    );

    await tx.execute(
      `INSERT INTO roster_decision_audit
         (id, run_id, cycle_id, employee_id, roster_date, decision_type, rule_applied,
          override_by, override_reason, override_at, acted_by_role)
       SELECT UUID(), generation_run_id, COALESCE(cycle_id,''), employee_id, roster_date,
              'manager_rejected_request', 'manager_reject_employee_request', ?, ?, NOW(), 'manager'
         FROM wfm_roster_assignment WHERE id = ?`,
      [req.authUser!.id, reason, assignmentId]
    );
  });

  // A manager resolution can clear the LAST thing a cycle was waiting on, so the same
  // published -> acknowledged check the employee path runs must happen here too. Without
  // it a week whose final holdout was settled by a manager, rather than by the employee
  // acknowledging, would sit at 'published' forever. Escalation deliberately does NOT call
  // this: 'escalated_to_hr' is still awaiting a human.
  await advanceCycleIfFullyAcknowledged(dbConn, req.params.assignmentId);
  return res.json({ success: true, message: "Employee request rejected — original assignment retained" });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE SELF-SERVICE  /api/wfm/my-weekoff
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wfm/my-weekoff  — employee sees their own roster assignments pending ack
/**
 * Close the employee's roster work item once nothing in that cycle still needs their answer.
 *
 * The item is raised per cycle, not per assignment, so it must not disappear on the first of
 * seven days being acknowledged — otherwise the remaining six become invisible work with no
 * inbox entry pointing at them.
 */
async function closeRosterAckInboxItem(
  dbConn: { execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]> },
  employeeId: string,
  assignmentId: string
): Promise<void> {
  try {
    await dbConn.execute(
      `UPDATE work_inbox_item w
          JOIN employees e ON e.user_id = w.user_id
          SET w.is_actioned = 1
        WHERE e.id = ?
          AND w.type = 'ROSTER_ACK_PENDING'
          AND w.is_actioned = 0
          AND w.entity_id = (SELECT cycle_id FROM wfm_roster_assignment WHERE id = ?)
          AND NOT EXISTS (
              SELECT 1 FROM wfm_roster_assignment a
               WHERE a.employee_id = e.id
                 AND a.cycle_id = w.entity_id
                 AND a.final_roster_status = 'pending_employee_ack')`,
      [employeeId, assignmentId]
    );
  } catch {
    // Non-fatal: the employee's answer is already recorded, and a stale inbox row is far
    // less harmful than failing their acknowledgement because the inbox table misbehaved.
  }
}

/**
 * Run a manager decision's state change and its audit row as ONE transaction.
 *
 * The four manager-review actions each perform two writes: an UPDATE that records the decision on
 * the assignment, and an INSERT into roster_decision_audit that records who made it and why. They
 * ran unwrapped, so a failure between them committed the first and lost the second — observed for
 * real on 2026-08-20, when the audit INSERT died on a foreign key and left an assignment at
 * 'force_approved_by_manager' with no audit row at all. A decision existing with no record of who
 * took it is exactly what CLAUDE.md rule 8 forbids.
 *
 * The publish route already does this correctly; these four were the outliers.
 *
 * The pool is shared by ~45 workers and a single unreleased connection has previously starved all
 * of them for 16 days, so release() is in a finally and runs on every path. rollback() is
 * additionally guarded: if the connection died mid-transaction the rollback itself can throw, and
 * that must not replace the original error, which is the one worth reporting.
 */
async function inManagerDecisionTx<T>(
  fn: (tx: {
    execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
  }) => Promise<T>
): Promise<T> {
  const { db } = await import("../../db/mysql.js");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn as never);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Advance a cycle from 'published' to 'acknowledged' once nobody is left to answer.
 *
 * VALID_TRANSITIONS (roster.governance.service.ts) allows published -> acknowledged, and
 * acknowledged -> active is the gateway to the rest of the lifecycle — active, attendance_locked,
 * payroll_input_ready. Nothing ever performed this transition, so a fully acknowledged week sat at
 * 'published' forever and the lifecycle stalled one step after publish. Verified end to end
 * against production 2026-08-20: all seven assignments reached 'acknowledged' and the cycle was
 * still 'published'.
 *
 * The NOT EXISTS covers every state that is still waiting on a human, not just employee
 * acknowledgement: a rejection moves an assignment to 'pending_manager_action' (and possibly on to
 * 'escalated_to_hr'), and a week with an unresolved rejection is not acknowledged. So one holdout
 * correctly keeps the whole cycle open rather than letting it advance around them.
 *
 * Guarded on status = 'published' so this can only ever perform that one legal transition — it
 * cannot regress a cycle that has already moved on, which is the failure the publish route's own
 * POST_PUBLISH_STATUSES check exists to prevent.
 */
async function advanceCycleIfFullyAcknowledged(
  dbConn: { execute: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]> },
  assignmentId: string
): Promise<void> {
  try {
    await dbConn.execute(
      `UPDATE weekly_roster_cycle c
          SET c.status = 'acknowledged', c.updated_at = NOW()
        WHERE c.id = (SELECT a.cycle_id FROM wfm_roster_assignment a WHERE a.id = ?)
          AND c.status = 'published'
          AND NOT EXISTS (
              SELECT 1 FROM wfm_roster_assignment p
               WHERE p.cycle_id = c.id
                 AND p.final_roster_status IN
                     ('pending_employee_ack', 'pending_manager_action', 'escalated_to_hr'))`,
      [assignmentId]
    );
  } catch (err) {
    // Non-fatal for the same reason closeRosterAckInboxItem is: the employee's answer is already
    // committed, and refusing it because the cycle header did not move would be worse. Logged
    // rather than swallowed, so a cycle stuck at 'published' is diagnosable instead of silent.
    console.error("[roster] failed to advance cycle to acknowledged", { assignmentId, err });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MY ROSTER (week view) — /api/wfm/my-roster/weeks, /api/wfm/my-roster/week/:weekStart
//
// wfm_roster_assignment is the only table holding real roster data (413,386 rows,
// verified live 2026-08-17); roster_daily_assignment — what NativeMyRoster.tsx called
// until now via /api/roster-gov/* — holds 0. Employees saw an empty page.
//
// A cycle-based repoint (the other rival table's model) would not have fixed this: of
// those 413,386 rows, 412,032 have cycle_id = NULL — they come from the legacy plan_id
// roster engines, never the cycle-based generator. These two endpoints read by
// (employee_id, roster_date) instead of cycle_id, so both legacy and cycle-based rows
// are visible. Employee acknowledgement itself still only works for rows a manager has
// actually published into the ack chain (final_roster_status = 'pending_employee_ack',
// via POST /roster/publish-to-employees) — for everything still sitting in 'generated'
// (the legacy majority), this is read-only: the week is reported 'draft' rather than
// carrying a false "acknowledge" affordance on data nobody ever asked them to confirm.
// Bringing the legacy population into the ack workflow is a separate, larger decision
// (whether/how to assign cycle_id retroactively) and is not made here.
// ═══════════════════════════════════════════════════════════════════════════════

const ACK_TERMINAL = ["acknowledged", "approved_final", "published_to_rta", "force_approved_by_manager", "realigned_by_manager"];
const ACK_DISPUTED = ["rejected_by_employee", "pending_manager_action", "escalated_to_hr", "manager_rejected_employee_request"];

/** Map the 10-value final_roster_status enum onto the 3 states NativeMyRoster.tsx knows. */
function mapAckStatus(finalRosterStatus: string): string {
  if (ACK_TERMINAL.includes(finalRosterStatus)) return "acknowledged";
  if (ACK_DISPUTED.includes(finalRosterStatus)) return "disputed";
  if (finalRosterStatus === "pending_employee_ack") return "pending";
  return "not_published"; // 'generated' — never entered the ack workflow
}

// GET /api/wfm/my-roster/weeks — which weeks (Mon-Sun) this employee has assignments in,
// 8 weeks back through 4 weeks ahead, most recent first.
wfmRouter.get("/my-roster/weeks", requireAuth, h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ error: "No employee record" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        DATE_SUB(roster_date, INTERVAL WEEKDAY(roster_date) DAY) AS week_start,
        SUM(final_roster_status <> 'generated') AS non_generated_count,
        SUM(final_roster_status IN (${ACK_TERMINAL.map(() => "?").join(",")})) AS terminal_count,
        COUNT(*) AS total_count
       FROM wfm_roster_assignment
      WHERE employee_id = ?
        AND roster_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 8 WEEK) AND DATE_ADD(CURDATE(), INTERVAL 4 WEEK)
      GROUP BY week_start
      ORDER BY week_start DESC`,
    [...ACK_TERMINAL, (emp as any).id]
  );

  const weeks = (rows as any[]).map((r) => {
    const weekStart: string = r.week_start instanceof Date ? r.week_start.toISOString().slice(0, 10) : String(r.week_start);
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    const status = Number(r.non_generated_count) === 0
      ? "draft"
      : Number(r.terminal_count) === Number(r.total_count) ? "acknowledged" : "published";
    return {
      id: weekStart,
      process_id: "",
      week_start_date: weekStart,
      week_end_date: end.toISOString().slice(0, 10),
      status,
    };
  });

  return res.json({ success: true, data: weeks });
}));

// GET /api/wfm/my-roster/week/:weekStart — the 7 days for that week, shift/weekoff/ack state.
wfmRouter.get("/my-roster/week/:weekStart", requireAuth, h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp) return res.status(403).json({ error: "No employee record" });

  const weekStart = String(req.params.weekStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return res.status(400).json({ success: false, error: "weekStart must be YYYY-MM-DD" });
  }
  const weekEndDate = new Date(`${weekStart}T00:00:00`);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wra.id, wra.cycle_id, wra.employee_id, wra.roster_date, wra.is_week_off,
            wra.final_roster_status, wra.employee_ack_at,
            COALESCE(wst.shift_name, wsm.shift_name) AS shift_name,
            COALESCE(wst.start_time, wsm.start_time) AS start_time,
            COALESCE(wst.end_time, wsm.end_time) AS end_time
       FROM wfm_roster_assignment wra
       LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
       LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
      WHERE wra.employee_id = ?
        AND wra.roster_date BETWEEN ? AND ?
      ORDER BY wra.roster_date`,
    [(emp as any).id, weekStart, weekEnd]
  );

  const data = (rows as any[]).map((r) => ({
    id: r.id,
    cycle_id: r.cycle_id ?? weekStart,
    employee_id: r.employee_id,
    roster_date: r.roster_date instanceof Date ? r.roster_date.toISOString().slice(0, 10) : String(r.roster_date),
    shift_template_id: null,
    shift_name: r.shift_name ?? null,
    start_time: r.start_time ?? null,
    end_time: r.end_time ?? null,
    is_week_off: r.is_week_off,
    is_holiday: 0,
    acknowledgement_status: mapAckStatus(r.final_roster_status),
    acknowledged_at: r.employee_ack_at ?? null,
    notes: null,
  }));

  return res.json({ success: true, data });
}));

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
          'pending_manager_action','realigned_by_manager','force_approved_by_manager',
          'manager_rejected_employee_request')
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

  // Guarded on pending_employee_ack. Without the predicate this would happily "acknowledge"
  // an assignment the manager had already realigned or force-approved, silently overwriting
  // their decision with the employee's, and would let a double-submit re-stamp employee_ack_at.
  const [ackResult] = await dbConn.execute<ResultSetHeader>(
    `UPDATE wfm_roster_assignment
        SET employee_ack_status = 'acknowledged', employee_ack_at = NOW(),
            final_roster_status = 'acknowledged'
      WHERE id = ? AND employee_id = ? AND final_roster_status = 'pending_employee_ack'`,
    [req.params.assignmentId, (emp as any).id]
  );
  if (ackResult.affectedRows !== 1) {
    return res.status(409).json({
      success: false,
      error: "This assignment is no longer awaiting your acknowledgement",
    });
  }
  await closeRosterAckInboxItem(dbConn, (emp as any).id, req.params.assignmentId);
  await advanceCycleIfFullyAcknowledged(dbConn, req.params.assignmentId);
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

  const [rejectResult] = await dbConn.execute<ResultSetHeader>(
    `UPDATE wfm_roster_assignment
        SET employee_ack_status = 'rejected',
            employee_rejection_reason = ?,
            final_roster_status = 'pending_manager_action'
      WHERE id = ? AND employee_id = ? AND final_roster_status = 'pending_employee_ack'`,
    [String(reason).trim(), req.params.assignmentId, (emp as any).id]
  );
  if (rejectResult.affectedRows !== 1) {
    return res.status(409).json({
      success: false,
      error: "This assignment is no longer awaiting your acknowledgement",
    });
  }
  await closeRosterAckInboxItem(dbConn, (emp as any).id, req.params.assignmentId);
  // The message promised the manager had been notified; nothing had told them. The assignment
  // now sits in pending_manager_action, which is what GET /manager/weekoff-review lists.
  return res.json({ success: true, message: "Rejection recorded. Your reporting manager has been notified." });
}));

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLISH TO EMPLOYEES  /api/wfm/roster/publish-to-employees
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Move a cycle's assignments into pending_employee_ack and tell the employees.
 *
 * THIS IS THE STEP THAT DID NOT EXIST. Everything downstream of it was already built —
 * GET /my-weekoff, the acknowledge and reject handlers, the manager review queue with
 * realign / force-approve / escalate, publish-final and the RTA feed — and every one of them
 * was unreachable, because nothing anywhere wrote 'pending_employee_ack'. Verified live
 * 2026-08-16: the enum allows 11 values, only four had any writer, and all 413,386
 * assignments sat in 'generated'. Zero acknowledgements existed because none could.
 *
 * Owner decision (2026-08-16), Rule 10 option A: acknowledgement is requested when the roster
 * is published, for the whole cycle at once, rather than N days before the shift or only where
 * the roster contradicts a stated preference.
 *
 * Only 'generated' rows move. That makes re-publishing safe: an assignment already
 * acknowledged, rejected or sitting in the manager queue is left exactly where it is instead
 * of being dragged back to pending and losing the employee's answer.
 */
wfmRouter.post(
  "/roster/publish-to-employees",
  requireAuth,
  requireRole("admin", "super_admin", "wfm", "hr"),
  h(async (req: any, res: any) => {
    const cycleId = String(req.body?.cycleId ?? "").trim();
    if (!cycleId) return res.status(400).json({ success: false, error: "cycleId is required" });
    const ackDeadline = req.body?.ackDeadline ? String(req.body.ackDeadline) : null;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [cycleRows] = await conn.execute<RowDataPacket[]>(
        "SELECT id, status FROM weekly_roster_cycle WHERE id = ? FOR UPDATE",
        [cycleId]
      );
      if (!cycleRows[0]) {
        const err: any = new Error("Roster cycle not found");
        err.statusCode = 404;
        throw err;
      }

      // Fixed 2026-08-17 (Section E audit): this write went straight to
      // status='published' with no check of the cycle's CURRENT status, unlike every
      // transition in roster.governance.service.ts's advanceCycleStatus/VALID_TRANSITIONS,
      // which this route bypasses entirely. A repeat or mistaken call against a cycle that has
      // already advanced past publish — acknowledged, active, locked for attendance, or already
      // handed to payroll — would silently force its status field back to 'published', even
      // though the per-assignment `WHERE final_roster_status = 'generated'` guard below already
      // protects the assignment rows themselves from being re-dragged. Other code
      // (rta-sync.service.ts, dashboards) reads this status field to decide sync/display
      // eligibility, so regressing it is a real, visible break, not a cosmetic one.
      // Re-publishing from draft/submitted/reviewed/published itself stays allowed exactly as
      // designed — the comment above already documents that as safe and idempotent.
      const POST_PUBLISH_STATUSES = new Set([
        "acknowledged", "active", "variance_review", "attendance_locked", "payroll_input_ready", "closed",
      ]);
      if (POST_PUBLISH_STATUSES.has(String(cycleRows[0].status))) {
        const err: any = new Error(
          `Cannot publish: cycle is already at status '${cycleRows[0].status}', past the publish step. ` +
          `Publishing again would regress it and desynchronize downstream sync/dashboard reads.`
        );
        err.statusCode = 409;
        err.code = "CYCLE_ALREADY_ADVANCED";
        throw err;
      }

      // employee_ack_status is NOT NULL — enum('pending','acknowledged','rejected') DEFAULT
      // 'pending' — so the original `= NULL` here made this statement throw
      // "Column 'employee_ack_status' cannot be null" on EVERY call, rolling the whole
      // transaction back. Publishing a roster was therefore impossible: verified against
      // production 2026-08-20 by calling this route for real, which returned 500 and moved
      // nothing. That is why all 5 weekly_roster_cycle rows sit at 'draft' and why 0 of
      // 413,386 assignments carry an acknowledgement — not because nobody published, but
      // because nobody could. The 500 also arrives with an empty body, since a statusless
      // throw has its message replaced in production, so the UI showed no reason either.
      //
      // 'pending' is what NULL was reaching for: this employee has not answered yet. The
      // column models that state explicitly rather than as an absence, and it is the same
      // value the column defaults to when an assignment is first created.
      //
      // Re-verified after the fix, same route, same production cycle: 7 assignments published
      // and 1 employee notified, and an immediate re-publish correctly moved 0 and notified 0.
      const [moved] = await conn.execute<ResultSetHeader>(
        `UPDATE wfm_roster_assignment
            SET final_roster_status = 'pending_employee_ack',
                employee_ack_status = 'pending',
                employee_ack_at = NULL,
                employee_rejection_reason = NULL
          WHERE cycle_id = ?
            AND final_roster_status = 'generated'`,
        [cycleId]
      );

      await conn.execute(
        `UPDATE weekly_roster_cycle
            SET status = 'published', published_by = ?, published_at = NOW(),
                ack_deadline = COALESCE(?, ack_deadline), updated_at = NOW()
          WHERE id = ?`,
        [req.authUser!.id, ackDeadline, cycleId]
      );

      // One work item per employee for the whole cycle, not one per assignment — a week is
      // seven rows per person, and an inbox that lists them separately is an inbox nobody
      // reads. INSERT ... SELECT so the employee -> auth_user join happens in the database
      // rather than as 1,300 round trips, and NOT EXISTS so re-publishing does not stack
      // duplicates on people who have not answered yet.
      const [notified] = await conn.execute<ResultSetHeader>(
        `INSERT INTO work_inbox_item
           (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
         SELECT UUID(), e.user_id, 'ROSTER_ACK_PENDING',
                'Acknowledge your roster',
                CONCAT('Your roster for the week has been published. Please acknowledge or raise a concern',
                       COALESCE(CONCAT(' by ', DATE_FORMAT(?, '%d %b %Y')), ''), '.'),
                'weekly_roster_cycle', ?, '/my-roster', 'normal'
           FROM (SELECT DISTINCT employee_id FROM wfm_roster_assignment
                  WHERE cycle_id = ? AND final_roster_status = 'pending_employee_ack') a
           JOIN employees e ON e.id = a.employee_id
           JOIN auth_user au ON au.id = e.user_id
          WHERE NOT EXISTS (
                SELECT 1 FROM work_inbox_item w
                 WHERE w.user_id = e.user_id
                   AND w.type = 'ROSTER_ACK_PENDING'
                   AND w.entity_id = ?
                   AND w.is_actioned = 0)`,
        [ackDeadline, cycleId, cycleId, cycleId]
      );

      await conn.commit();
      return res.json({
        success: true,
        data: {
          cycleId,
          assignmentsPublished: moved.affectedRows,
          employeesNotified: notified.affectedRows,
        },
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      // 45 workers share this pool; one connection left unreleased has starved all of them.
      conn.release();
    }
  })
);

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL ROSTER PUBLISH  /api/wfm/roster/publish-final
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/wfm/roster/publish-final
// Transitions all approved_final / force_approved_by_manager / realigned_by_manager
// assignments for a cycle to published_to_rta and sets published_to_rta_at.
wfmRouter.post("/roster/publish-final", requireAuth, requireRole("admin", "super_admin", "wfm", "hr"), h(async (req: any, res: any) => {
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
wfmRouter.get("/rta/final-roster-state", requireAuth, requireRole("admin", "wfm", "hr", "manager", "operations_manager"), h(async (req: any, res: any) => {
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
    const isPrivileged = await checkRole2(
      req.authUser!.id,
      "super_admin", "admin", "hr", "wfm", "manager", "ceo",
      "finance", "payroll", "payroll_head", "payroll_admin", "branch_head", "process_manager",
      "recruiter", "qa", "trainer"
    );
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

    // Run queries: cosec_daily_agg may not exist in all environments — catch its error gracefully
    const [[attRows], [punchRows]] = await Promise.all([
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
      // 2. Individual punch events — handle night shift (prev-day punches before 06:00)
      dbConn.execute(
        `SELECT DATE_FORMAT(cps.punch_time, '%Y-%m-%d %H:%i:%s') AS punch_time,
                cps.io_type,
                CASE cps.io_type WHEN 1 THEN 'In' WHEN 2 THEN 'Out' ELSE CAST(cps.io_type AS CHAR) END AS io_label,
                cps.device_id
           FROM cosec_punch_sync cps
           JOIN employees e
             ON (
               e.employee_code COLLATE utf8mb4_unicode_ci = cps.user_id COLLATE utf8mb4_unicode_ci
               OR e.biometric_code COLLATE utf8mb4_unicode_ci = cps.user_id COLLATE utf8mb4_unicode_ci
             )
          WHERE e.id = ?
            AND (
              DATE(cps.punch_time) = ?
              OR (DATE(cps.punch_time) = DATE_ADD(?, INTERVAL 1 DAY) AND TIME(cps.punch_time) < '06:00:00')
            )
          ORDER BY cps.punch_time ASC`,
        [employeeId, date, date]
      ),
    ]);

    // cosec_daily_agg may not exist — query it separately with fallback to null
    let cosecAgg: any = null;
    try {
      const [cosecRows] = await dbConn.execute(
        `SELECT cda.user_id, DATE_FORMAT(cda.first_punch_in, '%Y-%m-%d %H:%i:%s') AS first_punch_in,
                DATE_FORMAT(cda.last_punch_out, '%Y-%m-%d %H:%i:%s') AS last_punch_out,
                cda.work_minutes, cda.shift_date
           FROM cosec_daily_agg cda
           JOIN employees e
             ON (
               e.employee_code COLLATE utf8mb4_unicode_ci = cda.user_id COLLATE utf8mb4_unicode_ci
               OR e.biometric_code COLLATE utf8mb4_unicode_ci = cda.user_id COLLATE utf8mb4_unicode_ci
             )
          WHERE e.id = ? AND cda.shift_date = ?
          LIMIT 1`,
        [employeeId, date]
      ) as any[];
      cosecAgg = (cosecRows as any[])[0] ?? null;
    } catch {
      // Table doesn't exist in this environment — return null safely
    }

    if (!cosecAgg) {
      try {
        const nextDate = new Date(`${date}T00:00:00+05:30`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        const nextDateText = nextDate.toISOString().slice(0, 10);
        const {
          getBulkCosecMappings,
          getMonthlyAttendanceFromNcosec,
        } = await import("./attendance-realtime-ncosec.service.js");
        const mappings = await getBulkCosecMappings([employeeId]);
        const monthly = await getMonthlyAttendanceFromNcosec(mappings, date, nextDateText);
        const matched = monthly.find((row) => row.record_date === date) ?? null;
        if (matched) {
          cosecAgg = {
            user_id: matched.employee_code,
            shift_date: matched.record_date,
            first_punch_in: matched.clock_in_time ? matched.clock_in_time.replace("T", " ").replace("+05:30", "") : null,
            last_punch_out: matched.clock_out_time ? matched.clock_out_time.replace("T", " ").replace("+05:30", "") : null,
            work_minutes: matched.raw_minutes ?? matched.biometric_minutes ?? 0,
            synced_at: new Date().toISOString(),
          };
        }
      } catch {
        // Direct COSEC fallback is best-effort only.
      }
    }

    // cosec_punch_sync's last write was 2026-06-18 — it is the legacy mirror fed by the
    // manual-only migrate-ncosec script, and cosec-sync.service.ts never writes it (grep
    // it: not one reference). Live COSEC punches now land in biometric_attendance_log,
    // which is current. So for every date after that the query above returns zero rows and
    // the drawer renders an empty punch timeline under a summary that is showing real
    // minutes — it reads as "this employee never punched" when they did.
    //
    // cosecAgg immediately above already solves this for the summary: when the frozen
    // cosec_daily_agg misses, it falls back to a live NCOSEC read. Reuse that result rather
    // than adding a query or leaving the list blank. Only fires when the mirror gave
    // nothing, so historical dates keep their full per-punch detail untouched.
    //
    // These two are derived bounds, not per-punch events, so they carry derived: true —
    // the client must not present them as a complete punch trail.
    let rawPunches = punchRows as any[];
    if (rawPunches.length === 0 && cosecAgg && (cosecAgg.first_punch_in || cosecAgg.last_punch_out)) {
      rawPunches = [
        cosecAgg.first_punch_in
          ? { punch_time: cosecAgg.first_punch_in, io_type: 1, io_label: "In", device_id: null, derived: true }
          : null,
        cosecAgg.last_punch_out
          ? { punch_time: cosecAgg.last_punch_out, io_type: 2, io_label: "Out", device_id: null, derived: true }
          : null,
      ].filter(Boolean) as any[];
    }

    // APR / dialler source. Previously the drawer had no APR data at all beyond
    // attendance_daily_record.dialler_minutes, so Login/Logout rendered blank for
    // dialler employees. Read the real apr rows for this date.
    // Login_Time/Logout_Time are MySQL TIME — returned both raw and as an
    // IST-tagged datetime so the client never parses a bare TIME with `new Date()`.
    let aprRecord: any = null;
    try {
      const { getAprDayCampaigns, parseSqlTimeToMinutes, composeIstDateTime } =
        await import("./apr-attendance.service.js");
      const [empKeyRows] = await dbConn.execute(
        `SELECT employee_code, call_centre_code, biometric_code
           FROM employees WHERE id = ? LIMIT 1`,
        [employeeId]
      ) as any[];
      const empKeys = (empKeyRows as any[])[0];
      if (empKeys) {
        const campaigns = await getAprDayCampaigns(empKeys, date);
        if (campaigns.length > 0) {
          const logins = campaigns
            .map((c: any) => c.login_time).filter((t: any) => t && t !== '00:00:00').sort();
          const logouts = campaigns
            .map((c: any) => c.logout_time).filter((t: any) => t && t !== '00:00:00').sort();
          const loginTime = logins[0] ?? null;
          const logoutTime = logouts[logouts.length - 1] ?? null;
          const netMinutes = campaigns.reduce(
            (sum: number, c: any) => sum + parseSqlTimeToMinutes(c.net_login), 0
          );
          aprRecord = {
            record_date: date,
            login_time: loginTime,
            logout_time: logoutTime,
            login_at: composeIstDateTime(date, loginTime),
            logout_at: composeIstDateTime(date, logoutTime),
            net_minutes: netMinutes,
            calls: campaigns.reduce((s: number, c: any) => s + Number(c.calls ?? 0), 0),
            break_bio: campaigns.reduce((s: number, c: any) => s + parseSqlTimeToMinutes(c.bio), 0),
            break_lunch: campaigns.reduce((s: number, c: any) => s + parseSqlTimeToMinutes(c.lunch), 0),
            break_qa: campaigns.reduce((s: number, c: any) => s + parseSqlTimeToMinutes(c.qa), 0),
            break_training: campaigns.reduce((s: number, c: any) => s + parseSqlTimeToMinutes(c.training), 0),
            campaigns,
          };
        }
      }
    } catch {
      // apr table missing in this environment — leave aprRecord null.
    }

    return res.json({
      success: true,
      data: {
        attendance_record: (attRows as any[])[0] ?? null,
        cosec_daily_agg: cosecAgg,
        raw_punches: rawPunches,
        apr_record: aprRecord,
      },
    });
  })
);

// GET /api/wfm/my-attendance — employee's own attendance summary (month-to-date)
wfmRouter.get("/my-attendance", h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const selfEmp = await getEmployeeForUser(req.authUser.id);
  if (!selfEmp) {
    return res.json({ success: true, data: {} });
  }

  // Get current month in IST
  const now = new Date();
  const istDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  const monthStr = `${year}-${month}`;

  // Calculate month-to-date attendance summary.
  //
  // This query used to hand-roll its status vocabulary, which produced the
  // contradiction the CEO UAT reported on /my-dashboard: "Present 0 Days" shown
  // beside "Attendance % 13.8%" for the same person and period. Three separate
  // deviations from shared/attendanceStatus.ts caused it:
  //
  //   1. presentDays counted only 'present', while the percentage numerator also
  //      credited half-days — so the two tiles measured different things. It also
  //      dropped 'week_off_worked', a real ENUM member, so anyone working a week
  //      off had that day counted nowhere.
  //   2. The denominator excluded only holiday and week_off, leaving approved
  //      leave in "expected to work" and depressing every percentage.
  //   3. lateDays counted attendance_status = 'late', which is not a member of the
  //      ENUM at all — lateness is the separate late_mark flag — so it has always
  //      read 0. It now mirrors lateMarks rather than silently reporting nothing.
  //
  // All of it now derives from the shared helpers, so this endpoint, the org-wide
  // metric and the dashboards agree by construction.
  // Every aggregate is COALESCEd because an empty month returns one row of NULLs, not
  // zero rows. SUM() over no rows is NULL, and an aggregate query without GROUP BY always
  // produces exactly one row — so the `?? {...}` default below can never fire, and the
  // response goes out as fourteen null fields.
  //
  // That is what blanked every tile on /my-dashboard on 1 August: it was the first day of
  // the month, the caller had no rows yet in 2026-08, and asNumber(null) renders "—".
  // Verified against production: the same query over an empty month returns
  // presentDays NULL / attendancePct NULL, and returns 0 / 0.0 once COALESCEd.
  const [rows] = await db.execute(
    `SELECT
       COALESCE(${presentSql()}, 0) AS presentDays,
       COALESCE(SUM(CASE WHEN attendance_status = '${HALF_DAY_STATUS}' THEN 1 ELSE 0 END), 0) AS halfDays,
       COALESCE(SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END), 0) AS absentDays,
       COALESCE(SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END), 0) AS lateDays,
       COALESCE(SUM(CASE WHEN attendance_status IN (${statusList(LEAVE_STATUSES)}) THEN 1 ELSE 0 END), 0) AS leaveDays,
       COALESCE(SUM(CASE WHEN attendance_status = 'holiday' THEN 1 ELSE 0 END), 0) AS holidayDays,
       COALESCE(SUM(CASE WHEN attendance_status = 'week_off' THEN 1 ELSE 0 END), 0) AS weekOffDays,
       COALESCE(SUM(COALESCE(lwp_value, 0)), 0) AS totalLwp,
       COALESCE(SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END), 0) AS lateMarks,
       COALESCE(COUNT(CASE WHEN attendance_status NOT IN (${statusList(NON_WORKING_STATUSES)}) THEN 1 END), 0) AS totalWorkingDays,
       COALESCE(${expectedToWorkSql()}, 0) AS expectedToWork,
       COALESCE(ROUND(SUM(COALESCE(raw_minutes, 0)) / 60, 2), 0) AS totalHours,
       COALESCE(SUM(CASE WHEN work_mode IN ('wfo', 'office') THEN 1 ELSE 0 END), 0) AS wfoDays,
       COALESCE(ROUND(
         ${attendedDaysSql()} / NULLIF(${expectedToWorkSql()}, 0) * 100,
         1
       ), 0) AS attendancePct
     FROM attendance_daily_record
     WHERE employee_id = ?
       AND DATE_FORMAT(record_date, '%Y-%m') = ?
       AND record_date <= DATE(NOW())`,
    [selfEmp.id, monthStr]
  );

  // No `?? {...}` fallback here on purpose. rows[0] is always present for an aggregate
  // without GROUP BY, so a default object would be unreachable and would imply a guard
  // that does not exist — which is exactly how the NULL month went unnoticed. The
  // COALESCEs above are the guard.
  const data = (rows as any[])[0];

  return res.json({
    success: true,
    data
  });
}));

// GET /api/wfm/attendance/summary/:employeeId/:month — monthly attendance summary for specific employee/month
wfmRouter.get("/attendance/summary/:employeeId/:month", h(async (req: any, res: any) => {
  const { employeeId, month } = req.params;
  const { db } = await import("../../db/mysql.js");

  // Security: employee can only view own data unless privileged
  const { hasRole: checkRole } = await import("../../shared/accessGuard.js");
  const isPrivileged = await checkRole(
    req.authUser.id,
    "super_admin", "admin", "hr", "wfm", "manager", "branch_head", "process_manager",
    "payroll_head", "payroll_admin"
  );

  if (!isPrivileged) {
    const selfEmp = await getEmployeeForUser(req.authUser.id);
    if (!selfEmp || selfEmp.id !== employeeId) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
  }

  // Validate month format (YYYY-MM)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, error: "Invalid month format. Use YYYY-MM" });
  }

  const [rows] = await db.execute(
    `SELECT
       -- Same canon as /my-attendance above. This endpoint had the identical
       -- defects plus one of its own: presentDays counted IN ('present','late'),
       -- and 'late' is not an ENUM member, so it contributed nothing while giving
       -- the impression late arrivals were being credited as present.
       -- COALESCEd for the same reason as /my-attendance: an empty month returns one
       -- row of NULLs, never zero rows, so the default object below is unreachable.
       COALESCE(${presentSql()}, 0) AS presentDays,
       COALESCE(SUM(CASE WHEN attendance_status = '${HALF_DAY_STATUS}' THEN 1 ELSE 0 END), 0) AS halfDays,
       COALESCE(SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END), 0) AS absentDays,
       COALESCE(SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END), 0) AS lateDays,
       COALESCE(SUM(CASE WHEN attendance_status IN (${statusList(LEAVE_STATUSES)}) THEN 1 ELSE 0 END), 0) AS leaveDays,
       COALESCE(SUM(CASE WHEN attendance_status = 'holiday' THEN 1 ELSE 0 END), 0) AS holidayDays,
       COALESCE(SUM(CASE WHEN attendance_status = 'week_off' THEN 1 ELSE 0 END), 0) AS weekOffDays,
       COALESCE(SUM(COALESCE(lwp_value, 0)), 0) AS totalLwp,
       COALESCE(SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END), 0) AS lateMarks,
       COALESCE(COUNT(CASE WHEN attendance_status NOT IN (${statusList(NON_WORKING_STATUSES)}) THEN 1 END), 0) AS totalWorkingDays,
       COALESCE(${expectedToWorkSql()}, 0) AS expectedToWork,
       COALESCE(ROUND(${attendedDaysSql()} / NULLIF(${expectedToWorkSql()}, 0) * 100, 1), 0) AS attendancePct,
       COALESCE(ROUND(SUM(COALESCE(raw_minutes, 0)) / 60, 2), 0) AS totalHours,
       -- OT threshold (480 min = 8h/day) matches the existing precedent in
       -- biometric-summary.routes.ts (getGrnVendorActuals-adjacent OT reporting) rather
       -- than inventing a new definition. GREATEST(...,0) so a short day contributes 0,
       -- never a negative offset to the SUM.
       COALESCE(ROUND(SUM(GREATEST(COALESCE(raw_minutes, 0) - 480, 0)) / 60, 2), 0) AS otHours,
       -- Net Hours = worked minutes less break minutes, per day, floored at 0 before
       -- summing (a bad single day can't push the month negative). A correlated
       -- subquery rather than a JOIN on the main FROM: several break_daily_summary
       -- columns (employee_id, attendance_status, branch_id, process_id, ...) collide by
       -- name with attendance_daily_record's own, which would make every unqualified
       -- column reference above (attendance_status, work_mode, ...) ambiguous the moment
       -- a second table entered the FROM clause. Isolating the join in its own subquery
       -- leaves the rest of this query, including the shared presentSql()/statusList()
       -- helpers, untouched. break_daily_summary is a new (2026-07+) kiosk-break feature
       -- with sparse historical coverage — days with no break row simply net to their
       -- full worked minutes, which is the correct default, not a bug.
       (SELECT COALESCE(ROUND(SUM(GREATEST(
                 COALESCE(adr2.raw_minutes, 0) - COALESCE(bds.total_break_minutes, 0), 0
               )) / 60, 2), 0)
          FROM attendance_daily_record adr2
          LEFT JOIN break_daily_summary bds
            ON bds.employee_id = adr2.employee_id AND bds.shift_date = adr2.record_date
         WHERE adr2.employee_id = ?
           AND DATE_FORMAT(adr2.record_date, '%Y-%m') = ?
           AND (
             ? <> DATE_FORMAT(NOW(), '%Y-%m')
             OR adr2.record_date <= DATE(NOW())
           )
       ) AS netHours,
       COALESCE(SUM(CASE WHEN work_mode IN ('wfo', 'office') THEN 1 ELSE 0 END), 0) AS wfoDays
     FROM attendance_daily_record
     WHERE employee_id = ?
       AND DATE_FORMAT(record_date, '%Y-%m') = ?
       AND (
         ? <> DATE_FORMAT(NOW(), '%Y-%m')
         OR record_date <= DATE(NOW())
       )`,
    [employeeId, month, month, employeeId, month, month]
  );

  // Unreachable default removed — see /my-attendance above. The COALESCEs are the guard.
  const data = (rows as any[])[0];

  return res.json({
    success: true,
    data
  });
}));

// ── Week-off fairness scores ──────────────────────────────────────────────────

wfmRouter.get("/weekoff/fairness-scores", requireRole("wfm", "admin", "super_admin"), h(async (req, res) => {
  const { getFairnessScoresForWeek } = await import("./weekoff-fairness.service.js");
  const processId = String(req.query.processId ?? "");
  const weekStartDate = String(req.query.weekStartDate ?? "");
  if (!processId || !weekStartDate) {
    return res.status(400).json({ success: false, message: "processId and weekStartDate required" });
  }
  const data = await getFairnessScoresForWeek(processId, weekStartDate);
  return res.json({ success: true, data });
}));

wfmRouter.post("/weekoff/fairness-scores/compute", requireRole("wfm", "admin", "super_admin"), h(async (req, res) => {
  const { computeAndStoreFairnessScores } = await import("./weekoff-fairness.service.js");
  const { processId, weekStartDate } = req.body;
  if (!processId || !weekStartDate) {
    return res.status(400).json({ success: false, message: "processId and weekStartDate required" });
  }
  await computeAndStoreFairnessScores(processId, weekStartDate);
  return res.json({ success: true, message: "Fairness scores computed and stored" });
}));

wfmRouter.post("/weekoff/allocations/record", requireRole("wfm", "admin", "super_admin"), h(async (req, res) => {
  const { recordWeekOffAllocation } = await import("./weekoff-fairness.service.js");
  const { employeeId, processId, weekStartDate, assignedDay, exceptionReason } = req.body;
  if (!employeeId || !processId || !weekStartDate) {
    return res.status(400).json({ success: false, message: "employeeId, processId and weekStartDate required" });
  }
  await recordWeekOffAllocation(employeeId, processId, weekStartDate, assignedDay ?? null, exceptionReason);
  return res.json({ success: true, message: "Allocation recorded" });
}));

// ── Branch WFM SPOC config ────────────────────────────────────────────────────

wfmRouter.get("/branch-spoc-config", requireRole("super_admin", "admin", "wfm"), h(async (req, res) => {
  const { listSPOCConfigs } = await import("./branch-wfm-spoc.service.js");
  const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
  const data = await listSPOCConfigs(branchId);
  return res.json({ success: true, data });
}));

wfmRouter.post("/branch-spoc-config", requireRole("super_admin", "admin"), h(async (req, res) => {
  const { createSPOCConfig } = await import("./branch-wfm-spoc.service.js");
  const { branch_id, primary_spoc_user_id, backup_spoc_user_id, effective_from, effective_to } = req.body;
  if (!branch_id || !primary_spoc_user_id || !effective_from) {
    return res.status(400).json({ success: false, message: "branch_id, primary_spoc_user_id and effective_from required" });
  }
  const id = await createSPOCConfig(
    { branch_id, primary_spoc_user_id, backup_spoc_user_id: backup_spoc_user_id ?? null, effective_from, effective_to: effective_to ?? null },
    String(req.authUser.id),
  );
  return res.status(201).json({ success: true, id });
}));

wfmRouter.patch("/branch-spoc-config/:id", requireRole("super_admin", "admin"), h(async (req, res) => {
  const { updateSPOCConfig } = await import("./branch-wfm-spoc.service.js");
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  await updateSPOCConfig(id, req.body);
  return res.json({ success: true });
}));

// ─── G12 week_off_worked historical impact simulator (read-only) ─────────────
//
// GET /api/wfm/wow-impact-simulator
//   Returns ALL affected employee-dates (locked and unlocked, any run status).
//   Query params: from=YYYY-MM-DD&to=YYYY-MM-DD (default 2026-01-01 .. yesterday)
//
// GET /api/wfm/wow-impact-simulator/finalized
//   Returns only rows that fell inside a finalized/disbursed/locked payroll run.
//   These require explicit Payroll Head approval before any reprocessing.
//
// Both endpoints are read-only; no attendance row is written or modified.
// Restricted to payroll_head, admin and super_admin to avoid exposing gross
// salary data to non-payroll roles.

wfmRouter.get("/wow-impact-simulator", requireRole("super_admin", "admin", "hr", "payroll_head"), h(async (req, res) => {
  const { simulateWowImpact } = await import("./weekoff-worked-impact-simulator.service.js");
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to   = typeof req.query.to   === "string" ? req.query.to   : undefined;
  const result = await simulateWowImpact(from, to);
  return res.json({ success: true, data: result });
}));

wfmRouter.get("/wow-impact-simulator/finalized", requireRole("super_admin", "admin", "payroll_head"), h(async (req, res) => {
  const { simulateWowFinalizedImpact } = await import("./weekoff-worked-impact-simulator.service.js");
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to   = typeof req.query.to   === "string" ? req.query.to   : undefined;
  const result = await simulateWowFinalizedImpact(from, to);
  return res.json({ success: true, data: result });
}));
