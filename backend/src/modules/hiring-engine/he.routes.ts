// Hiring Engine API (authenticated) — mounted at /api/he. Org-wide recruitment roles only for now;
// branch-scoped boards arrive with drives.
import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent, backfillLeadPool } from "./he-lead.service.js";
import { createDrive, setDriveStatus, suggestMatchesDetailed } from "./he-drive.service.js";
import { runEngineTick } from "./he-engine.service.js";
import { getBoard, runHrArrivalAlerts } from "./he-alert.service.js";
import { placeVoiceCall } from "./he-voice.service.js";
import { cancelBulkBatch, createBulkCallBatch, getBulkBatchJobs, listBulkBatches, previewBulkCalls, runBulkCallJobs, startBulkBatch } from "./he-bulk-call.service.js";
import { BULK_CALL_MAX_ROWS, sampleCsv } from "./he-bulk-call.js";
import { listPrepareCampaigns, prepareMissedWalkins, prepareRowsFromCampaigns } from "./he-bulk-call-prepare.service.js";
import { applyCallResults, markExportedForCalling, previewCallResults } from "./he-call-results.service.js";
import { getCandidate360 } from "./he-candidate360.service.js";
import { refreshProfilesChunk } from "./he-profile.service.js";
import { planHiring } from "./he-planner.service.js";
import { ingestCandidates } from "./he-intake.service.js";
import { getControlRoom, learnMatchWeights, learnShowUp } from "./he-showup.service.js";
import { INTAKE_SOURCES, type IntakeSource } from "./he-intake.js";
import { listOpenClashes, resolveClash } from "./he-identity.service.js";
import { refreshExEmployees } from "./he-ex-employee.service.js";
import { getMasterSummary, listPrefixes, refreshHistoryChunk } from "./he-master.service.js";
import { getMetaRecruitment } from "./he-meta-recruitment.service.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

export const heRouter = Router();
const VIEW_ROLES = ["super_admin", "admin", "hr", "hr_admin", "recruitment_hr", "ceo"];
const ADMIN_ROLES = ["super_admin", "admin"];

heRouter.get("/summary", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try {
    const [byStatus] = await db.execute<RowDataPacket[]>("SELECT status, COUNT(*) AS n FROM he_lead GROUP BY status");
    const [byAction] = await db.execute<RowDataPacket[]>("SELECT next_action, COUNT(*) AS n FROM he_lead_insight GROUP BY next_action");
    const [bySource] = await db.execute<RowDataPacket[]>("SELECT primary_source, COUNT(*) AS n FROM he_lead GROUP BY primary_source");
    const [handoff] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT lead_id) AS n FROM he_lead_event e WHERE event_type = 'needs_human_followup'
          AND NOT EXISTS (SELECT 1 FROM he_lead_event d WHERE d.lead_id = e.lead_id AND d.event_type = 'human_followup_done' AND d.id > e.id)`);
    res.json({ success: true, data: { byStatus, byAction, bySource, humanFollowupOpen: Number(handoff[0]?.n ?? 0) } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] summary failed");
    res.status(500).json({ success: false, message: "Could not load summary" });
  }
});

heRouter.get("/leads", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, Number(req.query.size) || 25));
    const where: string[] = [];
    const args: unknown[] = [];
    for (const [q, col] of [["status", "l.status"], ["source", "l.primary_source"], ["action", "i.next_action"]] as const) {
      if (typeof req.query[q] === "string" && req.query[q]) { where.push(`${col} = ?`); args.push(req.query[q]); }
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      where.push("(l.full_name LIKE ? OR l.mobile10 LIKE ?)");
      const like = `%${req.query.q.trim()}%`; args.push(like, like);
    }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.id, l.mobile10, l.full_name, l.status, l.primary_source, l.last_contact_at, l.created_at,
              i.engagement_score, i.reliability_score, i.best_channel, i.best_hour_ist, i.next_action, i.next_action_reason
         FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id ${w}
        ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size]);
    const [cnt] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id ${w}`, args);
    res.json({ success: true, data: rows, total: Number(cnt[0].n), page, size });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] leads failed");
    res.status(500).json({ success: false, message: "Could not load leads" });
  }
});

