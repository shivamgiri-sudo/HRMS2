import { randomUUID } from "crypto";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { billabilityService } from "./billability.service.js";
import { getCostCentreActivity, activityWindow } from "./cost-centre-activity.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

/**
 * Who may maintain billability, seat rates and cost splits.
 *
 * Matches the grant issued in 1064 exactly. Keeping the two in step matters: the page
 * gate decides what a user can SEE from role_page_access, and this decides what the API
 * will ACCEPT. A page granted to a role whose writes the API then rejects is the worst of
 * both — it looks available and fails on save.
 */
const BILLABILITY_ROLES = ["super_admin", "finance", "payroll_head", "payroll_branch"] as const;

// ─── The (process x designation) matrix ───────────────────────────────────────

/**
 * GET /api/finance/billability/matrix
 *
 * Every live (process x designation) pair with its headcount and the rule currently
 * governing it — the grid finance edits. Pairs are derived from who is actually posted
 * to them, not from a cross join of every process against every designation, which would
 * be 52 x 89 = 4,628 mostly-empty cells instead of the ~126 that exist.
 */
router.get("/matrix", requireRole(...BILLABILITY_ROLES), h(async (req, res) => {
  const onDate = String(req.query.date ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.process_id, p.process_name, p.client_name,
            e.designation_id, dm.designation_name,
            COUNT(*) AS headcount,
            r.id AS rule_id, r.is_billable, r.seat_rate_monthly, r.status AS rule_status,
            r.effective_from, r.change_reason
       FROM employees e
       LEFT JOIN process_master     p  ON p.id  = e.process_id
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN process_role_billability r
              ON r.process_id     = e.process_id
             AND r.designation_id = e.designation_id
             AND r.employee_id IS NULL
             AND r.status = 'approved'
             AND r.effective_from <= ?
             AND (r.effective_to IS NULL OR r.effective_to >= ?)
      WHERE e.active_status = 1
        AND e.process_id IS NOT NULL
        AND e.designation_id IS NOT NULL
      GROUP BY e.process_id, p.process_name, p.client_name, e.designation_id, dm.designation_name,
               r.id, r.is_billable, r.seat_rate_monthly, r.status, r.effective_from, r.change_reason
      ORDER BY p.process_name, headcount DESC`,
    [onDate, onDate],
  );

  res.json({
    success: true,
    data: rows.map((r) => ({
      processId: r.process_id,
      processName: r.process_name,
      clientName: r.client_name,
      designationId: r.designation_id,
      designationName: r.designation_name,
      headcount: Number(r.headcount),
      ruleId: r.rule_id ?? null,
      // No rule means the default applies: billable exactly when the P&L already treats
      // this person as an agent. The UI shows that as "default", not as a blank.
      isBillable: r.rule_id ? Number(r.is_billable) === 1 : null,
      seatRateMonthly: r.seat_rate_monthly === null ? null : Number(r.seat_rate_monthly),
      ruleStatus: r.rule_status ?? null,
      effectiveFrom: r.effective_from ?? null,
      changeReason: r.change_reason ?? null,
    })),
  });
}));

/**
 * POST /api/finance/billability/matrix
 *
 * Record (or supersede) the rule for one process x designation cell.
 *
 * A previous rule for the same cell is end-dated rather than overwritten, so a period
 * already computed against it can still be explained. That is the whole reason these
 * tables are effective-dated.
 */
router.post("/matrix", requireRole(...BILLABILITY_ROLES), requireWriteAccess, h(async (req, res) => {
  const { processId, designationId, isBillable, seatRateMonthly, effectiveFrom, changeReason } = req.body ?? {};

  if (!processId || !designationId) {
    return res.status(400).json({ success: false, message: "processId and designationId are required" });
  }
  if (typeof isBillable !== "boolean") {
    return res.status(400).json({ success: false, message: "isBillable must be true or false" });
  }
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom))) {
    return res.status(400).json({ success: false, message: "effectiveFrom must be a YYYY-MM-DD date" });
  }
  if (!String(changeReason ?? "").trim()) {
    return res.status(400).json({ success: false, message: "changeReason is required — it is what explains this number later" });
  }

  const actorId = req.authUser!.id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE process_role_billability
          SET effective_to = DATE_SUB(?, INTERVAL 1 DAY), updated_at = NOW()
        WHERE process_id = ? AND designation_id = ? AND employee_id IS NULL
          AND status = 'approved' AND (effective_to IS NULL OR effective_to >= ?)`,
      [effectiveFrom, processId, designationId, effectiveFrom],
    );
    await conn.execute(
      `INSERT INTO process_role_billability
         (id, rule_name, process_id, designation_id, is_billable, seat_rate_monthly,
          source, effective_from, status, change_reason, created_by, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, 'approved', ?, ?, ?, NOW())`,
      [randomUUID(), `Process x designation billability`, processId, designationId,
       isBillable ? 1 : 0,
       seatRateMonthly === null || seatRateMonthly === undefined || seatRateMonthly === ""
         ? null : Number(seatRateMonthly),
       effectiveFrom, String(changeReason).trim(), actorId, actorId],
    );
    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

// ─── Seat rates per cost centre ───────────────────────────────────────────────

router.get("/seat-rates", requireRole(...BILLABILITY_ROLES), h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.cost_centre_id, cc.cost_centre_code, cc.cost_centre_name,
            r.designation_id, dm.designation_name,
            r.seat_rate_monthly, r.billing_model, r.proration_method,
            r.effective_from, r.effective_to, r.status, r.contract_reference,
            (SELECT COUNT(*) FROM employees e
              WHERE e.cost_centre_id = r.cost_centre_id AND e.active_status = 1) AS active_headcount
       FROM cost_centre_seat_rate r
       JOIN cost_centre_master cc ON cc.id = r.cost_centre_id
       LEFT JOIN designation_master dm ON dm.id = r.designation_id
      WHERE r.status <> 'inactive'
      ORDER BY cc.cost_centre_name, (r.designation_id IS NULL) DESC, r.effective_from DESC`,
  );
  res.json({ success: true, data: rows });
}));

/**
 * Cost centres that can carry a rate.
 *
 * Uses the one agreed definition of active — a client paid us for it, or people posted to it
 * were paid — rather than any of the three stored flags, which disagree: mas_hrms says 166
 * active, db_bill says 580, and only 95 are actually trading. Filtering on the mas_hrms flag
 * would hide 36 cost centres that are still earning money.
 *
 * `spend_only` centres are returned too, marked as such: no client pays and nobody works
 * there, but GRN spend is still landing on them and somebody has to decide where it goes.
 */
router.get("/cost-centres", requireRole(...BILLABILITY_ROLES), h(async (req, res) => {
  const period = /^\d{4}-\d{2}$/.test(String(req.query.period ?? ""))
    ? String(req.query.period)
    : new Date().toISOString().slice(0, 7);

  const activity = await getCostCentreActivity(period);
  const [headcounts] = await db.execute<RowDataPacket[]>(
    `SELECT cost_centre_id AS id, COUNT(*) AS n
       FROM employees WHERE active_status = 1 AND cost_centre_id IS NOT NULL
      GROUP BY cost_centre_id`,
  );
  const staffById = new Map(headcounts.map((r) => [String(r.id), Number(r.n)]));

  const data = activity
    .filter((c) => c.activity !== "inactive")
    .map((c) => ({
      id: c.costCentreId,
      cost_centre_code: c.costCentreCode,
      cost_centre_name: c.costCentreName,
      activity: c.activity,
      active_headcount: staffById.get(c.costCentreId) ?? 0,
      revenue: c.revenue,
      people_paid: c.peoplePaid,
      spend: c.spend,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.active_headcount - a.active_headcount);

  res.json({ success: true, data, period, rule: "revenue or salary paid in the trailing 3 months" });
}));

/**
 * GET /api/finance/billability/cost-centre-activity
 *
 * The full classification, including the inactive ones, so the register can be reviewed
 * rather than only filtered.
 */
router.get("/cost-centre-activity", requireRole(...BILLABILITY_ROLES), h(async (req, res) => {
  const period = /^\d{4}-\d{2}$/.test(String(req.query.period ?? ""))
    ? String(req.query.period)
    : new Date().toISOString().slice(0, 7);
  const rows = await getCostCentreActivity(period);
  const summary = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.activity] = (acc[r.activity] ?? 0) + 1;
    return acc;
  }, {});
  res.json({
    success: true,
    period,
    window: activityWindow(period),
    summary,
    // Spend landing on centres nobody works at and no client pays for — it has to go
    // somewhere, and reporting only the active ones would make it disappear.
    spendOnlyValue: rows.filter((r) => r.activity === "spend_only").reduce((s, r) => s + r.spend, 0),
    data: rows,
  });
}));

router.post("/seat-rates", requireRole(...BILLABILITY_ROLES), requireWriteAccess, h(async (req, res) => {
  const { costCentreId, designationId, seatRateMonthly, billingModel, prorationMethod,
          effectiveFrom, contractReference, changeReason } = req.body ?? {};

  if (!costCentreId) {
    return res.status(400).json({ success: false, message: "costCentreId is required" });
  }
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom))) {
    return res.status(400).json({ success: false, message: "effectiveFrom must be a YYYY-MM-DD date" });
  }
  if (!String(changeReason ?? "").trim()) {
    return res.status(400).json({ success: false, message: "changeReason is required" });
  }
  const model = billingModel ?? "per_seat";
  if (!["per_seat", "not_seat_billed", "unknown"].includes(model)) {
    return res.status(400).json({ success: false, message: "billingModel must be per_seat, not_seat_billed or unknown" });
  }
  const rate = Number(seatRateMonthly ?? 0);
  // A per-seat rate of zero is almost always an empty form rather than a real free seat,
  // and it would silently zero that cost centre's revenue.
  if (model === "per_seat" && (!Number.isFinite(rate) || rate <= 0)) {
    return res.status(400).json({
      success: false,
      message: "A per-seat cost centre needs a rate greater than zero. Use billingModel 'not_seat_billed' if the client does not pay per seat.",
    });
  }

  const actorId = req.authUser!.id;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE cost_centre_seat_rate
          SET effective_to = DATE_SUB(?, INTERVAL 1 DAY), updated_at = NOW()
        WHERE cost_centre_id = ? AND status = 'approved'
          AND ((designation_id IS NULL AND ? IS NULL) OR designation_id = ?)
          AND (effective_to IS NULL OR effective_to >= ?)`,
      [effectiveFrom, costCentreId, designationId ?? null, designationId ?? null, effectiveFrom],
    );
    await conn.execute(
      `INSERT INTO cost_centre_seat_rate
         (id, cost_centre_id, designation_id, seat_rate_monthly, billing_model,
          proration_method, contract_reference, effective_from, status, change_reason,
          created_by, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, NOW())`,
      [randomUUID(), costCentreId, designationId ?? null, model === "not_seat_billed" ? 0 : rate,
       model, prorationMethod ?? "payable_days", contractReference ?? null, effectiveFrom,
       String(changeReason).trim(), actorId, actorId],
    );
    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

// ─── Support-staff cost splits ────────────────────────────────────────────────

/**
 * Employees who plausibly need a split: those the P&L cannot attribute to a single
 * client-facing cost centre. Everyone else is 100% direct and needs no row.
 */
router.get("/split-candidates", requireRole(...BILLABILITY_ROLES), h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code, e.full_name,
            d.dept_name, dm.designation_name, b.branch_name,
            e.cost_centre_id, cc.cost_centre_name,
            (SELECT COUNT(*) FROM employee_cost_centre_allocation a
              WHERE a.employee_id = e.id AND a.status = 'approved') AS allocation_rows,
            (SELECT ROUND(SUM(a.allocation_pct), 2) FROM employee_cost_centre_allocation a
              WHERE a.employee_id = e.id AND a.status = 'approved') AS allocation_total
       FROM employees e
       LEFT JOIN department_master  d  ON d.id  = e.department_id
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN branch_master      b  ON b.id  = e.branch_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      WHERE e.active_status = 1
        AND (e.process_id IS NULL
             OR d.dept_name IN ('HUMAN RESOURCE AND DEVELOPMENT','INFORMATION TECHNOLOGY',
                                'ADMINISTRATION','FINANCE & ACCOUNTS','MANAGEMENT',
                                'PROJECTS & COMPLIANCE','SALES & MARKETING','DIALER & WFM',
                                'TRAINING AND QUALITY'))
      ORDER BY d.dept_name, e.full_name`,
  );
  res.json({ success: true, data: rows });
}));

router.get("/allocations/:employeeId", requireRole(...BILLABILITY_ROLES), h(async (req, res) => {
  const onDate = String(req.query.date ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const result = await billabilityService.getEmployeeAllocation(String(req.params.employeeId), onDate);
  res.json({ success: true, data: result });
}));

router.post("/allocations/:employeeId", requireRole(...BILLABILITY_ROLES), requireWriteAccess, h(async (req, res) => {
  const { effectiveFrom, allocations, changeReason } = req.body ?? {};
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom))) {
    return res.status(400).json({ success: false, message: "effectiveFrom must be a YYYY-MM-DD date" });
  }
  if (!Array.isArray(allocations)) {
    return res.status(400).json({ success: false, message: "allocations must be an array" });
  }
  if (!String(changeReason ?? "").trim()) {
    return res.status(400).json({ success: false, message: "changeReason is required" });
  }
  const result = await billabilityService.replaceEmployeeAllocation(
    String(req.params.employeeId), String(effectiveFrom), allocations,
    req.authUser!.id, String(changeReason).trim(),
  );
  res.json({ success: true, data: result });
}));

// ─── Exceptions: what this configuration cannot answer ────────────────────────

/**
 * GET /api/finance/billability/exceptions
 *
 * The gaps, counted rather than hidden. A configuration screen that only shows what IS
 * set lets a 13% hole look like completeness.
 */
router.get("/exceptions", requireRole(...BILLABILITY_ROLES), h(async (_req, res) => {
  const [[gaps]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS active_employees,
            SUM(process_id IS NULL)     AS no_process,
            SUM(designation_id IS NULL) AS no_designation,
            SUM(cost_centre_id IS NULL) AS no_cost_centre,
            SUM(process_id IS NULL OR designation_id IS NULL) AS unresolvable_by_matrix
       FROM employees WHERE active_status = 1`,
  );
  const [[rates]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT cc.id) AS cost_centres_with_staff,
            COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN cc.id END) AS cost_centres_with_rate
       FROM cost_centre_master cc
       JOIN employees e ON e.cost_centre_id = cc.id AND e.active_status = 1
       LEFT JOIN cost_centre_seat_rate r
              ON r.cost_centre_id = cc.id AND r.status = 'approved'
             AND (r.effective_to IS NULL OR r.effective_to >= CURDATE())`,
  );
  const [unbalanced] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, ROUND(SUM(allocation_pct), 2) AS total
       FROM employee_cost_centre_allocation
      WHERE status = 'approved' AND (effective_to IS NULL OR effective_to >= CURDATE())
      GROUP BY employee_id
     HAVING ABS(SUM(allocation_pct) - 100) > 0.01`,
  );

  res.json({
    success: true,
    data: {
      activeEmployees: Number(gaps.active_employees),
      noProcess: Number(gaps.no_process),
      noDesignation: Number(gaps.no_designation),
      noCostCentre: Number(gaps.no_cost_centre),
      unresolvableByMatrix: Number(gaps.unresolvable_by_matrix),
      costCentresWithStaff: Number(rates.cost_centres_with_staff),
      costCentresWithRate: Number(rates.cost_centres_with_rate),
      unbalancedAllocations: unbalanced.map((u) => ({
        employeeId: String(u.employee_id),
        total: Number(u.total),
      })),
    },
  });
}));

export default router;
