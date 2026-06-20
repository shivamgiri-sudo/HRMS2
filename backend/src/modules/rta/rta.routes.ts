import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { hasProcessScope } from "../../shared/accessGuard.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  reconciliationService,
  shrinkageService,
  alertService,
  payrollReadinessService,
  leaveImpactService,
  getLiveAttendanceSummary,
} from "./rta.service.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export const rtaRouter = Router();
rtaRouter.use(requireAuth);

const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Reconciliation ───────────────────────────────────────────────────────────

// POST /api/rta/reconcile — trigger reconciliation for a date
// Requires: admin | hr | wfm | process_manager
rtaRouter.post(
  "/reconcile",
  requireRole("admin", "hr", "wfm", "process_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      date: z.string().regex(DATE_RE),
      processName: z.string().optional(),
      branchName:  z.string().optional(),
    });
    const { date, processName, branchName } = schema.parse(req.body);

    const result = await reconciliationService.reconcileDate(date, {
      processName, branchName, userId: req.authUser!.id,
    });

    // Fire alerts after reconciliation
    const alertCount = await alertService.fireAlertsForDate(date, { userId: req.authUser!.id });

    // Build shrinkage snapshot
    await shrinkageService.calculateSnapshot(date, { userId: req.authUser!.id });

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "ATTENDANCE_RECONCILE",
      module_key: "rta",
      entity_type: "reconciliation",
      entity_id: date,
      change_summary: { date, ...result, alerts_fired: alertCount },
      req,
    });

    return res.json({ success: true, data: { ...result, alerts_fired: alertCount } });
  })
);

// GET /api/rta/reconciliation — list records
rtaRouter.get(
  "/reconciliation",
  requireRole("admin", "hr", "wfm", "process_manager", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      fromDate:    z.string().regex(DATE_RE),
      toDate:      z.string().regex(DATE_RE),
      employeeId:  z.string().uuid().optional(),
      processId:   z.string().uuid().optional(),
      processName: z.string().optional(),
      status:      z.string().optional(),
      page:        z.coerce.number().int().min(1).default(1),
      limit:       z.coerce.number().int().min(1).max(200).default(50),
    });
    const filters = schema.parse(req.query);
    const result  = await reconciliationService.listReconciliation(filters);
    return res.json({ success: true, ...result });
  })
);

// GET /api/rta/live-summary — bearer-authenticated live attendance summary.
rtaRouter.get(
  "/live-summary",
  requireRole("admin", "hr", "wfm", "process_manager", "team_leader", "assistant_manager", "manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      date: z.string().regex(DATE_RE),
      processId: z.string().uuid().optional(),
      branchId: z.string().uuid().optional(),
    });
    const { date, processId, branchId } = schema.parse(req.query);
    const data = await getLiveAttendanceSummary(date, { processId, branchId });
    return res.json({ success: true, data });
  })
);

// ─── Shrinkage ────────────────────────────────────────────────────────────────

// GET /api/rta/shrinkage — list snapshots
rtaRouter.get(
  "/shrinkage",
  requireRole("admin", "hr", "wfm", "process_manager", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      fromDate:  z.string().regex(DATE_RE),
      toDate:    z.string().regex(DATE_RE),
      processId: z.string().uuid().optional(),
      branchId:  z.string().uuid().optional(),
    });
    const filters = schema.parse(req.query);
    const data = await shrinkageService.listSnapshots(filters);
    return res.json({ success: true, data });
  })
);

// POST /api/rta/shrinkage/snapshot — manually compute snapshot for a date
rtaRouter.post(
  "/shrinkage/snapshot",
  requireRole("admin", "hr", "wfm"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      date:      z.string().regex(DATE_RE),
      processId: z.string().uuid().optional(),
      branchId:  z.string().uuid().optional(),
    });
    const { date, processId, branchId } = schema.parse(req.body);
    const data = await shrinkageService.calculateSnapshot(date, { processId, branchId, userId: req.authUser!.id });
    return res.json({ success: true, data });
  })
);

// ─── Adherence Alerts ─────────────────────────────────────────────────────────

