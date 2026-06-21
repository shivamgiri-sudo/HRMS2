import { Router } from "express";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { employeeController as c } from "./employee.controller.js";
import { appendJourneyEvent, listJourneyEvents } from "./journeyLog.service.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { employeeProfileService } from "./employee.profile.service.js";
import {
  bankDetailsSchema,
  nomineeSchema,
  emergencyContactSchema,
  statutoryDetailsSchema,
} from "./employee.profile.validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, "../../../uploads");

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h3 = (fn: (req: any, res: any, next: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res, next).catch(next);

router.use(requireAuth);

// GET /api/employees/me — returns the employee record for the logged-in user (with joined master data)
router.get("/me", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
            e.id, e.employee_code, e.user_id,
            e.first_name, e.last_name,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS full_name,
            e.email,
            e.mobile         AS phone,
            e.photo_url      AS avatar_url,
            e.gender,
            e.date_of_birth,
            e.date_of_joining AS hire_date,
            e.employment_status AS status,
            e.employment_type,
            e.active_status,
            e.branch_id, e.department_id, e.process_id, e.designation_id,
            e.reporting_manager_id,
            e.address1 AS address, e.address2, e.city, e.state, e.pincode,
            e.blood_group, e.father_name, e.office_email,
            e.bank_account_number, e.bank_name, e.bank_branch, e.ifsc_code,
            e.account_holder_name, e.account_type,
            e.nominee_name, e.nominee_relation,
            e.uan_number,
            e.epf_number, e.esic_number,
            e.ctc, e.gross_salary, e.net_inhand,
            e.aadhaar_number, e.aadhaar_last4,
            e.emp_type, e.billable_status, e.cost_center_code,
            e.biometric_code, e.legacy_emp_id,
            e.created_at, e.updated_at,
            dm.designation_name  AS designation,
            dept.dept_name       AS department_name,
            b.branch_name,
            p.process_name,
            mgr.first_name       AS manager_first_name,
            mgr.last_name        AS manager_last_name
       FROM employees e
       LEFT JOIN designation_master dm   ON dm.id   = e.designation_id
       LEFT JOIN department_master  dept ON dept.id = e.department_id
       LEFT JOIN branch_master      b    ON b.id    = e.branch_id
       LEFT JOIN process_master     p    ON p.id    = e.process_id
       LEFT JOIN employees          mgr  ON mgr.id  = e.reporting_manager_id
      WHERE e.user_id = ? AND e.active_status = 1 LIMIT 1`,
    [userId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record for this user" });
  const emp: any = rows[0];
  emp.department = emp.department_name ? { name: emp.department_name } : null;
  emp.reporting_manager = (emp.manager_first_name || emp.manager_last_name)
    ? `${emp.manager_first_name ?? ''} ${emp.manager_last_name ?? ''}`.trim()
    : null;
  return res.json({ success: true, data: emp });
}));

// GET /api/employees/stats — aggregate counts (must be before /:id to avoid route collision)
router.get("/stats", requireRole("admin", "hr", "manager", "ceo"), h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_employees,
       COUNT(CASE WHEN LOWER(employment_status) = 'active' THEN 1 END) AS active_employees,
       COUNT(CASE WHEN DATEDIFF(NOW(), date_of_joining) <= 90 THEN 1 END) AS new_joiners_90d
     FROM employees WHERE active_status = 1`
  );
  res.json({ data: rows[0] });
}));

// GET /api/employees/directory-masters — process/branch master lists with counts
router.get("/directory-masters", requireRole("admin", "hr", "manager"), h(async (_req: any, res: any) => {
  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT p.id, p.process_name, COUNT(e.id) AS employee_count
       FROM process_master p
       LEFT JOIN employees e ON e.process_id = p.id AND e.active_status = 1
      WHERE p.active_status = 1
      GROUP BY p.id, p.process_name
      ORDER BY p.process_name`
  );
  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.branch_name, COUNT(e.id) AS employee_count
       FROM branch_master b
       LEFT JOIN employees e ON e.branch_id = b.id AND e.active_status = 1
      WHERE b.active_status = 1
      GROUP BY b.id, b.branch_name
      ORDER BY b.branch_name`
  );
  return res.json({ data: { processes, branches } });
}));