heRouter.get("/leads/:id", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const id = String(req.params.id);
    const [lead] = await db.execute<RowDataPacket[]>("SELECT * FROM he_lead WHERE id = ? LIMIT 1", [id]);
    if (!lead[0]) return res.status(404).json({ success: false, message: "Lead not found" });
    const [insight] = await db.execute<RowDataPacket[]>("SELECT * FROM he_lead_insight WHERE lead_id = ? LIMIT 1", [id]);
    const [events] = await db.execute<RowDataPacket[]>("SELECT event_type, channel, detail, actor, created_at FROM he_lead_event WHERE lead_id = ? ORDER BY id DESC LIMIT 200", [id]);
    const [messages] = await db.execute<RowDataPacket[]>("SELECT direction, channel, template_key, body, delivery_status, intent, created_at FROM he_message WHERE lead_id = ? ORDER BY created_at DESC LIMIT 100", [id]);
    const [calls] = await db.execute<RowDataPacket[]>(
      `SELECT attempt_no, started_at, duration_s, identity_confirmed, email_received, assessment_done, original_slot_answer, offered_slot_answer,
              outcome, decline_reason, sentiment, handoff_reason, summary, recording_url FROM he_call WHERE lead_id = ? ORDER BY created_at DESC LIMIT 20`, [id]);
    const [signals] = await db.execute<RowDataPacket[]>("SELECT signal_key, signal_value, confidence, source, observed_at FROM he_signal WHERE lead_id = ? ORDER BY id DESC LIMIT 200", [id]);
    const [consent] = await db.execute<RowDataPacket[]>("SELECT consent_type, text_version, source, granted_at, revoked_at FROM he_consent WHERE lead_id = ?", [id]);
    res.json({ success: true, data: { lead: lead[0], insight: insight[0] ?? null, events, messages, calls, signals, consent } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] lead detail failed");
    res.status(500).json({ success: false, message: "Could not load lead" });
  }
});

/** Dry run by default (counts only). Writes need dryRun=false explicitly; Meta-form consent needs its own flag. */
heRouter.post("/backfill", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const b = (req.body ?? {}) as { dryRun?: boolean; grantMetaFormConsent?: boolean };
    const r = await backfillLeadPool({ dryRun: b.dryRun !== false, grantMetaFormConsent: b.grantMetaFormConsent === true });
    res.json({ success: true, dryRun: b.dryRun !== false, data: r });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] backfill failed");
    res.status(500).json({ success: false, message: "Backfill failed" });
  }
});

// ── Drives ────────────────────────────────────────────────────────────────────────────────────

const WRITE_ROLES = ["super_admin", "admin", "hr", "hr_admin", "recruitment_hr"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

heRouter.get("/requisitions/open", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, requisition_code, designation_name, process_name, branch_name, requested_headcount, fulfilled_headcount,
              (requested_headcount - fulfilled_headcount) AS open_positions, priority
         FROM job_requisition
        WHERE approval_status = 'approved' AND active_status = 1 AND fulfilled_headcount < requested_headcount
        ORDER BY FIELD(priority,'urgent','high','normal','low'), open_positions DESC LIMIT 300`);
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] open requisitions failed");
    res.status(500).json({ success: false, message: "Could not load requisitions" });
  }
});

heRouter.get("/drives", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT d.id, d.requisition_id, d.branch_name, d.drive_date, d.slot_start, d.slot_end, d.slot_capacity, d.target_shows, d.show_rate_pct, d.status, d.auto_send,
              jr.designation_name, jr.requisition_code, (jr.requested_headcount - jr.fulfilled_headcount) AS open_positions,
              SUM(m.state = 'suggested') AS suggested, SUM(m.state = 'invited') AS invited, SUM(m.state = 'confirmed') AS confirmed,
              SUM(m.state = 'arrived') AS arrived, SUM(m.state = 'no_show') AS no_show, SUM(m.state = 'declined') AS declined
         FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id LEFT JOIN he_match m ON m.drive_id = d.id
        WHERE d.drive_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        GROUP BY d.id ORDER BY d.drive_date DESC, d.branch_name LIMIT 200`);
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] drives failed");
    res.status(500).json({ success: false, message: "Could not load drives" });
  }
});