// GET /api/rta/alerts
rtaRouter.get(
  "/alerts",
  requireRole("admin", "hr", "wfm", "process_manager", "team_leader", "assistant_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      fromDate:   z.string().regex(DATE_RE).optional(),
      toDate:     z.string().regex(DATE_RE).optional(),
      status:     z.enum(["open", "acknowledged", "resolved", "suppressed"]).optional(),
      processId:  z.string().uuid().optional(),
      employeeId: z.string().uuid().optional(),
      page:       z.coerce.number().int().min(1).default(1),
      limit:      z.coerce.number().int().min(1).max(200).default(50),
    });
    const filters = schema.parse(req.query);
    const data = await alertService.listAlerts(filters);
    return res.json({ success: true, data });
  })
);

// PATCH /api/rta/alerts/:id/acknowledge
rtaRouter.patch(
  "/alerts/:id/acknowledge",
  requireRole("admin", "hr", "wfm", "process_manager", "team_leader"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await alertService.acknowledgeAlert(req.params.id, req.authUser!.id);
    return res.json({ success: true, message: "Alert acknowledged" });
  })
);

// ─── Leave Staffing Impact ────────────────────────────────────────────────────

// POST /api/rta/leave-impact/:leaveRequestId — calculate impact for a leave request
rtaRouter.post(
  "/leave-impact/:leaveRequestId",
  requireRole("admin", "hr", "wfm"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const days = await leaveImpactService.calculateLeaveImpact(req.params.leaveRequestId);
    return res.json({ success: true, data: { days_impacted: days } });
  })
);

// GET /api/rta/leave-impact — list impacts
rtaRouter.get(
  "/leave-impact",
  requireRole("admin", "hr", "wfm", "process_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      fromDate:    z.string().regex(DATE_RE).optional(),
      toDate:      z.string().regex(DATE_RE).optional(),
      impactLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
    });
    const filters = schema.parse(req.query);
    const data = await leaveImpactService.listImpacts(filters);
    return res.json({ success: true, data });
  })
);

// ─── Payroll Readiness ────────────────────────────────────────────────────────

// POST /api/rta/payroll-readiness/generate — generate readiness flags for a period
// Requires explicit payroll/finance role — sensitive audit output
rtaRouter.post(
  "/payroll-readiness/generate",
  requireRole("admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      periodStart: z.string().regex(DATE_RE),
      periodEnd:   z.string().regex(DATE_RE),
      processId:   z.string().uuid().optional(),
    });
    const { periodStart, periodEnd, processId } = schema.parse(req.body);

    const result = await payrollReadinessService.generateReadinessFlags(
      periodStart, periodEnd, { processId, userId: req.authUser!.id }
    );

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "PAYROLL_READINESS_GENERATED",
      module_key: "rta",
      entity_type: "payroll_readiness_flag",
      entity_id: `${periodStart}/${periodEnd}`,
      change_summary: result,
      req,
    });

    return res.json({ success: true, data: result });
  })
);

// GET /api/rta/payroll-readiness — list flags
rtaRouter.get(
  "/payroll-readiness",
  requireRole("admin", "finance", "payroll", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const schema = z.object({
      periodStart: z.string().regex(DATE_RE).optional(),
      status:      z.string().optional(),
      employeeId:  z.string().uuid().optional(),
      page:        z.coerce.number().int().min(1).default(1),
      limit:       z.coerce.number().int().min(1).max(200).default(50),
    });
    const filters = schema.parse(req.query);
    const data = await payrollReadinessService.listFlags(filters);
    return res.json({ success: true, data });
  })
);

// ─── Live Attendance SSE Stream ───────────────────────────────────────────────

