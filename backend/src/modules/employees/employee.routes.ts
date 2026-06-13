import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { employeeController as c } from "./employee.controller.js";
import { appendJourneyEvent, listJourneyEvents } from "./journeyLog.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.resolve(__dirname, "../../../uploads/employee-photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
  filename: (req: any, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    // filename = employeeId so it naturally overwrites the old photo
    const empId = req.params.id ?? req.authEmployee?.id ?? "unknown";
    cb(null, `${empId}${ext}`);
  },
});

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([".jpg", ".jpeg", ".png", ".webp"]);
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.has(ext)) cb(null, true);
    else cb(new Error("Only JPG, PNG, or WebP images are allowed"));
  },
});

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
    `SELECT e.*,
            COALESCE(CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')), '') AS reporting_manager_name,
            dept.dept_name AS department_name,
            desig.designation_name AS designation
     FROM employees e
     LEFT JOIN employees m ON m.id = e.reporting_manager_id
     LEFT JOIN department_master dept ON dept.id = e.department_id
     LEFT JOIN designation_master desig ON desig.id = e.designation_id
     WHERE e.user_id = ? AND e.active_status = 1
     LIMIT 1`,
    [userId]
  ) as any[];
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });

  // Transform DB fields to match frontend expectations
  const employee = rows[0];
  const transformed = {
    ...employee,
    // Map mobile to phone
    phone: employee.mobile || null,
    // Map address1 to address
    address: employee.address1 || null,
    // country column now exists in DB
    country: employee.country || null,
    // Convert gender to lowercase for frontend Select component
    gender: employee.gender ? String(employee.gender).toLowerCase() : null,
    // Parse working_days JSON if it's a string
    working_days: employee.working_days
      ? (typeof employee.working_days === 'string' ? JSON.parse(employee.working_days) : employee.working_days)
      : null,
    // Add department object structure
    department: employee.department_name ? { name: employee.department_name } : null,
    // Keep date_of_joining as hire_date for compatibility
    hire_date: employee.date_of_joining,
  };

  return res.json({ success: true, data: transformed });
}));

// PATCH /api/employees/me — update own profile (employee self-service)
router.patch("/me", h(c.updateMyProfile));

// GET /api/employees/me/journey — employee views their own journey timeline
router.get("/me/journey", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const { db } = await import("../../db/mysql.js");
  const [empRows] = await db.execute(
    "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  ) as any[];
  if (!empRows.length) return res.status(404).json({ success: false, error: "No employee record" });
  const data = await listJourneyEvents(empRows[0].id);
  return res.json({ success: true, data });
}));

// POST /api/employees/me/photo — employee uploads their own photo
router.post("/me/photo", (req: any, res: any, next: any) => {
  photoUpload.single("photo")(req, res, (err: any) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ success: false, error: err.message });
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, h(async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No image uploaded" });
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ success: false, error: "No employee record" });

  // Rename file to use employeeId (multer may have used 'unknown' if :id wasn't in path)
  const ext = path.extname(req.file.filename);
  const finalName = `${emp.id}${ext}`;
  const finalPath = path.join(PHOTOS_DIR, finalName);
  if (req.file.path !== finalPath) {
    fs.renameSync(req.file.path, finalPath);
  }

  const avatarUrl = `/api/files/employee-photos/${finalName}`;
  await db.execute(`UPDATE employees SET avatar_url = ? WHERE id = ?`, [avatarUrl, emp.id]);
  return res.json({ success: true, avatarUrl });
}));

