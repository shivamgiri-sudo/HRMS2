import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { employeeController as c } from "./employee.controller.js";
import { appendJourneyEvent, listJourneyEvents } from "./journeyLog.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /api/employees/me — returns the employee record for the logged-in user
router.get("/me", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute(
    "SELECT * FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  return res.json({ success: true, data: rows[0] });
}));

// GET /api/employees/stats — aggregate counts (must be before /:id to avoid route collision)
router.get("/stats", h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_employees,
       COUNT(CASE WHEN employment_status = 'active' THEN 1 END) AS active_employees,
       COUNT(CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
     FROM employees WHERE active_status = 1`
  );
  res.json({ data: rows[0] });
}));

router.get("/", h(c.listEmployees));
router.post("/", h(c.createEmployee));
router.get("/:id", h(c.getEmployee));
router.patch("/:id", h(c.updateEmployee));
router.delete("/:id", h(c.deactivateEmployee));

// Journey log
router.get("/:id/journey", async (req: any, res: any, next: any) => {
  try {
    const data = await listJourneyEvents(req.params.id, {
      module:    req.query.module    as string | undefined,
      eventType: req.query.eventType as string | undefined,
      fromDate:  req.query.fromDate  as string | undefined,
      toDate:    req.query.toDate    as string | undefined,
    });
    return res.json({ success: true, data });
  } catch (err) { next(err); }
});

router.post("/:id/journey", async (req: any, res: any, next: any) => {
  try {
    const b = req.body;
    if (!b.eventType || !b.eventDate) {
      return res.status(400).json({ success: false, message: "eventType and eventDate required" });
    }
    const data = await appendJourneyEvent({
      employeeId:  req.params.id,
      eventType:   b.eventType,
      eventDate:   b.eventDate,
      description: b.description,
      oldValue:    b.oldValue,
      newValue:    b.newValue,
      module:      b.module,
      triggeredBy: req.authUser?.id,
      metadata:    b.metadata,
    });
    return res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
});

// GET /api/employees/:id/stat-card — comprehensive employee profile aggregate
router.get("/:id/stat-card", requireAuth, h(async (req: any, res: any) => {
  const { db } = await import("../../db/mysql.js");
  const targetId = req.params.id;
  const isAdminOrHR = await hasRole(req.authUser!.id, "admin", "hr", "ceo");
  const selfEmp = await getEmployeeForUser(req.authUser!.id);

  // Access check: admin/hr/ceo can view all; others can only view own
  if (!isAdminOrHR && selfEmp?.id !== targetId) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Core employee with joined master data
  const [[emp]] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            d.designation_name, b.branch_name, b.call_centre_code,
            p.process_name, dept.dept_name,
            DATEDIFF(NOW(), e.date_of_joining) AS days_employed
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
      WHERE e.id = ? LIMIT 1`,
    [targetId]
  );
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  // Leave balances (all types for current year)
  let leaveBalances: RowDataPacket[] = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT lbl.leave_code, lt.leave_name,
              lbl.opening_balance + lbl.accrued_days - lbl.used_days AS available_days,
              lbl.used_days
         FROM leave_balance_ledger lbl
         LEFT JOIN leave_type_master lt ON lt.leave_code = lbl.leave_code
        WHERE lbl.employee_id = ? AND YEAR(lbl.valid_for) = YEAR(NOW())`,
      [targetId]
    );
    leaveBalances = rows;
  } catch (_e) { /* table may not exist yet */ }

  // Attendance this month
  let attendance = { present_days: 0, working_days: 0, attendance_pct: null as number | null };
  try {
    const [attRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(CASE WHEN attendance_status = 'present' THEN 1 END) AS present_days,
         COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END) AS working_days,
         ROUND(
           COUNT(CASE WHEN attendance_status = 'present' THEN 1 END) * 100.0 /
           NULLIF(COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END), 0),
         1) AS attendance_pct
       FROM attendance_daily_record
      WHERE employee_id = ? AND YEAR(record_date) = YEAR(NOW()) AND MONTH(record_date) = MONTH(NOW())`,
      [targetId]
    );
    if (attRows[0]) attendance = attRows[0] as any;
  } catch (_e) { /* table may not exist yet */ }

  // Latest performance rating
  let performance: RowDataPacket | null = null;
  try {
    const [perfRows] = await db.execute<RowDataPacket[]>(
      `SELECT pfr.overall_score, pfc.period
         FROM performance_feedback_report pfr
         JOIN performance_feedback_request pfq ON pfq.request_id = pfr.request_id
         JOIN performance_feedback_cycle pfc ON pfc.cycle_id = pfq.cycle_id
        WHERE pfq.employee_id = ?
        ORDER BY pfr.created_at DESC LIMIT 1`,
      [targetId]
    );
    performance = perfRows[0] ?? null;
  } catch (_e) { /* table may not exist yet */ }

  // Active assets
  let activeAssets = 0;
  try {
    const [assetRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active_assets FROM asset_assignment WHERE employee_id = ? AND return_date IS NULL`,
      [targetId]
    );
    activeAssets = Number(assetRows[0]?.active_assets ?? 0);
  } catch (_e) { /* table may not exist yet */ }

  // Pending documents
  let pendingDocs = 0;
  try {
    const [docRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS pending_docs FROM employee_documents WHERE employee_id = ? AND verified = 0`,
      [targetId]
    );
    pendingDocs = Number(docRows[0]?.pending_docs ?? 0);
  } catch (_e) { /* table may not exist yet */ }

  // Gamification tier
  let gamificationTier: RowDataPacket | null = null;
  try {
    const [tierRows] = await db.execute<RowDataPacket[]>(
      `SELECT ets.tier_name, ets.total_points
         FROM employee_tier_status ets
        WHERE ets.employee_id = ? LIMIT 1`,
      [targetId]
    );
    gamificationTier = tierRows[0] ?? null;
  } catch (_e) { /* table may not exist yet */ }

  // Journey events (last 20)
  let journey: RowDataPacket[] = [];
  try {
    const [journeyRows] = await db.execute<RowDataPacket[]>(
      `SELECT event_type, event_date, description, module
         FROM employee_journey_log
        WHERE employee_id = ?
        ORDER BY event_date DESC LIMIT 20`,
      [targetId]
    );
    journey = journeyRows;
  } catch (_e) { /* table may not exist yet */ }

  return res.json({
    data: {
      employee: emp,
      leave_balances: leaveBalances,
      attendance,
      performance,
      active_assets: activeAssets,
      pending_docs: pendingDocs,
      gamification_tier: gamificationTier,
      journey,
    }
  });
}));

export { router as employeeRouter };