// GET /api/employees/options/search — lightweight search for autocomplete
router.get("/options/search", requireAuth, h(async (req: any, res: any) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Number(req.query.limit) || 8, 50);
  if (q.length < 2) return res.json({ success: true, data: [] });
  const pattern = `%${q}%`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS name,
            e.first_name, e.last_name
       FROM employees e
      WHERE e.active_status = 1
        AND (CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) LIKE ? OR e.employee_code LIKE ?)
      ORDER BY e.first_name
      LIMIT ?`,
    [pattern, pattern, limit]
  );
  return res.json({ success: true, data: rows });
}));

router.get("/", requireRole("admin", "hr", "manager"), h(async (req, res) => {
  const userId = req.authUser!.id;
  let scoped: { sql: string; params: unknown[] };
  try {
    // super_admin sees all branches unconditionally
    const isSuperAdmin = await hasRole(userId, "super_admin");
    if (isSuperAdmin) {
      scoped = { sql: "1=1", params: [] };
    } else {
      // admin/hr/finance/payroll at HEAD OFFICE branch see all branches
      // Everyone else (including admin/hr) sees only their assigned scope
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT e.branch_id, bm.branch_name
           FROM employees e
           JOIN branch_master bm ON bm.id = e.branch_id
          WHERE e.user_id = ? AND e.active_status = 1
          LIMIT 1`,
        [userId]
      );
      const empBranch = (empRows[0] as any)?.branch_name ?? "";
      const isHeadOffice = /head\s*office/i.test(empBranch);

      if (isHeadOffice && await hasRole(userId, "admin", "hr", "finance", "payroll")) {
        scoped = { sql: "1=1", params: [] };
      } else {
        scoped = await buildScopeWhereClause(
          userId,
          ["admin", "hr", "manager"],
          {
            branchId: "e.branch_id",
            processId: "e.process_id",
            departmentId: "e.department_id",
            managerEmployeeId: "e.reporting_manager_id"
          },
          { allowCeoAllRead: true }
        );
        // manager with no scope assignment: degrade to direct reports
        if (scoped.sql === "1=0") {
          const emp = await getEmployeeForUser(userId);
          if (emp) {
            scoped = { sql: "e.reporting_manager_id = ?", params: [emp.id] };
          }
        }
      }
    }
  } catch (_err) {
    scoped = { sql: "1=1", params: [] };
  }

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
router.get("/:id", h(async (req: any, res: any) => {
  const userId = req.authUser!.id;
  const targetId = req.params.id;
  const isPrivileged = await hasRole(userId, 'admin', 'hr', 'manager');
  if (!isPrivileged) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== targetId) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
  }
  return c.getEmployee(req, res);
}));

// PATCH /api/employees/me — employee self-service (whitelisted fields only)
router.patch("/me", h((req: any, res: any) => c.updateMyProfile(req, res)));