// GET /api/rta/live-stream — SSE stream of live attendance summary
// Sends an immediate snapshot then updates every 30 seconds.
// Auth is handled by the router-level requireAuth middleware above.
// EventSource cannot send custom headers, so authentication relies on the
// session cookie that the browser sends automatically with withCredentials:true.
rtaRouter.get("/live-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const processId = req.query.process_id as string | undefined;
  const branchId  = req.query.branch_id  as string | undefined;
  const date      = (req.query.date as string) || new Date().toISOString().slice(0, 10);

  const sendSnapshot = async () => {
    try {
      const conds: string[] = ["s.session_date = ?"];
      const params: unknown[] = [date];

      if (processId) { conds.push("e.process_id = ?"); params.push(processId); }
      if (branchId)  { conds.push("e.branch_id = ?");  params.push(branchId);  }

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(DISTINCT e.id)                                                                AS rostered,
           SUM(CASE WHEN s.current_status IN ('Logged In','On Break') THEN 1 ELSE 0 END)      AS logged_in,
           SUM(CASE WHEN s.current_status = 'Logged Out' THEN 1 ELSE 0 END)                   AS logged_out,
           SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END)                                      AS absent,
           ROUND(AVG(s.adherence_pct), 1)                                                     AS adherence_pct
         FROM employees e
         LEFT JOIN wfm_attendance_session s
           ON s.employee_id = e.id AND s.session_date = ?
         WHERE e.LOWER(employment_status) = 'active'
           AND e.active_status = 1
           ${processId ? "AND e.process_id = ?" : ""}
           ${branchId  ? "AND e.branch_id = ?"  : ""}`,
        [date, ...params],
      );

      const data = (rows as RowDataPacket[])[0] ?? {};
      res.write(`data: ${JSON.stringify({ ts: Date.now(), ...data })}\n\n`);
    } catch {
      res.write(`data: ${JSON.stringify({ error: "fetch_failed" })}\n\n`);
    }
  };

  void sendSnapshot();
  const interval = setInterval(() => void sendSnapshot(), 30_000);

  req.on("close", () => {
    clearInterval(interval);
    res.end();
  });
});

// ─── Final Roster State for RTA ──────────────────────────────────────────────
// GET /api/rta/final-roster-state?processId=&date=
// Returns per-employee RTA state from wfm_roster_assignment.
// Only returns records with final_roster_status suitable for live tracking.
rtaRouter.get("/final-roster-state", requireRole("admin", "wfm", "hr", "manager", "operations"), h(async (req: any, res: any) => {
  const { processId, date } = req.query;
  if (!date || !DATE_RE.test(date)) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });

  const params: unknown[] = [date];
  let processCond = "";
  if (processId) { processCond = " AND pm.id = ?"; params.push(processId); }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wra.id, wra.employee_id, wra.roster_date, wra.is_week_off,
            wra.final_roster_status, wra.employee_ack_status,
            wra.manager_action_status, wra.system_decision_reason,
            wst.shift_name, wst.start_time, wst.end_time,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
            e.employee_code, pm.process_name, bm.branch_name,
            CASE
              WHEN wra.is_week_off = 1 AND wra.final_roster_status IN
                ('approved_final','force_approved_by_manager','realigned_by_manager','published_to_rta')
                THEN 'Week Off'
              WHEN wra.final_roster_status = 'pending_manager_action'
                THEN 'Pending Manager Action'
              WHEN wra.final_roster_status = 'escalated_to_hr'
                THEN 'Roster Dispute'
              WHEN wra.final_roster_status = 'pending_employee_ack'
                THEN 'Pending Acknowledgement'
              WHEN wra.final_roster_status IN ('acknowledged','approved_final','published_to_rta',
                'force_approved_by_manager','realigned_by_manager')
                THEN 'Scheduled'
              ELSE wra.final_roster_status
            END AS rta_exception_label
       FROM wfm_roster_assignment wra
       JOIN employees e ON e.id = wra.employee_id
       LEFT JOIN process_master pm ON pm.process_name = wra.process_name
       LEFT JOIN branch_master bm ON bm.branch_name = wra.branch_name
       LEFT JOIN wfm_shift_template wst ON wst.id = wra.shift_template_id
      WHERE wra.roster_date = ?
        AND wra.final_roster_status IN (
          'approved_final',
          'force_approved_by_manager',
          'realigned_by_manager',
          'published_to_rta'
        )${processCond}
      ORDER BY e.employee_code ASC`,
    params
  );
  return res.json({ success: true, data: rows });
}));
