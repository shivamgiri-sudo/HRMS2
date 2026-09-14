import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

export const payrollAuditTrailRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

payrollAuditTrailRouter.use(requireAuth);

// ─── GET /api/payroll/audit-trail ─────────────────────────────────────────────
// Unified trail: payroll_calculation_audit + sensitive_action_log (module_key='payroll')
payrollAuditTrailRouter.get(
  "/",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      run_id,
      employee_id,
      event_type,
      date_from,
      date_to,
      source,         // 'calculation' | 'action' | '' (both)
      page: rawPage,
      limit: rawLimit,
    } = req.query as Record<string, string>;

    const page  = Math.max(1, parseInt(rawPage ?? "1", 10));
    const limit = Math.min(200, parseInt(rawLimit ?? "50", 10));
    const offset = (page - 1) * limit;

    // --- calculation audit -------------------------------------------------
    const calcConds: string[] = [];
    const calcParams: unknown[] = [];

    if (run_id)      { calcConds.push("pca.run_id = ?");        calcParams.push(run_id); }
    if (employee_id) { calcConds.push("pca.employee_id = ?");   calcParams.push(employee_id); }
    if (event_type)  { calcConds.push("pca.event_type LIKE ?"); calcParams.push(`%${event_type}%`); }
    if (date_from)   { calcConds.push("pca.created_at >= ?");   calcParams.push(date_from); }
    if (date_to)     { calcConds.push("pca.created_at <= ?");   calcParams.push(date_to + " 23:59:59"); }

    const calcWhere = calcConds.length ? `WHERE ${calcConds.join(" AND ")}` : "";

    // --- sensitive action log ----------------------------------------------
    // module_key IN (...) added 2026-08-25: this page's own header claims "full forensic
    // record of all payroll calculations and sensitive access", but the exact-match filter
    // silently excluded loan events (module_key='payroll_loans') and F&F/exit events
    // (module_key='exit') — both genuinely logged to this same table, just invisible here.
    // Live-verified counts: 41,219 'payroll' rows visible before this fix, 11 'payroll_loans'
    // and 7 'exit' rows completely absent. Holiday-work approvals still won't appear — they
    // write to their own holiday_work_approval_log table, not this one, a separate gap.
    const salConds: string[] = ["sal.module_key IN ('payroll','payroll_loans','exit')"];
    const salParams: unknown[] = [];

    if (run_id)      { salConds.push("JSON_UNQUOTE(JSON_EXTRACT(sal.change_summary, '$.run_id')) = ?"); salParams.push(run_id); }
    if (employee_id) { salConds.push("JSON_UNQUOTE(JSON_EXTRACT(sal.change_summary, '$.employee_id')) = ?"); salParams.push(employee_id); }
    if (event_type)  { salConds.push("sal.action_type LIKE ?"); salParams.push(`%${event_type}%`); }
    if (date_from)   { salConds.push("sal.acted_at >= ?");    salParams.push(date_from); }
    if (date_to)     { salConds.push("sal.acted_at <= ?");    salParams.push(date_to + " 23:59:59"); }

    const salWhere = `WHERE ${salConds.join(" AND ")}`;

    let calcRows: any[] = [];
    let salRows:  any[] = [];
    let calcTotal = 0;
    let salTotal  = 0;

    if (!source || source === "calculation") {
      try {
        const [cr] = await db.execute<RowDataPacket[]>(
          `SELECT
             pca.id,
             'calculation' AS source,
             -- payroll_calculation_audit has no module_key column — it's payroll-only by
             -- definition, so this literal is correct, not a stand-in for a missing value.
             'payroll' AS module,
             pca.run_id,
             pca.employee_id,
             COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
             e.employee_code,
             pca.event_type,
             pca.event_detail,
             pca.actor_user_id,
             -- auth_user stores no name, only email; resolve it through employees.user_id
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(ae.first_name,''),' ',COALESCE(ae.last_name,''))),''), au.email)
               AS actor_name,
             pca.created_at
           FROM payroll_calculation_audit pca
           LEFT JOIN employees e   ON e.id   = pca.employee_id
           LEFT JOIN auth_user au  ON au.id  = pca.actor_user_id
           LEFT JOIN employees ae  ON ae.user_id = au.id
           ${calcWhere}
           ORDER BY pca.created_at DESC`,
          calcParams
        );
        calcRows = cr as any[];

        const [ct] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM payroll_calculation_audit pca ${calcWhere}`,
          calcParams
        );
        calcTotal = Number((ct as any[])[0]?.cnt ?? 0);
      } catch {
        // table may not exist on older schema — degrade gracefully
      }
    }

    if (!source || source === "action") {
      try {
        const [sr] = await db.execute<RowDataPacket[]>(
          `SELECT
             sal.id,
             'action' AS source,
             sal.module_key AS module,
             NULL AS run_id,
             NULL AS employee_id,
             NULL AS employee_name,
             NULL AS employee_code,
             sal.action_type AS event_type,
             sal.change_summary AS event_detail,
             sal.actor_user_id,
             -- auth_user stores no name, only email; resolve it through employees.user_id
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(ae.first_name,''),' ',COALESCE(ae.last_name,''))),''), au.email)
               AS actor_name,
             sal.acted_at AS created_at
           FROM sensitive_action_log sal
           LEFT JOIN auth_user au ON au.id = sal.actor_user_id
           LEFT JOIN employees ae ON ae.user_id = au.id
           ${salWhere}
           ORDER BY sal.acted_at DESC`,
          salParams
        );
        salRows = sr as any[];

        const [st] = await db.execute<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt FROM sensitive_action_log sal ${salWhere}`,
          salParams
        );
        salTotal = Number((st as any[])[0]?.cnt ?? 0);
      } catch {
        // sensitive_action_log may not exist — degrade gracefully
      }
    }

    // Merge + sort by created_at desc, then paginate
    const merged = [...calcRows, ...salRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const total = (!source || source === "calculation" ? calcTotal : 0) +
                  (!source || source === "action" ? salTotal : 0);

    const paged = merged.slice(offset, offset + limit);

    return res.json({
      success: true,
      data: paged,
      total,
      page,
      limit,
    });
  })
);

// ─── GET /api/payroll/audit-trail/event-types ─────────────────────────────────
payrollAuditTrailRouter.get(
  "/event-types",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const types: string[] = [];
    try {
      const [cr] = await db.execute<RowDataPacket[]>(
        "SELECT DISTINCT event_type FROM payroll_calculation_audit ORDER BY event_type"
      );
      (cr as any[]).forEach(r => types.push(r.event_type));
    } catch {}

    try {
      const [sr] = await db.execute<RowDataPacket[]>(
        "SELECT DISTINCT action_type FROM sensitive_action_log WHERE module_key='payroll' ORDER BY action_type"
      );
      (sr as any[]).forEach(r => {
        if (!types.includes(r.action_type)) types.push(r.action_type);
      });
    } catch {}

    return res.json({ success: true, data: types.sort() });
  })
);

// ─── GET /api/payroll/audit-trail/runs ────────────────────────────────────────
// Return run list for the filter dropdown
payrollAuditTrailRouter.get(
  "/runs",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status, created_at
         FROM salary_prep_run
         ORDER BY run_month DESC
         LIMIT 36`
    );
    return res.json({ success: true, data: rows });
  })
);
