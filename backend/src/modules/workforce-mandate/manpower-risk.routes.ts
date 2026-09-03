import { Router } from "express";
import type { RowDataPacket } from "mysql2/promise";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";

export const manpowerRiskRouter = Router();

// Roles that may see the hiring alert, and the same list handed to buildScopeWhereClause so the
// rows a caller gets back match the rows the role gate let them ask for. HR executives are mapped
// to their processes through user_assignment_scope; a caller holding one of these roles with NO
// scope row gets 1=0 — an empty board, not the whole organisation. `ceo` is deliberately absent
// from the scope list and granted through allowCeoAllRead instead, since it has no scope rows.
const HIRING_ALERT_ROLES = [
  "admin", "hr", "hr_admin", "ho_hr", "branch_hr", "process_hr",
  "recruiter", "recruitment_hr", "manager", "branch_head", "process_manager", "wfm",
] as const;
manpowerRiskRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (e?: unknown) => void) =>
    fn(req, res).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/manpower-risk/cost-center
// Per-process/branch: mandated HC, active HC, in-notice count, gap, risk level.
// Used by HR/CEO/Branch Head dashboards for manpower planning alerts.
// ─────────────────────────────────────────────────────────────────────────────
manpowerRiskRouter.get(
  "/cost-center",
  requireRole(...HIRING_ALERT_ROLES, "ceo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Row scoping. Without this the endpoint handed every mandate in the company to any holder
    // of the roles above, which is the opposite of "an HR executive sees only their processes".
    const scoped = await buildScopeWhereClause(
      req.authUser!.id,
      [...HIRING_ALERT_ROLES],
      { branchId: "wm.branch_id", processId: "wm.process_id" },
      { allowAdminBypass: true, allowCeoAllRead: true },
    );

    // Mandate: latest active record per process+branch
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
         wm.id AS mandate_id,
         wm.process_id,
         p.process_name,
         wm.branch_id,
         b.branch_name,
         wm.role_group,
         wm.mandated_hc,
         wm.buffer_pct,
         -- alert_threshold_pct is its own column and always was; reading buffer_pct here made a
         -- 10% staffing buffer masquerade as a 10% gap alert threshold, and disagreed with
         -- hc-gap-alert.cron.ts which reads the real column.
         COALESCE(wm.alert_threshold_pct, 20) AS alert_threshold_pct,

         -- Available active headcount. active_status = 1 ALONE — the canonical definition
         -- (ruling 2026-08-07, guarded by attendance-canon.contract.test.ts). Narrowing by
         -- employment_status as well reports a different organisation size from employee-master,
         -- the payroll register and the Total Employees tile, and drops anyone on probation,
         -- notice or suspension. People serving notice are reported separately below rather than
         -- deducted here. Deliberately NOT date_of_joining-gated: a future-dated joiner is a
         -- filled seat as far as a hiring decision goes.
         COUNT(DISTINCT CASE WHEN e.active_status = 1 THEN e.id END) AS active_hc,

         -- In-notice count
         COUNT(DISTINCT CASE
           WHEN e.active_status = 1
            AND er.status IN ('accepted', 'notice_serving')
           THEN e.id
         END) AS in_notice_count,

         -- Attrition exits in last 3 months
         COUNT(DISTINCT CASE
           WHEN er.status IN ('exited', 'exit_confirmed')
            AND er.updated_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
           THEN er.id
         END) AS exits_3m

       FROM workforce_mandate wm
       LEFT JOIN process_master p  ON p.id  = wm.process_id
       LEFT JOIN branch_master  b  ON b.id  = wm.branch_id
       LEFT JOIN employees e
              ON e.process_id = wm.process_id
             AND e.branch_id  = wm.branch_id
       LEFT JOIN exit_request er ON er.employee_id = e.id
       WHERE wm.active_status = 1
         AND (wm.effective_to IS NULL OR wm.effective_to >= CURDATE())
         AND (${scoped.sql})
       GROUP BY
         wm.id, wm.process_id, p.process_name,
         wm.branch_id, b.branch_name,
         wm.role_group, wm.mandated_hc, wm.buffer_pct, wm.alert_threshold_pct
       ORDER BY p.process_name, b.branch_name`,
      scoped.params
    );

    const data = (rows as RowDataPacket[]).map((r) => {
      const mandated = Number(r.mandated_hc);
      const active = Number(r.active_hc);
      const inNotice = Number(r.in_notice_count);
      const exits3m = Number(r.exits_3m);
      const effectiveHc = active - inNotice;
      const gap = mandated - effectiveHc;
      // attrition rate = exits in 3m / avg headcount * 4 (annualised) * 100
      const attritionRate = active > 0 ? Math.round((exits3m / 3 / active) * 12 * 100) : 0;

      // Risk: critical if gap >= 20% of mandate, high if gap >= 10%, medium if gap > 0
      const gapPct = mandated > 0 ? (gap / mandated) * 100 : 0;
      const alertThreshold = Number(r.alert_threshold_pct ?? 20);
      let riskLevel: "critical" | "high" | "medium" | "low";
      if (gapPct >= alertThreshold) riskLevel = "critical";
      else if (gapPct >= alertThreshold / 2) riskLevel = "high";
      else if (gap > 0) riskLevel = "medium";
      else riskLevel = "low";

      // Hiring recommendation
      let hiringRecommendation = 0;
      if (gap > 0) {
        // Add attrition buffer: assume same exit rate continues
        const projectedExits = Math.ceil(exits3m / 3); // per-month average
        hiringRecommendation = gap + projectedExits;
      }

      // The five figures the board is built on. buffer_to_maintain is the TARGET spare capacity
      // (ceil, because half a spare person is a whole person to hire); buffer_count is the surplus
      // actually carried today and is signed — negative means already below mandate.
      const bufferPct = Number(r.buffer_pct ?? 0);
      const bufferToMaintain = Math.ceil((mandated * bufferPct) / 100);
      const bufferCount = active - mandated;
      const targetHc = mandated + bufferToMaintain;
      const shortage = Math.max(0, targetHc - active);

      return {
        mandate_id: r.mandate_id,
        process_id: r.process_id,
        process_name: r.process_name ?? "Unknown",
        branch_id: r.branch_id,
        branch_name: r.branch_name ?? "Unknown",
        role_group: r.role_group ?? "All",
        mandated_hc: mandated,
        active_hc: active,
        buffer_pct: bufferPct,
        buffer_to_maintain: bufferToMaintain,
        buffer_count: bufferCount,
        target_hc: targetHc,
        shortage,
        surplus: Math.max(0, bufferCount - bufferToMaintain),
        coverage_pct: targetHc > 0 ? Math.round((active / targetHc) * 100) : null,
        in_notice_count: inNotice,
        effective_hc: effectiveHc,
        gap,
        gap_pct: Math.round(gapPct),
        attrition_rate: attritionRate,
        exits_3m: exits3m,
        risk_level: riskLevel,
        hiring_recommendation: hiringRecommendation,
        alert_threshold_pct: alertThreshold,
      };
    });

    // Mandate that could not be attributed to a process, so it is NOT in workforce_mandate and
    // would otherwise vanish from the board entirely. Surfaced separately rather than hidden: an
    // unmapped mandate is a cost centre missing its process_id, which is a data fix somebody has
    // to make. Scoped on branch only — a process-scoped caller matches nothing here, which is
    // correct, because mandate that belongs to no process belongs to no process owner either.
    const unmappedScope = await buildScopeWhereClause(
      req.authUser!.id,
      [...HIRING_ALERT_ROLES],
      { branchId: "cc.branch_id" },
      { allowAdminBypass: true, allowCeoAllRead: true },
    );
    const [unmappedRows] = await db.query<RowDataPacket[]>(
      `SELECT
         cc.branch_id,
         b.branch_name,
         COUNT(*)                    AS cost_centre_count,
         SUM(ccbc.current_mandate)   AS mandated_hc
       FROM cost_center_billing_config ccbc
       JOIN cost_centre_master cc ON cc.cost_centre_code = ccbc.cost_center
       LEFT JOIN branch_master b  ON b.id = cc.branch_id
       WHERE ccbc.active_status = 1
         AND ccbc.current_mandate > 0
         AND (cc.process_id IS NULL OR cc.process_id = '')
         AND NOT EXISTS (
           SELECT 1 FROM employees e2
            WHERE e2.cost_centre_id = cc.id
              AND e2.active_status = 1
              AND e2.process_id IS NOT NULL AND e2.process_id <> ''
         )
         AND (${unmappedScope.sql})
       GROUP BY cc.branch_id, b.branch_name
       ORDER BY mandated_hc DESC`,
      unmappedScope.params
    );
    const unmapped = (unmappedRows as RowDataPacket[]).map((r) => ({
      branch_id: r.branch_id,
      branch_name: r.branch_name ?? "Unknown",
      cost_centre_count: Number(r.cost_centre_count),
      mandated_hc: Number(r.mandated_hc),
    }));

    // Summary counts
    const summary = {
      total_cost_centers: data.length,
      critical: data.filter((d) => d.risk_level === "critical").length,
      high: data.filter((d) => d.risk_level === "high").length,
      medium: data.filter((d) => d.risk_level === "medium").length,
      low: data.filter((d) => d.risk_level === "low").length,
      total_in_notice: data.reduce((s, d) => s + d.in_notice_count, 0),
      total_gap: data.reduce((s, d) => s + Math.max(0, d.gap), 0),
      total_hiring_needed: data.reduce((s, d) => s + d.hiring_recommendation, 0),
      total_mandate: data.reduce((s, d) => s + d.mandated_hc, 0),
      total_active: data.reduce((s, d) => s + d.active_hc, 0),
      total_buffer_to_maintain: data.reduce((s, d) => s + d.buffer_to_maintain, 0),
      total_shortage: data.reduce((s, d) => s + d.shortage, 0),
      processes_short: data.filter((d) => d.shortage > 0).length,
      unmapped_mandate: unmapped.reduce((s, u) => s + u.mandated_hc, 0),
      unmapped_cost_centres: unmapped.reduce((s, u) => s + u.cost_centre_count, 0),
    };

    return res.json({ success: true, data, summary, unmapped });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/manpower-risk/notice-period
// Employees currently in notice (accepted / notice_serving) with days remaining.
// Used by the Notice Period tab in Exit Command Center.
// ─────────────────────────────────────────────────────────────────────────────
manpowerRiskRouter.get(
  "/notice-period",
  requireRole("admin", "hr", "ceo", "manager", "branch_head"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
         er.id,
         er.employee_id,
         er.exit_type,
         er.exit_sub_type,
         er.exit_reason_category,
         er.resignation_reason,
         er.notice_period_days,
         er.notice_start_date,
         er.notice_end_date,
         er.last_working_day_proposed,
         er.last_working_day_confirmed,
         er.status,
         er.created_at,
         er.submitted_at,
         er.manager_actioned_at,
         CONCAT_WS(' ', e.first_name, e.last_name)   AS employee_name,
         e.employee_code,
         b.branch_name,
         p.process_name,
         d.dept_name                                  AS department_name,
         des.designation_name,
         CONCAT_WS(' ', mgr.first_name, mgr.last_name) AS manager_name,
         mgr.employee_code                              AS manager_code,
         -- Days remaining in notice
         CASE
           WHEN er.notice_end_date IS NOT NULL
             THEN GREATEST(0, DATEDIFF(er.notice_end_date, CURDATE()))
           WHEN er.notice_period_days > 0 AND er.notice_start_date IS NOT NULL
             THEN GREATEST(0, er.notice_period_days - DATEDIFF(CURDATE(), er.notice_start_date))
           ELSE NULL
         END AS days_remaining,
         -- Days served
         CASE
           WHEN er.notice_start_date IS NOT NULL
             THEN GREATEST(0, DATEDIFF(CURDATE(), er.notice_start_date))
           ELSE 0
         END AS days_served
       FROM exit_request er
       LEFT JOIN employees e    ON e.id  = er.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN departments d   ON d.id  = e.department_id
       LEFT JOIN designations des ON des.id = e.designation_id
       LEFT JOIN employees mgr   ON mgr.id  = e.reporting_manager_id
       WHERE er.status IN ('accepted', 'notice_serving')
       ORDER BY days_remaining ASC, er.created_at DESC`
    );

    return res.json({ success: true, data: rows });
  })
);