heRouter.post("/drives", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.requisitionId !== "string" || typeof b.driveDate !== "string" || !DATE_RE.test(b.driveDate)) {
    return res.status(400).json({ success: false, message: "requisitionId and driveDate (YYYY-MM-DD) are required" });
  }
  try {
    const r = await createDrive({
      requisitionId: b.requisitionId, driveDate: b.driveDate,
      slotStart: typeof b.slotStart === "string" ? b.slotStart : undefined, slotEnd: typeof b.slotEnd === "string" ? b.slotEnd : undefined,
      slotMinutes: Number(b.slotMinutes) || undefined, slotCapacity: Number(b.slotCapacity) || undefined, showRatePct: Number(b.showRatePct) || undefined,
      autoSend: b.autoSend === true, createdBy: (req as AuthenticatedRequest).authUser?.id ?? null,
    });
    res.json({ success: true, data: r });
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
});

heRouter.post("/drives/:id/status", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const status = String((req.body ?? {}).status);
  if (!["draft", "active", "paused", "closed"].includes(status)) return res.status(400).json({ success: false, message: "invalid status" });
  try { await setDriveStatus(String(req.params.id), status as "draft"); res.json({ success: true }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] drive status failed"); res.status(500).json({ success: false }); }
});

heRouter.post("/drives/:id/suggest", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try { res.json({ success: true, data: await suggestMatchesDetailed(String(req.params.id)) }); }
  catch (err) { res.status(400).json({ success: false, message: (err as Error).message }); }
});