// POST /api/employees/me/photo — upload profile photo
const profilePhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(UPLOADS_ROOT, "employee-photos");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for profile photos
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed. Use JPG, PNG, or WebP.`));
  },
});

router.post("/me/photo", (req: any, res: any, next: any) => {
  profilePhotoUpload.single("photo")(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, h(async (req: any, res: any) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No photo uploaded" });

  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, photo_url FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record" });

  const empId = rows[0].id;
  const oldPhotoUrl = rows[0].photo_url;

  if (oldPhotoUrl) {
    try {
      const oldFilename = oldPhotoUrl.split("/").pop();
      if (oldFilename) {
        const oldPath = path.join(UPLOADS_ROOT, "employee-photos", oldFilename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    } catch (err) {
      console.warn("Failed to delete old profile photo:", err);
    }
  }

  const photoUrl = `/api/files/employee-photos/${req.file.filename}`;

  // Retry logic for lock timeouts (common during concurrent updates)
  let retries = 3;
  while (retries > 0) {
    try {
      await db.execute(
        "UPDATE employees SET photo_url = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?",
        [photoUrl, photoUrl, empId]
      );
      break;
    } catch (e: any) {
      retries--;
      if (retries === 0 || !e.message.includes('Lock wait timeout')) throw e;
      await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
    }
  }

  res.json({ success: true, avatarUrl: photoUrl, photoUrl, photo_url: photoUrl, url: photoUrl });
}));

router.delete("/me/photo", h(async (req: any, res: any) => {
  const userId = req.authUser?.id;
  if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, photo_url FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "No employee record" });

  const photoUrl = String(rows[0].photo_url ?? "");
  if (photoUrl) {
    try {
      const filename = photoUrl.split("/").pop();
      if (filename) {
        const filePath = path.join(UPLOADS_ROOT, "employee-photos", filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn("Failed to delete photo file:", err);
    }
  }

  await db.execute("UPDATE employees SET photo_url = NULL, avatar_url = NULL, updated_at = NOW() WHERE id = ?", [rows[0].id]);
  res.json({ success: true });
}));

router.patch("/:id",
  requireRole("admin", "hr"),
  requireScopedRole(["hr"], async (req) => {
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
  h(async (req: any, res: any) => {
    // salary_start_date is a payroll-sensitive field — restrict to super_admin, admin, branch_hr, payroll_hr
    const hasSalaryStartDate = req.body?.salaryStartDate !== undefined
      || req.body?.salary_start_date !== undefined;
    if (hasSalaryStartDate) {
      const allowed = await hasRole(req.authUser!.id, "super_admin", "admin", "branch_hr", "payroll_hr");
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "salary_start_date can only be set by Admin, Branch HR, or Payroll HR"
        });
      }
    }
    return c.updateEmployee(req, res);
  })
);
router.delete("/:id", requireRole("admin"), h(c.deactivateEmployee));

// Profile sensitive data PUT routes
router.put("/me/bank-details", requireAuth, h3(async (req: any, res: any, next: any) => {
  try {
    const validated = bankDetailsSchema.parse(req.body);
    const result = await employeeProfileService.saveBankDetails(req.authUser!.id, validated);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}));

router.put("/me/nominee", requireAuth, h3(async (req: any, res: any, next: any) => {
  try {
    const validated = nomineeSchema.parse(req.body);
    const result = await employeeProfileService.saveNominee(req.authUser!.id, validated);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}));

router.put("/me/emergency-contact", requireAuth, h3(async (req: any, res: any, next: any) => {
  try {
    const validated = emergencyContactSchema.parse(req.body);
    const result = await employeeProfileService.saveEmergencyContact(req.authUser!.id, validated);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}));

router.put("/me/statutory-details", requireAuth, h3(async (req: any, res: any, next: any) => {
  try {
    const validated = statutoryDetailsSchema.parse(req.body);
    const result = await employeeProfileService.saveStatutoryDetails(req.authUser!.id, validated);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}));

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

// GET /api/employees/:id/ctc — salary assignment for payslip CTC card
router.get("/:id/ctc", requireAuth, h(async (req: any, res: any) => {
  const targetId = req.params.id;
  const isSelf = (await getEmployeeForUser(req.authUser!.id))?.id === targetId;
  const isPrivileged = await hasRole(req.authUser!.id, "admin", "hr", "payroll_hr", "finance");
  if (!isSelf && !isPrivileged) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.ctc_annual, e.ctc AS monthly_ctc
       FROM employees e
       LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      WHERE e.id = ? LIMIT 1`,
    [targetId]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: "Not found" });
  const row = rows[0] as any;
  // ctc_annual is the true annual CTC; fallback: e.ctc * 12 (e.ctc stores monthly)
  const ctcAnnual = row.ctc_annual ?? (row.monthly_ctc ? row.monthly_ctc * 12 : null);
  return res.json({ success: true, data: { ctc: ctcAnnual } });
}));

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
