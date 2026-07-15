import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { listComprehensiveJourney } from "./journeyLog.service.js";
import { getBillPool } from "../../db/billDb.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

type EmployeeAccessTarget = {
  id: string;
  user_id: string | null;
  branch_id: string | null;
  process_id: string | null;
  lob_id: string | null;
  department_id: string | null;
  reporting_manager_id: string | null;
  manager_id: string | null;
};

const PEOPLE_SCOPE_ROLES = ["hr", "manager", "branch_head", "process_manager", "assistant_manager", "tl"];
const STAT_CARD_SCOPE_ROLES = [...PEOPLE_SCOPE_ROLES, "finance", "payroll"];
const UUID_ROUTE = "/:id([0-9a-fA-F-]{36})";

async function getEmployeeTarget(employeeId: string): Promise<EmployeeAccessTarget | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, user_id, branch_id, process_id, lob_id, department_id, reporting_manager_id, manager_id
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  return (rows as EmployeeAccessTarget[])[0] ?? null;
}

async function canAccessEmployee(userId: string, target: EmployeeAccessTarget, scopedRoles: string[]): Promise<boolean> {
  if (await hasAnyRole(userId, "admin", "ceo")) return true;

  const self = await getEmployeeForUser(userId);
  if (self?.id === target.id) return true;

  const targetManagerId = target.reporting_manager_id ?? target.manager_id ?? null;
  if (self?.id && targetManagerId === self.id) return true;

  return hasScopedAccess(
    userId,
    scopedRoles,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: targetManagerId,
      employeeId: target.id,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

async function assertEmployeeAccess(userId: string, employeeId: string, scopedRoles = PEOPLE_SCOPE_ROLES): Promise<EmployeeAccessTarget> {
  const target = await getEmployeeTarget(employeeId);
  if (!target) {
    const err = new Error("Employee not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (!(await canAccessEmployee(userId, target, scopedRoles))) {
    const err = new Error("Forbidden: employee is outside your assigned scope") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  return target;
}

async function employeeScopeWhere(userId: string) {
  return buildScopeWhereClause(
    userId,
    PEOPLE_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
}

router.get("/stats", h(async (req: any, res: any) => {
  const userId = req.authUser!.id;
  const scoped = await employeeScopeWhere(userId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total_employees,
       COUNT(CASE WHEN e.active_status = 1 AND LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive','terminated','offboarded','absconded','resigned','left','separated') THEN 1 END) AS active_employees,
       COUNT(CASE WHEN LOWER(COALESCE(e.employment_status, '')) IN ('inactive','terminated','offboarded','absconded','resigned','left','separated') THEN 1 END) AS inactive_employees,
       COUNT(CASE WHEN e.date_of_joining >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 1 END) AS new_joiners_90d
       FROM employees e
      WHERE (${scoped.sql})`,
    scoped.params,
  );
  return res.json({ success: true, data: rows[0] });
}));

router.get("/directory-masters", h(async (req: any, res: any) => {
  const userId = req.authUser!.id;
  const scoped = await employeeScopeWhere(userId);
  const activeEmployeeWhere = `
    e.active_status = 1
    OR LOWER(COALESCE(e.employment_status, '')) IN ('inactive', 'terminated', 'offboarded', 'absconded', 'resigned', 'left', 'separated')
  `;

  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT MIN(p.id) AS id,
            p.process_name,
            COUNT(*) AS employee_count
       FROM employees e
       JOIN process_master p ON p.id = e.process_id
      WHERE (${activeEmployeeWhere})
        AND (${scoped.sql})
        AND TRIM(COALESCE(p.process_name, '')) <> ''
      GROUP BY LOWER(TRIM(p.process_name)), p.process_name
      ORDER BY p.process_name ASC`,
    scoped.params,
  );

  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT MIN(b.id) AS id,
            b.branch_name,
            COUNT(*) AS employee_count
       FROM employees e
       JOIN branch_master b ON b.id = e.branch_id
      WHERE (${activeEmployeeWhere})
        AND (${scoped.sql})
        AND TRIM(COALESCE(b.branch_name, '')) <> ''
      GROUP BY LOWER(TRIM(b.branch_name)), b.branch_name
      ORDER BY b.branch_name ASC`,
    scoped.params,
  );

  return res.json({ success: true, data: { processes, branches } });
}));

router.get("/options/search", h(async (req: any, res: any) => {
  const userId = req.authUser!.id;
  const search = String(req.query.q ?? "").trim();
  if (search.length < 1) return res.json({ success: true, data: [] });

  const limit = Math.min(Math.max(Number(req.query.limit ?? 30), 1), 50);
  const like = `%${search}%`;
  const scoped = await employeeScopeWhere(userId);
  const self = await getEmployeeForUser(userId);
  const selfClause = self?.id ? " OR e.id = ?" : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS name,
            e.first_name,
            e.last_name,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name
       FROM employees e
      WHERE e.active_status = 1
        AND ((${scoped.sql})${selfClause})
        AND (
          COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) LIKE ?
          OR e.employee_code LIKE ?
          OR COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email, '') LIKE ?
        )
      ORDER BY CASE WHEN e.employee_code = ? THEN 0 ELSE 1 END, name
      LIMIT ${limit}`,
    [...scoped.params, ...(self?.id ? [self.id] : []), like, like, like, search],
  );
  return res.json({ success: true, data: rows });
}));

router.get(`${UUID_ROUTE}/stat-card`, h(async (req: any, res: any) => {
  const userId = req.authUser!.id;
  const targetId = String(req.params.id);
  await assertEmployeeAccess(userId, targetId, STAT_CARD_SCOPE_ROLES);

  const isPrivilegedForComp = await hasAnyRole(userId, "admin", "hr", "ceo", "finance", "payroll");
  const selfEmp = await getEmployeeForUser(userId);
  const canSeeCompensation = isPrivilegedForComp || selfEmp?.id === targetId;

  const [[emp]] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.user_id, e.first_name, e.last_name,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS full_name,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS email,
            e.mobile, e.alternate_mobile, e.gender, e.marital_status,
            e.date_of_birth, e.date_of_joining, e.date_of_exit,
            e.employment_type, e.employee_category, e.employment_status,
            e.branch_id, e.department_id, e.process_id, e.designation_id,
            e.grade_id, e.cost_centre_id, e.reporting_manager_id, e.working_hours_start,
            e.working_hours_end, e.working_days, e.active_status,
            e.photo_url, e.avatar_url, e.blood_group, e.city, e.state,
            e.country, e.pincode,
            d.designation_name, b.branch_name, b.call_centre_code,
            p.process_name, dept.dept_name, cc.cost_centre_name,
            eec.name AS emergency_name,
            eec.relationship AS emergency_relationship,
            eec.mobile AS emergency_mobile,
            eec.address AS emergency_address,
            COALESCE(
              NULLIF(TRIM(CONCAT(manager.first_name, ' ', COALESCE(manager.last_name, ''))), ''),
              manager.full_name
            ) AS reporting_manager_name,
            DATEDIFF(NOW(), e.date_of_joining) AS days_employed
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN employees manager ON manager.id = COALESCE(e.reporting_manager_id, e.manager_id)
       LEFT JOIN employee_emergency_contact eec
         ON eec.employee_id = e.id
        AND eec.id = (
          SELECT ec2.id
            FROM employee_emergency_contact ec2
           WHERE ec2.employee_id = e.id
           ORDER BY COALESCE(ec2.is_primary, 0) DESC, COALESCE(ec2.contact_seq, 1) ASC, ec2.created_at ASC
           LIMIT 1
        )
      WHERE e.id = ?
      LIMIT 1`,
    [targetId],
  );
  if (!emp) return res.status(404).json({ success: false, error: "Employee not found" });

  let salary: RowDataPacket | null = null;
  if (canSeeCompensation) {
    const [salaryRows] = await db.execute<RowDataPacket[]>(
      `SELECT esa.id,
              esa.structure_id,
              ssm.structure_code,
              ssm.structure_name,
              esa.ctc_annual,
              ROUND(esa.ctc_annual / 12, 2) AS monthly_ctc,
              ROUND((esa.ctc_annual / 12) * ssm.basic_pct / 100, 2) AS basic,
              ROUND((esa.ctc_annual / 12) * ssm.hra_pct / 100, 2) AS hra,
              ROUND(
                (esa.ctc_annual / 12)
                - ((esa.ctc_annual / 12) * ssm.basic_pct / 100)
                - ((esa.ctc_annual / 12) * ssm.hra_pct / 100),
                2
              ) AS other_allowances,
              DATE_FORMAT(esa.effective_from, '%Y-%m-%d') AS effective_from
         FROM employee_salary_assignment esa
         JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
        WHERE esa.employee_id = ?
          AND esa.active_status = 1
        ORDER BY esa.effective_from DESC, esa.created_at DESC
        LIMIT 1`,
      [targetId],
    );
    salary = salaryRows[0] ?? null;
  }

  const [leaveBalances] = await db.execute<RowDataPacket[]>(
    `SELECT lt.leave_code,
            lt.leave_name,
            COALESCE(lbl.allocated_days, 0) + COALESCE(lbl.adjusted_days, 0) - COALESCE(lbl.used_days, 0) AS available_days,
            COALESCE(lbl.used_days, 0) AS used_days
       FROM leave_balance_ledger lbl
       JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
      WHERE lbl.employee_id = ?
        AND lbl.balance_year = YEAR(CURDATE())
      ORDER BY lt.leave_name`,
    [targetId],
  );

  const [[attendance]] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(CASE WHEN attendance_status = 'present' THEN 1 END) AS present_days,
       COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END) AS working_days,
       ROUND(
         COUNT(CASE WHEN attendance_status = 'present' THEN 1 END) * 100.0 /
         NULLIF(COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END), 0),
       1) AS attendance_pct
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND YEAR(record_date) = YEAR(CURDATE())
        AND MONTH(record_date) = MONTH(CURDATE())`,
    [targetId],
  );

  // db_bill attendance fallback when mas_hrms has no records for current month
  let attendanceData: { present_days: number; working_days: number; attendance_pct: number | null; source?: string } =
    (attendance as any) ?? { present_days: 0, working_days: 0, attendance_pct: null };
  if (Number(attendanceData.present_days) === 0 && process.env.BILL_DB_HOST) {
    try {
      const billPool = await getBillPool();
      const [[billAtt]] = await billPool.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS present_days
           FROM db_bill.Attandence
          WHERE EmpCode = ?
            AND MONTH(AttDate) = MONTH(CURDATE())
            AND YEAR(AttDate) = YEAR(CURDATE())
            AND Status IN ('P','H','WO')`,
        [emp.employee_code ?? ""],
      );
      const legacyDays = Number(billAtt?.present_days ?? 0);
      if (legacyDays > 0) {
        attendanceData = { present_days: legacyDays, working_days: 26, attendance_pct: Math.round(legacyDays / 26 * 100 * 10) / 10, source: "legacy" };
      }
    } catch (_) { /* db_bill unavailable — skip silently */ }
  }

  // db_bill leave fallback when mas_hrms has no leave balance records
  let leaveBalancesData: RowDataPacket[] = leaveBalances;
  if (leaveBalancesData.length === 0 && process.env.BILL_DB_HOST) {
    try {
      const billPool = await getBillPool();
      const [billLeave] = await billPool.execute<RowDataPacket[]>(
        `SELECT leave_type AS leave_code, leave_type AS leave_name,
                (allocated - used) AS available_days, used AS used_days
           FROM db_bill.leave_management
          WHERE emp_code = ? AND YEAR(from_date) = YEAR(CURDATE())
          GROUP BY leave_type`,
        [emp.employee_code ?? ""],
      );
      if (billLeave.length > 0) leaveBalancesData = billLeave;
    } catch (_) { /* db_bill unavailable — skip silently */ }
  }

  const [performanceRows] = await db.execute<RowDataPacket[]>(
    `SELECT pfr.overall_score, pfc.period
       FROM performance_feedback_report pfr
       JOIN performance_feedback_cycle pfc ON pfc.cycle_id = pfr.cycle_id
      WHERE pfr.employee_id = ?
      ORDER BY pfr.report_generated_at DESC
      LIMIT 1`,
    [targetId],
  );

  const [[assetRow]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS active_assets
       FROM asset_assignment
      WHERE employee_id = ?
        AND returned_date IS NULL`,
    [targetId],
  );

  // Documents — combine joining-document checklist + general employee_documents
  const [[clDocRow]] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN status IN ('pending_hr_upload','pending_candidate_esign','pending_generation','rejected') AND mandatory = 1 THEN 1 ELSE 0 END) AS checklist_missing,
       SUM(CASE WHEN status IN ('uploaded','submitted','pending_verification','signed') THEN 1 ELSE 0 END) AS checklist_awaiting,
       SUM(CASE WHEN status IN ('verified','signed_verified','completed') THEN 1 ELSE 0 END) AS checklist_verified
       FROM employee_joining_document_checklist WHERE employee_id = ?`,
    [targetId],
  ).catch(() => [[{ checklist_missing: null, checklist_awaiting: null, checklist_verified: null }]] as any) as any;

  const [[docRow]] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN (file_url IS NULL OR file_url = '') THEN 1 ELSE 0 END) AS missing_docs,
       SUM(CASE WHEN file_url IS NOT NULL AND file_url <> '' AND verified = 0 THEN 1 ELSE 0 END) AS awaiting_verification,
       SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified_docs
       FROM employee_documents
      WHERE employee_id = ?`,
    [targetId],
  ).catch(() => [[{ missing_docs: 0, awaiting_verification: 0, verified_docs: 0 }]] as any) as any;

  const clTotal = Number(clDocRow?.checklist_missing ?? 0) + Number(clDocRow?.checklist_awaiting ?? 0) + Number(clDocRow?.checklist_verified ?? 0);
  const resolvedMissingDocs    = clTotal > 0 ? Number(clDocRow?.checklist_missing ?? 0)  : Number(docRow?.missing_docs ?? 0);
  const resolvedAwaitingVerify = clTotal > 0 ? Number(clDocRow?.checklist_awaiting ?? 0) : Number(docRow?.awaiting_verification ?? 0);
  const resolvedVerifiedDocs   = clTotal > 0 ? Number(clDocRow?.checklist_verified ?? 0) : Number(docRow?.verified_docs ?? 0);

  const [tierRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(gtm.tier_name, gt.tier_name, 'Unassigned') AS tier_name,
            ets.total_points
       FROM employee_tier_status ets
       LEFT JOIN gamification_tier_master gtm ON gtm.tier_id = ets.current_tier_id
       LEFT JOIN gamification_tier gt ON gt.id = ets.current_tier_id
      WHERE ets.employee_id = ?
      LIMIT 1`,
    [targetId],
  );

  let journey: RowDataPacket[] = [];
  try {
    journey = await listComprehensiveJourney(targetId, { includeCompensation: canSeeCompensation }) as unknown as RowDataPacket[];
  } catch {
    journey = [];
  }

  return res.json({
    success: true,
    data: {
      employee: {
        ...emp,
        emergency_contact: emp.emergency_name ? {
          name: emp.emergency_name,
          relationship: emp.emergency_relationship,
          mobile: emp.emergency_mobile,
          address: emp.emergency_address,
        } : null,
      },
      leave_balances: leaveBalancesData,
      attendance: attendanceData,
      performance: performanceRows[0] ?? null,
      active_assets: Number(assetRow?.active_assets ?? 0),
      missing_docs: resolvedMissingDocs,
      awaiting_verification: resolvedAwaitingVerify,
      verified_docs: resolvedVerifiedDocs,
      pending_docs: resolvedMissingDocs,
      gamification_tier: tierRows[0] ?? null,
      journey,
      salary,
    },
  });
}));

// GET /api/employees/:id/ctc — returns annual CTC + full monthly breakdown for payslip viewer
router.get(`${UUID_ROUTE}/ctc`, h(async (req: any, res: any) => {
  const userId = req.authUser!.id;
  const targetId = String(req.params.id);
  await assertEmployeeAccess(userId, targetId, PEOPLE_SCOPE_ROLES);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.ctc_annual,
            ssm.basic_pct,
            ssm.hra_pct,
            ROUND(esa.ctc_annual / 12, 2)                                     AS monthly_ctc,
            ROUND((esa.ctc_annual / 12) * ssm.basic_pct / 100, 2)            AS monthly_basic,
            ROUND((esa.ctc_annual / 12) * ssm.hra_pct / 100, 2)              AS monthly_hra,
            ROUND(
              (esa.ctc_annual / 12)
              - ((esa.ctc_annual / 12) * ssm.basic_pct / 100)
              - ((esa.ctc_annual / 12) * ssm.hra_pct / 100), 2
            )                                                                  AS monthly_special
       FROM employee_salary_assignment esa
       JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
      WHERE esa.employee_id = ?
        AND esa.active_status = 1
      ORDER BY esa.effective_from DESC, esa.created_at DESC
      LIMIT 1`,
    [targetId],
  );
  if (!rows[0]) return res.json({ success: true, data: { ctc: null } });
  const r = rows[0] as any;
  return res.json({
    success: true,
    data: {
      ctc:             Number(r.ctc_annual),
      monthly_ctc:     Number(r.monthly_ctc),
      monthly_basic:   Number(r.monthly_basic),
      monthly_hra:     Number(r.monthly_hra),
      monthly_special: Number(r.monthly_special),
      basic_pct:       Number(r.basic_pct),
      hra_pct:         Number(r.hra_pct),
    },
  });
}));

router.get(UUID_ROUTE, h(async (req: any, res: any) => {
  const userId = req.authUser!.id;
  const targetId = String(req.params.id);
  await assertEmployeeAccess(userId, targetId, PEOPLE_SCOPE_ROLES);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.*,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS email,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS official_email,
            NULLIF(TRIM(COALESCE(e.personal_email, '')), '') AS personal_email,
            d.designation_name,
            dept.dept_name,
            b.branch_name,
            p.process_name,
            cc.cost_centre_name,
            CONCAT(m.first_name, ' ', COALESCE(m.last_name, '')) AS manager_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
      WHERE e.id = ?
      LIMIT 1`,
    [targetId],
  );
  if (!rows[0]) return res.status(404).json({ success: false, error: "Employee not found" });
  return res.json({ success: true, data: rows[0] });
}));

export { router as employeeSecureRouter };