heRouter.get("/drives/:id/matches", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.state, m.score, m.slot_at, m.distance_km, l.id AS lead_id, l.full_name, l.mobile10,
              p.created_at AS ping_at, p.distance_km AS live_km, p.eta_min
         FROM he_match m JOIN he_lead l ON l.id = m.lead_id
         LEFT JOIN he_location_ping p ON p.id = (SELECT MAX(id) FROM he_location_ping WHERE match_id = m.id)
        WHERE m.drive_id = ? ORDER BY m.slot_at IS NULL, m.slot_at, m.score DESC LIMIT 500`, [String(req.params.id)]);
    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] drive matches failed");
    res.status(500).json({ success: false });
  }
});

// ── Engine controls ───────────────────────────────────────────────────────────────────────────
/** Dry run unless the body says dryRun:false explicitly. */
heRouter.post("/engine/tick", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const dryRun = (req.body ?? {}).dryRun !== false;
    res.json({ success: true, data: { tick: await runEngineTick({ dryRun }), alerts: await runHrArrivalAlerts({ dryRun }) } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] tick failed");
    res.status(500).json({ success: false, message: "Tick failed" });
  }
});

heRouter.get("/templates", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT template_key, pinbot_name, language, approval_state, updated_at FROM he_template ORDER BY template_key");
    res.json({ success: true, data: rows, sendsPaused: process.env.HE_SENDS_PAUSED === "true" });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] templates failed");
    res.status(500).json({ success: false });
  }
});

/** Record Meta's decision. Only an approved row can ever be sent. */
heRouter.patch("/templates/:key", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  const b = (req.body ?? {}) as { approvalState?: string; pinbotName?: string };
  if (b.approvalState && !["draft", "submitted", "approved", "rejected"].includes(b.approvalState)) return res.status(400).json({ success: false, message: "invalid approvalState" });
  if (b.pinbotName && !/^[a-z0-9_]{1,120}$/.test(b.pinbotName)) return res.status(400).json({ success: false, message: "pinbotName must be lowercase letters, digits, underscores" });
  try {
    const [r] = await db.execute<ResultSetHeader>(
      "UPDATE he_template SET approval_state = COALESCE(?, approval_state), pinbot_name = COALESCE(?, pinbot_name) WHERE template_key = ?", [b.approvalState ?? null, b.pinbotName ?? null, String(req.params.key)]);
    res.status(r.affectedRows ? 200 : 404).json({ success: r.affectedRows > 0 });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] template update failed");
    res.status(500).json({ success: false });
  }
});

heRouter.post("/leads/:id/human-done", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    await addEvent(String(req.params.id), "human_followup_done", { actor: (req as AuthenticatedRequest).authUser?.id ?? null, detail: typeof req.body?.note === "string" ? req.body.note : null });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] human-done failed");
    res.status(500).json({ success: false });
  }
});

/** Place (or preview, the default) the BRD confirmation call for one match. */
heRouter.post("/matches/:id/call", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try { res.json({ success: true, data: await placeVoiceCall(String(req.params.id), { dryRun: (req.body ?? {}).dryRun !== false }) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] call failed"); res.status(500).json({ success: false, message: "Call failed" }); }
});

heRouter.get("/board", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await getBoard(), windowMinutes: 30 }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] board failed"); res.status(500).json({ success: false, message: "Could not load the board" }); }
});

// ── Manual bulk voice calls (phone,name,role,interview_date,interview_time,branch_address,reference_id) ───────────
const bulkRows = (b: unknown): Array<Record<string, unknown>> | null =>
  Array.isArray((b as { rows?: unknown })?.rows) && (b as { rows: unknown[] }).rows.every((r) => r && typeof r === "object" && !Array.isArray(r)) ? (b as { rows: Array<Record<string, unknown>> }).rows : null;

heRouter.get("/bulk-calls/template", requireAuth, requireRole(...VIEW_ROLES), (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="voice_call_upload_template.csv"');
  res.send(sampleCsv());
});

/** Active Meta campaigns with how many qualified, future-dated candidates each has (Ahmedabad ones flagged). */
heRouter.get("/bulk-calls/campaigns", requireAuth, requireRole(...WRITE_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await listPrepareCampaigns() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] bulk campaigns failed"); res.status(500).json({ success: false, message: "Could not load campaigns" }); }
});

/** Build the calling sheet from campaigns. Returns rows only - validation, preview and queueing are the normal flow. */
heRouter.post("/bulk-calls/prepare", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const b = (req.body ?? {}) as { campaignIds?: unknown; includeConfirmed?: unknown; requireInviteSent?: unknown };
  if (!Array.isArray(b.campaignIds) || b.campaignIds.length === 0) return res.status(400).json({ success: false, message: "Select at least one campaign" });
  try {
    res.json({ success: true, data: await prepareRowsFromCampaigns({ campaignIds: b.campaignIds.map(String), includeConfirmed: b.includeConfirmed === true, requireInviteSent: b.requireInviteSent !== false, includeRecentlyExported: (req.body as { includeRecentlyExported?: unknown }).includeRecentlyExported === true }) });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] bulk prepare failed"); res.status(500).json({ success: false, message: "Could not prepare the list" }); }
});

/** Candidates who were given an interview that passed and never walked in, re-invited for a new date. */
heRouter.post("/bulk-calls/prepare-missed", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const b = (req.body ?? {}) as { campaignIds?: unknown; newDate?: unknown; slotStart?: unknown; slotEnd?: unknown; slotMinutes?: unknown; perSlot?: unknown; includeRecentlyExported?: unknown };
  if (!Array.isArray(b.campaignIds) || b.campaignIds.length === 0) return res.status(400).json({ success: false, message: "Select at least one campaign" });
  if (typeof b.newDate !== "string" || !DATE_RE.test(b.newDate)) return res.status(400).json({ success: false, message: "newDate (YYYY-MM-DD) is required" });
  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (b.newDate < todayIst) return res.status(400).json({ success: false, message: "The new interview date cannot be in the past" });
  const hhmm = (v: unknown, d: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : d; };
  try {
    res.json({ success: true, data: await prepareMissedWalkins({
      campaignIds: b.campaignIds.map(String), newDate: b.newDate, slotStart: hhmm(b.slotStart, "10:00"), slotEnd: hhmm(b.slotEnd, "17:30"),
      slotMinutes: num(b.slotMinutes, 30, 10, 120), perSlot: num(b.perSlot, 6, 1, 50), includeRecentlyExported: b.includeRecentlyExported === true,
    }) });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] prepare-missed failed"); res.status(500).json({ success: false, message: "Could not prepare the re-invite list" }); }
});

heRouter.post("/bulk-calls/preview", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const rows = bulkRows(req.body);
  if (!rows) return res.status(400).json({ success: false, message: "rows (an array of objects) is required" });
  if (rows.length === 0) return res.status(400).json({ success: false, message: "The file has no data rows" });
  if (rows.length > BULK_CALL_MAX_ROWS) return res.status(400).json({ success: false, message: `At most ${BULK_CALL_MAX_ROWS} rows per upload` });
  try { res.json({ success: true, data: await previewBulkCalls(rows) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] bulk preview failed"); res.status(500).json({ success: false, message: "Could not validate the file" }); }
});

heRouter.post("/bulk-calls", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const rows = bulkRows(req.body);
  if (!rows) return res.status(400).json({ success: false, message: "rows (an array of objects) is required" });
  try {
    const b = req.body as { label?: unknown; attest?: unknown };
    const r = await createBulkCallBatch(rows, { label: typeof b.label === "string" ? b.label : undefined, userId: (req as AuthenticatedRequest).authUser?.id ?? null, attested: b.attest === true });
    res.json({ success: true, data: r });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 500) logger.error({ err: (err as Error).message }, "[he] bulk create failed");
    res.status(status).json({ success: false, message: status === 500 ? "Could not queue the calls" : (err as Error).message });
  }
});

heRouter.get("/bulk-calls", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await listBulkBatches() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] bulk list failed"); res.status(500).json({ success: false }); }
});

heRouter.get("/bulk-calls/:id", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try { res.json({ success: true, data: await getBulkBatchJobs(String(req.params.id)) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] bulk jobs failed"); res.status(500).json({ success: false }); }
});

/** Activate the batch and dispatch the first due calls now (dry run unless dryRun:false). The scheduler continues if enabled. */
heRouter.post("/bulk-calls/:id/start", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const dryRun = (req.body ?? {}).dryRun !== false;
    const id = String(req.params.id);
    if (!dryRun && !(await startBulkBatch(id))) return res.status(404).json({ success: false, message: "Batch not found or already finished" });
    res.json({ success: true, data: await runBulkCallJobs({ batchId: id, dryRun, max: 25 }) });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] bulk start failed"); res.status(500).json({ success: false, message: "Could not start the calls" }); }
});

heRouter.post("/bulk-calls/:id/cancel", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try { res.json({ success: true, data: await cancelBulkBatch(String(req.params.id)) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] bulk cancel failed"); res.status(500).json({ success: false }); }
});

/** Log that a calling file was downloaded for the third-party tool (audit + stops the same people being exported again). */
heRouter.post("/bulk-calls/exported", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const b = (req.body ?? {}) as { mobiles?: unknown; label?: unknown; slots?: unknown; names?: unknown };
  if (!Array.isArray(b.mobiles) || b.mobiles.length === 0 || b.mobiles.length > BULK_CALL_MAX_ROWS) return res.status(400).json({ success: false, message: "mobiles (1-500) is required" });
  try { res.json({ success: true, data: await markExportedForCalling(b.mobiles.map(String), { userId: (req as AuthenticatedRequest).authUser?.id ?? null, label: typeof b.label === "string" ? b.label : undefined, slots: b.slots && typeof b.slots === "object" && !Array.isArray(b.slots) ? (b.slots as Record<string, string>) : undefined, names: b.names && typeof b.names === "object" && !Array.isArray(b.names) ? (b.names as Record<string, string>) : undefined }) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] export log failed"); res.status(500).json({ success: false }); }
});

// ── Results coming back from the third-party calling tool ─────────────────────────────────────────────────────────
heRouter.post("/call-results/preview", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const rows = bulkRows(req.body);
  if (!rows || rows.length === 0) return res.status(400).json({ success: false, message: "rows (a non-empty array of objects) is required" });
  if (rows.length > 2000) return res.status(400).json({ success: false, message: "At most 2000 rows per import" });
  try { res.json({ success: true, data: await previewCallResults(rows) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] results preview failed"); res.status(500).json({ success: false, message: "Could not read the results" }); }
});

heRouter.post("/call-results", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const rows = bulkRows(req.body);
  if (!rows || rows.length === 0) return res.status(400).json({ success: false, message: "rows (a non-empty array of objects) is required" });
  try { res.json({ success: true, data: await applyCallResults(rows, { userId: (req as AuthenticatedRequest).authUser?.id ?? null }) }); }
  catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 500) logger.error({ err: (err as Error).message }, "[he] results import failed");
    res.status(status).json({ success: false, message: status === 500 ? "Could not import the results" : (err as Error).message });
  }
});

/** Recruited through Meta campaigns, counted from the requisition side (selected / onboarding / joined), per campaign and in total. */
heRouter.get("/meta-recruitment", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await getMetaRecruitment() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] meta recruitment failed"); res.status(500).json({ success: false, message: "Could not load the recruitment numbers" }); }
});

// Recruitment master: rollup summary, and chunked history refresh (one 2-digit mobile prefix per call; omit prefix to list them).
heRouter.get("/master/summary", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try {
    res.json(await getMasterSummary());
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] master summary failed");
    res.status(500).json({ message: "Could not load the master summary" });
  }
});

heRouter.post("/master/refresh", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const prefix = String((req.body as { prefix?: unknown })?.prefix ?? "");
    if (!prefix) return res.json({ prefixes: await listPrefixes() });
    if (!/^\d{2}$/.test(prefix)) return res.status(400).json({ message: "prefix must be 2 digits" });
    const history = await refreshHistoryChunk({ prefix });
    const profiles = await refreshProfilesChunk(prefix);
    res.json({ ...history, profiles: profiles.profiles });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] master refresh failed");
    res.status(500).json({ message: "Could not refresh history" });
  }
});

heRouter.get("/leads/:id/360", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const data = await getCandidate360(String(req.params.id));
    if (!data) return res.status(404).json({ message: "Lead not found" });
    res.json({ success: true, data });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] candidate 360 failed");
    res.status(500).json({ message: "Could not load the candidate record" });
  }
});

heRouter.get("/identity/clashes", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await listOpenClashes() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] clashes failed"); res.status(500).json({ message: "Could not load identity clashes" }); }
});

heRouter.post("/identity/clashes/:id/resolve", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const status = String((req.body as { status?: unknown })?.status ?? "");
    if (!["same_person", "different", "ignored"].includes(status)) return res.status(400).json({ message: "status must be same_person, different or ignored" });
    await resolveClash(Number(req.params.id), status as "same_person" | "different" | "ignored", (req as AuthenticatedRequest).authUser?.id ?? null);
    res.json({ success: true });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] resolve clash failed"); res.status(500).json({ message: "Could not resolve the clash" }); }
});

heRouter.post("/master/ex-employees/refresh", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await refreshExEmployees() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] ex-employee refresh failed"); res.status(500).json({ message: "Could not refresh former employees" }); }
});

// Hiring planner: what to do per source per day (and how many recruiters) to reach a selection target by a date.
heRouter.get("/planner", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const deadline = q.deadline && /^\d{4}-\d{2}-\d{2}$/.test(q.deadline) ? q.deadline : null;
    const num = (v?: string) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
    res.json({ success: true, data: await planHiring({ requisitionId: q.requisitionId ?? null, branch: q.branch ?? null, process: q.process ?? null, targetSelected: num(q.target), deadline, months: num(q.months), bufferPct: num(q.buffer) }) });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] planner failed");
    res.status(500).json({ message: "Could not build the plan" });
  }
});

// Candidate upload from any pool (portal export, vendor list, walk-in sheet...). Rows are parsed in the browser.
heRouter.post("/candidates/import", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body as { rows?: unknown; source?: unknown; dryRun?: unknown };
    const source = String(b.source ?? "other") as IntakeSource;
    if (!INTAKE_SOURCES.includes(source)) return res.status(400).json({ message: `source must be one of ${INTAKE_SOURCES.join(", ")}` });
    if (!Array.isArray(b.rows)) return res.status(400).json({ message: "rows must be an array" });
    res.json({ success: true, data: await ingestCandidates(b.rows as Array<Record<string, unknown>>, source, { dryRun: b.dryRun === true }) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode === 400) return res.status(400).json({ message: e.message });
    logger.error({ err: e.message }, "[he] candidate import failed");
    res.status(500).json({ message: "Could not import candidates" });
  }
});

// Control room: upcoming drives with expected shows (learned show-up model) and the next action for each.
heRouter.get("/control-room", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await getControlRoom() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] control room failed"); res.status(500).json({ message: "Could not load the control room" }); }
});

heRouter.post("/model/learn", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: { showUp: await learnShowUp(), matching: await learnMatchWeights() } }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] learning failed"); res.status(500).json({ message: "Could not learn from outcomes" }); }
});
