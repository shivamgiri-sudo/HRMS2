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

    // Optional branch filter passed by the caller (e.g. the Capacity Dashboard's branch
    // selector). This is on top of, not instead of, the RBAC scope above — a caller who is only
    // scoped to their own branches still can't reach past them by passing a different branchId.
    const { branchId } = req.query as { branchId?: string };
    const branchFilterSql = branchId ? "AND wm.branch_id = ?" : "";
    const branchFilterParams = branchId ? [branchId] : [];

    // Designations that fill a mandated production seat — 'EXECUTIVE' plus 'DATA-ANALYST'
    // (user ruling 2026-09-04: a client billed for production seats staffed by data analysts
    // instead of call-handling executives still has those seats filled; GS1's mandate is
    // entirely Data-Analyst-staffed and read as 0 active / 100% gap under an Executive-only
    // filter). Team Leaders/QA/Managers/Trainers still don't count.
    const PRODUCTION_SEAT_DESIGNATIONS = ["EXECUTIVE", "DATA-ANALYST"];

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

         -- Available active headcount. active_status = 1 ALONE remains the canonical
         -- employment-status definition (ruling 2026-08-07, guarded by
         -- attendance-canon.contract.test.ts) — that ruling is about not narrowing on
         -- employment_status, and is untouched here. designation_name IN PRODUCTION_SEAT_
         -- DESIGNATIONS is a separate, orthogonal filter: mandated_hc is a production-seat
         -- count, not a count of everyone on the process, so a Team Leader/QA/Manager/Trainer
         -- must not be counted as filling one of those seats.
         COUNT(DISTINCT CASE
           WHEN e.active_status = 1 AND d.designation_name IN (?)
           THEN e.id
         END) AS active_hc,

         -- In-notice count — same production-seat scoping as active_hc above.
         COUNT(DISTINCT CASE
           WHEN e.active_status = 1
            AND er.status IN ('accepted', 'notice_serving')
            AND d.designation_name IN (?)
           THEN e.id
         END) AS in_notice_count,

         -- Attrition exits in last 3 months — scoped to the same population the rate is being
         -- measured against, so a Team Leader leaving doesn't count as attrition against a
         -- production seat count.
         COUNT(DISTINCT CASE
           WHEN er.status IN ('exited', 'exit_confirmed')
            AND er.updated_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
            AND d.designation_name IN (?)
           THEN er.id
         END) AS exits_3m

       FROM workforce_mandate wm
       LEFT JOIN process_master p  ON p.id  = wm.process_id
       LEFT JOIN branch_master  b  ON b.id  = wm.branch_id
       LEFT JOIN employees e
              ON e.process_id = wm.process_id
             AND e.branch_id  = wm.branch_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN exit_request er ON er.employee_id = e.id
       WHERE wm.active_status = 1
         AND (wm.effective_to IS NULL OR wm.effective_to >= CURDATE())
         AND (${scoped.sql})
         ${branchFilterSql}
       GROUP BY
         wm.id, wm.process_id, p.process_name,
         wm.branch_id, b.branch_name,
         wm.role_group, wm.mandated_hc, wm.buffer_pct, wm.alert_threshold_pct
       ORDER BY p.process_name, b.branch_name`,
      [
        PRODUCTION_SEAT_DESIGNATIONS, PRODUCTION_SEAT_DESIGNATIONS, PRODUCTION_SEAT_DESIGNATIONS,
        ...scoped.params, ...branchFilterParams,
      ]
    );

    const data = (rows as RowDataPacket[]).map((r) => {
      const mandated = Number(r.mandated_hc);
      const active = Number(r.active_hc);
      const inNotice = Number(r.in_notice_count);
      const exits3m = Number(r.exits_3m);
      const effectiveHc = active - inNotice;
      const gap = mandated - effectiveHc;
      // Attrition rate = exits in 3m / avg headcount over the period * 4 (annualised) * 100.
      // Dividing by `active` (today's, already-post-attrition headcount) instead of the average
      // headcount over the window overstates the rate on any process that shrank during it —
      // a real case (Bluevine Technologies: 19 exits in 3 months, 67 left) produced 113%, an
      // annualised rate a reader correctly reads as impossible. `active + exits3m` approximates
      // the headcount at the start of the window (no hire-date data is available here to do
      // better), so the average of start and end is `active + exits3m / 2` — the same case now
      // reads 99%, still high, but no longer a number that looks like a data bug.
      const avgHcForAttrition = active + exits3m / 2;
      const attritionRate = avgHcForAttrition > 0
        ? Math.round((exits3m / 3 / avgHcForAttrition) * 12 * 100)
        : 0;

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
    //
    // This MUST mirror migration 1666's resolution ladder rung for rung, or a cost centre it
    // resolved gets counted twice — once inside its process row and again here. It did exactly
    // that before this was written out in full: Godfrey Philips' BSS/OB/AHMH-JD/474 (133 seats,
    // no process_id, no staff) is resolved by the same-billing-client rung into the Godfrey row,
    // and the banner still reported those 133 seats as unmapped, overstating the bucket at 222
    // seats when only 89 are genuinely unattributable.
    const unmappedScope = await buildScopeWhereClause(
      req.authUser!.id,
      [...HIRING_ALERT_ROLES],
      { branchId: "cc.branch_id" },
      { allowAdminBypass: true, allowCeoAllRead: true },
    );
    const [unmappedRows] = await db.query<RowDataPacket[]>(
      `WITH dominant_process AS (
         SELECT cost_centre_id, process_id FROM (
           SELECT e2.cost_centre_id, e2.process_id,
                  ROW_NUMBER() OVER (PARTITION BY e2.cost_centre_id
                                     ORDER BY COUNT(*) DESC, e2.process_id) AS rn
             FROM employees e2
            WHERE e2.active_status = 1
              AND e2.cost_centre_id IS NOT NULL AND e2.cost_centre_id <> ''
              AND e2.process_id     IS NOT NULL AND e2.process_id     <> ''
            GROUP BY e2.cost_centre_id, e2.process_id
         ) ranked WHERE ranked.rn = 1
       ),
       billed AS (
         SELECT cc.id AS cc_id, cc.branch_id, NULLIF(cc.process_id, '') AS cc_process,
                dp.process_id AS dom_process,
                TRIM(LOWER(ccbc.client_name))  AS bill_client,
                TRIM(LOWER(ccbc.process_name)) AS bill_process,
                ccbc.current_mandate AS mandated_hc
           FROM cost_center_billing_config ccbc
           JOIN cost_centre_master cc ON cc.cost_centre_code = ccbc.cost_center
           LEFT JOIN dominant_process dp ON dp.cost_centre_id = cc.id
          WHERE ccbc.active_status = 1 AND ccbc.current_mandate > 0
            AND cc.branch_id IS NOT NULL AND cc.branch_id <> ''
       ),
       client_sibling AS (
         SELECT branch_id, bill_client,
                MIN(COALESCE(cc_process, dom_process)) AS sibling_process
           FROM billed
          WHERE COALESCE(cc_process, dom_process) IS NOT NULL
            AND bill_client IS NOT NULL AND bill_client <> ''
          GROUP BY branch_id, bill_client
       )
       SELECT
         cc.branch_id,
         b.branch_name,
         COUNT(*)                  AS cost_centre_count,
         SUM(cc.mandated_hc)       AS mandated_hc
       FROM (
         SELECT billed.branch_id, billed.mandated_hc,
                COALESCE(billed.cc_process, billed.dom_process, cs.sibling_process, pm.id) AS resolved_process
           FROM billed
           LEFT JOIN client_sibling cs
             ON cs.branch_id = billed.branch_id AND cs.bill_client = billed.bill_client
           LEFT JOIN process_master pm
             ON TRIM(LOWER(pm.process_name)) = billed.bill_process
       ) cc
       LEFT JOIN branch_master b ON b.id = cc.branch_id
       WHERE cc.resolved_process IS NULL
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