// POST /api/employees/:id/photo — admin/HR uploads photo for any employee
router.post("/:id/photo", requireRole("admin", "hr"), (req: any, res: any, next: any) => {
  photoUpload.single("photo")(req, res, (err: any) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ success: false, error: err.message });
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, h(async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No image uploaded" });
  const empId = req.params.id;

  // Ensure the employee exists
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE id = ? LIMIT 1`, [empId]
  );
  if (!(rows as any[]).length) return res.status(404).json({ success: false, error: "Employee not found" });

  // Rename to final empId-based name (multer already used req.params.id for filename)
  const ext = path.extname(req.file.filename);
  const finalName = `${empId}${ext}`;
  const finalPath = path.join(PHOTOS_DIR, finalName);
  if (req.file.path !== finalPath) {
    try { fs.renameSync(req.file.path, finalPath); } catch { /* already correct name */ }
  }

  const avatarUrl = `/api/files/employee-photos/${finalName}`;
  await db.execute(`UPDATE employees SET avatar_url = ? WHERE id = ?`, [avatarUrl, empId]);
  return res.json({ success: true, avatarUrl });
}));

// DELETE /api/employees/:id/photo — admin/HR removes photo
router.delete("/:id/photo", requireRole("admin", "hr"), h(async (req: any, res: any) => {
  const empId = req.params.id;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT avatar_url FROM employees WHERE id = ? LIMIT 1`, [empId]
  );
  const url: string = (rows as any[])[0]?.avatar_url ?? "";
  if (url) {
    const filename = path.basename(url);
    const filePath = path.join(PHOTOS_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await db.execute(`UPDATE employees SET avatar_url = NULL WHERE id = ?`, [empId]);
  }
  return res.json({ success: true });
}));

// GET /api/employees/stats — aggregate counts (must be before /:id to avoid route collision)
router.get("/stats", requireRole("admin", "hr", "manager", "ceo"), h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_employees,
       COUNT(CASE WHEN employment_status = 'active' THEN 1 END) AS active_employees,
       COUNT(CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
     FROM employees WHERE active_status = 1`
  );
  res.json({ data: rows[0] });
}));

// GET /api/employees/my-team — returns active direct reports of the logged-in user's employee record
router.get("/my-team", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [userId]
  );
  const managerEmpId = (empRows as any[])[0]?.id;
  if (!managerEmpId) return res.json({ success: true, data: [] });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name,
            e.department_id, e.designation_id, e.process_id, e.cost_centre_id,
            dm.dept_name, desm.designation_name, pm.process_name
     FROM employees e
     LEFT JOIN department_master  dm   ON dm.id   = e.department_id
     LEFT JOIN designation_master desm ON desm.id  = e.designation_id
     LEFT JOIN process_master     pm   ON pm.id    = e.process_id
     WHERE e.reporting_manager_id = ? AND e.active_status = 1
     ORDER BY full_name`,
    [managerEmpId]
  );
  return res.json({ success: true, data: rows });
}));

router.get("/", requireRole("admin", "hr", "manager"), h(async (req, res) => {
  // Apply scope filtering
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager"],
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id"
    },
    { allowCeoAllRead: true }
  );

  // Pass scope SQL to controller (will need service update for proper integration)
  (req as any).scopeFilter = scoped;
  return c.listEmployees(req, res);
}));
router.post("/",
  requireRole("admin", "hr"),
  requireScopedRole(["hr"], async (req) => ({
    branchId: req.body.branch_id,
    processId: req.body.process_id,
    departmentId: req.body.department_id
  })),
  h(c.createEmployee)
);
router.get("/:id", requireRole("admin", "hr", "manager"), h(c.getEmployee));  // TODO: Add self-scope check
router.patch("/:id",
  requireRole("admin", "hr"),
  requireScopedRole(["hr"], async (req) => {
    // Resolve employee's branch/process from DB
    const [rows] = await db.execute(
      'SELECT branch_id, process_id, department_id FROM employees WHERE id = ? LIMIT 1',
      [req.params.id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id,
      departmentId: emp?.department_id
    };
  }),
  h(c.updateEmployee)
);
router.delete("/:id", requireRole("admin"), h(c.deactivateEmployee));

// Journey log
router.get("/:id/journey", requireRole("admin", "hr", "manager"), async (req: any, res: any, next: any) => {
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

router.post("/:id/journey", requireRole("admin", "hr"), async (req: any, res: any, next: any) => {
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
