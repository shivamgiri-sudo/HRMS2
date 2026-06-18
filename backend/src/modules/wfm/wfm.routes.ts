import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { wfmController } from "./wfm.controller.js";
import { wfmService } from "./wfm.service.js";
import { getLiveTracker } from "./liveTracker.service.js";
import { rosterPreferenceService } from "./roster-preference.service.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

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
wfmRouter.get("/live", requireRole("admin", "wfm", "manager"), async (req: any, res: any, next: any) => {
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

// GET /api/wfm/attendance/day-detail/:employeeId/:date
// Combined attendance + COSEC daily aggregate + individual punches for one employee on one date
wfmRouter.get(
  "/attendance/day-detail/:employeeId/:date",
  requireRole("admin", "hr", "wfm", "manager", "ceo", "finance", "payroll"),
  h(async (req: any, res: any) => {
    const { employeeId, date } = req.params;

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
                bal.first_punch,
                bal.last_punch,
                bal.biometric_minutes AS bio_minutes_log
           FROM attendance_daily_record adr
           JOIN employees e ON e.id = adr.employee_id
           LEFT JOIN biometric_attendance_log bal
             ON bal.employee_id = adr.employee_id AND DATE(bal.attendance_date) = adr.record_date
          WHERE adr.employee_id = ? AND adr.record_date = ?
          LIMIT 1`,
        [employeeId, date]
      ),
      // 2. COSEC daily aggregate (authoritative work minutes)
      dbConn.execute(
        `SELECT *
           FROM cosec_daily_agg
          WHERE employee_id = ? AND work_date = ?
          LIMIT 1`,
        [employeeId, date]
      ),
      // 3. Individual punch events — handle night shift (prev-day punches before 06:00)
      dbConn.execute(
        `SELECT punch_time, io_type,
                CASE io_type WHEN 'I' THEN 'In' WHEN 'O' THEN 'Out' ELSE io_type END AS io_label,
                device_id
           FROM cosec_punch_sync
          WHERE employee_id = ?
            AND (
              DATE(punch_time) = ?
              -- include early-morning tail-end punches: prev calendar day midnight–06:00 that belong to prior night shift
              OR (DATE(punch_time) = DATE_SUB(?, INTERVAL 1 DAY) AND TIME(punch_time) < '06:00:00')
            )
          ORDER BY punch_time ASC`,
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
