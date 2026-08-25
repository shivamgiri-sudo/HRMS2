import { Router } from "express";
import type { RowDataPacket } from "mysql2/promise";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";

export const manpowerRiskRouter = Router();
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
  requireRole("admin", "hr", "ceo", "manager", "branch_head"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
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
         wm.alert_threshold_pct,

         -- Active headcount (status='active', same process+branch)
         COUNT(DISTINCT CASE WHEN e.status = 'active' THEN e.id END) AS active_hc,

         -- In-notice count
         COUNT(DISTINCT CASE
           WHEN e.status = 'active'
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
       GROUP BY
         wm.id, wm.process_id, p.process_name,
         wm.branch_id, b.branch_name,
         wm.role_group, wm.mandated_hc, wm.alert_threshold_pct
       ORDER BY p.process_name, b.branch_name`
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

      return {
        mandate_id: r.mandate_id,
        process_id: r.process_id,
        process_name: r.process_name ?? "Unknown",
        branch_id: r.branch_id,
        branch_name: r.branch_name ?? "Unknown",
        role_group: r.role_group ?? "All",
        mandated_hc: mandated,
        active_hc: active,
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
    };

    return res.json({ success: true, data, summary });
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
       LEFT JOIN departments d   ON d.id  = e.dept_id
       LEFT JOIN designations des ON des.id = e.designation_id
       LEFT JOIN employees mgr   ON mgr.id  = e.reporting_manager_id
       WHERE er.status IN ('accepted', 'notice_serving')
       ORDER BY days_remaining ASC, er.created_at DESC`
    );

    return res.json({ success: true, data: rows });
  })
);
