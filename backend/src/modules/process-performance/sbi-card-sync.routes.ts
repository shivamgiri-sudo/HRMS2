/**
 * SBI Card live-sync routes (all under /api/process-performance).
 *
 *  POST /sbi-card-sync            – trigger ViciDial → mas_hrms sync for a date or range
 *  GET  /sbi-card-sync/status     – last N sync log entries
 *  POST /sbi-card-sync/roster     – manual roster upload (CSV/JSON rows) → sbi_card_roster
 *  GET  /sbi-card-sync/test-conn  – test ViciDial connectivity (admin only)
 */
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { syncSbiCardRange, testVicidialConnection, getProcessId } from "./sbi-card-vicidial-sync.service.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { randomUUID } from "node:crypto";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const SYNC_ROLES = ["admin", "super_admin", "ceo", "coo", "manager", "process_manager", "operations_manager", "branch_head"];
const VIEWER_ROLES = [...SYNC_ROLES, "qa", "quality_analyst", "tq_head"];

// ── Trigger sync ──────────────────────────────────────────────────────────────
router.post("/sbi-card-sync", requireRole(...SYNC_ROLES), h(async (req, res) => {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const from = typeof req.body?.from === "string" ? req.body.from : todayStr;
  const to   = typeof req.body?.to   === "string" ? req.body.to   : from;
  const userId = (req as AuthenticatedRequest & { user?: { id?: string } }).user?.id ?? null;
  const results = await syncSbiCardRange(from, to, userId ?? null);
  const hasError = results.some((r) => r.error);
  res.json({ success: !hasError, results });
}));

// ── Sync status / log ─────────────────────────────────────────────────────────
router.get("/sbi-card-sync/status", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const pid = await getProcessId();
  if (!pid) { res.json({ success: true, data: { configured: false, logs: [] } }); return; }
  const conn = await testVicidialConnection();
  let logs: RowDataPacket[] = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT sync_date, trigger_source, status, rows_dialer_mis, rows_agent_mis, rows_agent_time,
              rows_roster, error_message, started_at, finished_at
       FROM sbi_card_live_sync_log
       WHERE process_id = ?
       ORDER BY started_at DESC LIMIT 30`,
      [pid],
    );
    logs = rows;
  } catch { /* table might not exist yet */ }
  res.json({ success: true, data: { configured: conn.ok, vicidialError: conn.error ?? null, logs } });
}));

// ── Test connection ───────────────────────────────────────────────────────────
router.get("/sbi-card-sync/test-conn", requireRole("admin", "super_admin"), h(async (_req, res) => {
  const result = await testVicidialConnection();
  res.json({ success: result.ok, error: result.error ?? null });
}));

// ── Roster upload (JSON body or multipart not needed — accept JSON rows) ──────
/**
 * Upload roster rows to sbi_card_roster.
 * Body: { rows: Array<{ dialerId, employeeId, name, gh, team, teamLeader, mode }> }
 * Upserts every row; non-supplied fields are kept from the existing record.
 * After upsert, back-fills sbi_card_agent_mis.employee_id for all history.
 */
router.post("/sbi-card-sync/roster", requireRole(...SYNC_ROLES), h(async (req, res) => {
  const pid = await getProcessId();
  if (!pid) { res.status(422).json({ success: false, message: "SBI_CARD process not configured." }); return; }

  const rows = Array.isArray(req.body?.rows) ? req.body.rows as Record<string, unknown>[] : [];
  if (rows.length === 0) { res.status(400).json({ success: false, message: "rows array is required and must not be empty." }); return; }

  let upserted = 0;
  for (const r of rows) {
    const dialerId    = String(r.dialerId    ?? r.dialer_id    ?? "").trim();
    const employeeId  = r.employeeId  != null ? String(r.employeeId  ?? r.employee_id  ?? "").trim() || null : null;
    const name        = r.name        != null ? String(r.name).trim() || null : null;
    const gh          = r.gh          != null ? String(r.gh).trim()   || null : null;
    const team        = r.team        != null ? String(r.team).trim() || null : null;
    const teamLeader  = r.teamLeader  != null ? String(r.teamLeader ?? r.team_leader ?? "").trim() || null : null;
    const mode        = r.mode        != null ? String(r.mode).trim() || null : null;
    if (!dialerId) continue;
    await db.execute(`
      INSERT INTO sbi_card_roster
        (id, process_id, dialer_id, employee_id, agent_name, gh, team, team_leader, mode, data_source)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'manual_upload')
      ON DUPLICATE KEY UPDATE
        employee_id = COALESCE(VALUES(employee_id), employee_id),
        agent_name  = COALESCE(VALUES(agent_name),  agent_name),
        gh          = COALESCE(VALUES(gh),          gh),
        team        = COALESCE(VALUES(team),        team),
        team_leader = COALESCE(VALUES(team_leader), team_leader),
        mode        = COALESCE(VALUES(mode),        mode),
        data_source = VALUES(data_source),
        updated_at  = NOW()
    `, [pid, dialerId, employeeId, name, gh, team, teamLeader, mode]);
    upserted++;
  }

  // Back-fill agent_mis with updated employee_id / team / team_leader
  await db.execute(`
    UPDATE sbi_card_agent_mis am
    JOIN sbi_card_roster ro ON ro.process_id = am.process_id AND ro.dialer_id = am.dialer_id
    SET am.employee_id  = COALESCE(ro.employee_id,  am.employee_id),
        am.team         = COALESCE(ro.team,         am.team),
        am.team_leader  = COALESCE(ro.team_leader,  am.team_leader)
    WHERE am.process_id = ?
      AND ro.employee_id IS NOT NULL
  `, [pid]);

  res.json({ success: true, upserted, message: `${upserted} roster row(s) saved and agent MIS back-filled.` });
}));

// ── GET roster ────────────────────────────────────────────────────────────────
router.get("/sbi-card-sync/roster", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const pid = await getProcessId();
  if (!pid) { res.json({ success: true, data: [] }); return; }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dialer_id, employee_id, agent_name, gh, team, team_leader, mode, data_source, updated_at
     FROM sbi_card_roster WHERE process_id = ? ORDER BY agent_name`,
    [pid],
  );
  res.json({ success: true, data: rows });
}));

export { router as sbiCardSyncRouter };
