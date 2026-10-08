import { Router } from "express";
import type { Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { businessCommandService } from "./business-command.service.js";
import { revenueRiskService } from "../revenue-risk/revenue-risk.service.js";
import { hasRole } from "../../shared/accessGuard.js";
import { hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { resolveProcessScope } from "../dashboards/process-scope-guards.js";
import { PAYROLL_ROLES } from "../../platform/policy/roles.js";

export const businessCommandRouter = Router();
businessCommandRouter.use(requireAuth);

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

interface LatestDateRow extends RowDataPacket {
  latest_date: string | null;
}

/**
 * Whether the caller may see salary/payroll totals in this dashboard.
 *
 * /overview was returning org-wide gross/net payroll figures (executive_summary.
 * latest_payroll_gross_inr, the `payroll` block, data_confidence.payroll) to any
 * authenticated user regardless of role — this route only ever checked requireAuth.
 * CLAUDE.md is explicit that payroll/salary data must never surface through a
 * non-payroll endpoint, so the fields are redacted per-caller here rather than the
 * whole dashboard being locked behind a payroll role — same pattern already used in
 * management.routes.ts's callerHasPayrollAccess.
 */
async function callerHasPayrollAccess(userId: string): Promise<boolean> {
  return hasRole(userId, ...(PAYROLL_ROLES as string[]));
}

/** null for org-wide callers; otherwise the processes inside the caller's branch / assigned scope. */
async function allowedProcesses(req: AuthenticatedRequest): Promise<ReadonlySet<string> | null> {
  const scope = await resolveProcessScope(req.authUser!.id);
  return scope.orgWide ? null : scope.processIds;
}

businessCommandRouter.get("/overview", h(async (req, res) => {
  // The revenue-risk block is limited to the caller's processes. The remaining company-wide counts
  // (attendance, support, grievance, people-risk) are not branch-attributable here - see report.
  const allowed = await allowedProcesses(req);
  const data = (allowed ? await businessCommandService.overview(allowed) : await businessCommandService.overview()) as Record<string, any>;
  if (!(await callerHasPayrollAccess(req.authUser!.id))) {
    data.executive_summary = { ...data.executive_summary, latest_payroll_gross_inr: null };
    data.payroll = { latest_gross: null, latest_net: null };
    data.data_confidence = { ...data.data_confidence, payroll: null };
  }
  res.json({ success: true, data });
}));

businessCommandRouter.get("/revenue-risk/options", h(async (req, res) => {
  const allowedOpt = await allowedProcesses(req);
  const clients = await tableExists("client_master")
    ? (await db.execute<RowDataPacket[]>(
        `SELECT id, client_name AS name
           FROM client_master
          WHERE COALESCE(active_status, 1) = 1
          ORDER BY client_name
          LIMIT 500`,
          )
        )[0]
      : [];

    const processes = (await tableExists("process_master"))
      ? (
          await db.execute<RowDataPacket[]>(
            `SELECT p.id,
                p.process_name AS name,
                p.client_id,
                cm.client_name
           FROM process_master p
           LEFT JOIN client_master cm ON cm.id = p.client_id
          WHERE COALESCE(p.active_status, 1) = 1
          ORDER BY cm.client_name, p.process_name
          LIMIT 1000`,
          )
        )[0]
      : [];

  if (allowedOpt) {
    const ps = (processes as any[]).filter((p) => allowedOpt.has(String(p.id)));
    const clientIds = new Set(ps.map((p) => String(p.client_id)));
    return res.json({ success: true, data: { clients: (clients as any[]).filter((c) => clientIds.has(String(c.id))), processes: ps } });
  }
  res.json({ success: true, data: { clients, processes } });
}));

businessCommandRouter.get("/revenue-risk/contracts", h(async (req, res) => {
  const allowed = await allowedProcesses(req);
  res.json({ success: true, data: allowed ? await revenueRiskService.listContracts(allowed) : await revenueRiskService.listContracts() });
}));

businessCommandRouter.post("/revenue-risk/contracts", h(async (req, res) => {
  const allowed = await allowedProcesses(req);
  if (allowed && !(req.body?.process_id && allowed.has(String(req.body.process_id)))) {
    return res.status(403).json({ success: false, message: "Forbidden: this process is outside your branch / assigned scope" });
  }
  res.status(201).json({ success: true, data: await revenueRiskService.createContract(req.body, req.authUser!.id) });
}));

businessCommandRouter.get("/revenue-risk/snapshot", h(async (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
  const allowed = await allowedProcesses(req);
  res.json({ success: true, data: allowed ? await revenueRiskService.snapshot(date, allowed) : await revenueRiskService.snapshot(date) });
}));

businessCommandRouter.post(
  "/revenue-risk/generate-daily",
  h(async (req, res) => {
    // Default to latest date that has attendance data (COSEC may lag 1-2 days behind today)
    let date = String(req.body?.date ?? "");
    if (!date || date === "today") {
      const [latestRows] = await db.execute<LatestDateRow[]>(
        "SELECT DATE_FORMAT(MAX(record_date), '%Y-%m-%d') AS latest_date FROM attendance_daily_record",
      );
      date =
        latestRows[0]?.latest_date ?? new Date().toISOString().slice(0, 10);
    }
  const allowed = await allowedProcesses(req);
  // Persisting rewrites the company-wide daily table: org-wide callers only; others get the scoped figures unsaved.
  res.json({ success: true, data: allowed ? await revenueRiskService.calculate(date, false, allowed) : await revenueRiskService.calculate(date, true) });
}));

// GET /api/business-command/workforce-mandates — list mandates
businessCommandRouter.get("/workforce-mandates", h(async (req, res) => {
  const allowed = await allowedProcesses(req);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wm.*, pm.process_name, cm.client_name
       FROM workforce_mandate wm
       LEFT JOIN process_master pm ON pm.id = wm.process_id
       LEFT JOIN client_master cm ON cm.id = wm.client_id
      WHERE wm.active_status = 1
      ORDER BY pm.process_name ASC, wm.effective_from DESC
      LIMIT 500`
  );
  res.json({ success: true, data: allowed ? (rows as any[]).filter((r) => r.process_id && allowed.has(String(r.process_id))) : rows });
}));

// POST /api/business-command/workforce-mandates — create/update mandate for a process
businessCommandRouter.post(
  "/workforce-mandates",
  h(async (req, res) => {
    const {
      process_id,
      client_id,
      mandated_hc,
      effective_from,
      effective_to,
      hc_type,
    } = req.body;
    if (!process_id)
      return res
        .status(400)
        .json({ success: false, error: "process_id is required" });
    if (!mandated_hc || Number(mandated_hc) < 1)
      return res
        .status(400)
        .json({ success: false, error: "mandated_hc must be >= 1" });
    if (!effective_from)
      return res
        .status(400)
        .json({ success: false, error: "effective_from is required" });

  // A WFM-only caller may set Required HC only for a process in a branch assigned to them.
  // Everyone else who already reached this endpoint keeps their existing (unrestricted) access.
  const userId = req.authUser!.id;
  const isWfm = await hasAnyRole(userId, "wfm", "branch_wfm");
  const isBroader = await hasAnyRole(
    userId, "super_admin", "admin", "hr", "ceo", "coo", "manager", "operations_manager", "process_manager", "branch_head"
  );
  // Owner ruling 2026-10-01: every non-org-wide caller (hr, manager, branch_head ... not just WFM) is limited to
  // processes inside their own branch / assigned scope.
  const scopedProcesses = await allowedProcesses(req);
  if (scopedProcesses && !scopedProcesses.has(String(process_id))) {
    return res.status(403).json({ success: false, error: "You can only change the seat count for a process in a branch assigned to you." });
  }
  if (isWfm && !isBroader) {
    const [procRows] = await db.execute<RowDataPacket[]>(
      "SELECT branch_id FROM process_master WHERE id = ? LIMIT 1",
      [process_id]
    );
    if (isWfm && !isBroader) {
      const [procRows] = await db.execute<RowDataPacket[]>(
        "SELECT branch_id FROM process_master WHERE id = ? LIMIT 1",
        [process_id],
      );
      const branchId = (procRows as RowDataPacket[])[0]?.branch_id ?? null;
      const allowed = branchId
        ? await hasScopedAccess(userId, ["wfm", "branch_wfm"], {
            branchId: String(branchId),
            processId: String(process_id),
          })
        : false;
      if (!allowed) {
        return res
          .status(403)
          .json({
            success: false,
            error:
              "You can only change the seat count for a process in a branch assigned to you.",
          });
      }
    }

    const { randomUUID } = await import("crypto");
    const id = randomUUID();
    await db.execute(
      `INSERT INTO workforce_mandate
       (id, process_id, client_id, mandated_hc, hc_type, effective_from, effective_to, active_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      process_id,
      client_id ?? null,
      Number(mandated_hc),
      hc_type ?? "production",
      effective_from,
      effective_to ?? null,
      req.authUser!.id,
    ]
  );
  void import("../process-pnl/seat-mandate-sync.service.js").then(async ({ sumWfmMandate, syncProcessSeatsSafe }) => {
    const total = await sumWfmMandate(String(process_id));
    if (total !== null) syncProcessSeatsSafe({ processId: String(process_id), seats: total, source: "wfm_mandate", actorId: req.authUser!.id });
  }).catch(() => undefined);
  res.status(201).json({ success: true, data: { id } });
}));
