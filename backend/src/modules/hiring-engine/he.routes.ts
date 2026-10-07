// Hiring Engine API (authenticated) — mounted at /api/he. Org-wide recruitment roles only for now;
// branch-scoped boards arrive with drives.
import { Router, type Request as ExpressRequest } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent, backfillLeadPool } from "./he-lead.service.js";
import { createDrive, setDriveStatus, suggestMatchesDetailed } from "./he-drive.service.js";
import { inviteForDrive, runEngineTick, runFollowUps } from "./he-engine.service.js";
import { getDriveReadiness } from "./he-readiness.service.js";
import { getRequisitionJd, saveRequisitionJd } from "./he-jd.service.js";
import { getDriveShortlist, SHORTLIST_FILTERS, type ShortlistFilter } from "./he-shortlist.service.js";
import { getBoard, runHrArrivalAlerts } from "./he-alert.service.js";
import { placeVoiceCall } from "./he-voice.service.js";
import { generateWebhookToken, last4, saveSuperbot, superbotConfig, webhookToken } from "./he-secrets.service.js";
import { testSuperbotConnection } from "./he-superbot.service.js";
import { buildSuperbotSheet } from "./he-superbot-sheet.service.js";
import { cancelBulkBatch, createBulkCallBatch, getBulkBatchJobs, listBulkBatches, previewBulkCalls, runBulkCallJobs, startBulkBatch } from "./he-bulk-call.service.js";
import { BULK_CALL_MAX_ROWS, sampleCsv } from "./he-bulk-call.js";
import { listPrepareCampaigns, prepareMissedWalkins, prepareRowsFromCampaigns } from "./he-bulk-call-prepare.service.js";
import { applyCallResults, markExportedForCalling, previewCallResults } from "./he-call-results.service.js";
import { getCandidate360 } from "./he-candidate360.service.js";
import { refreshProfilesChunk } from "./he-profile.service.js";
import { planHiring } from "./he-planner.service.js";
import { ingestCandidates, previewCandidates } from "./he-intake.service.js";
import { getControlRoom, learnMatchWeights, learnShowUp } from "./he-showup.service.js";
import { INTAKE_SOURCES, type IntakeSource } from "./he-intake.js";
import { listOpenClashes, resolveClash } from "./he-identity.service.js";
import { refreshExEmployees } from "./he-ex-employee.service.js";
import { getMasterSummary, getRecruiterProductivity, listPrefixes, refreshHistoryChunk } from "./he-master.service.js";
import { getMetaRecruitment } from "./he-meta-recruitment.service.js";
import { getMetaFunnel } from "./he-meta-funnel.service.js";
import { listCampaignConfigs, setCampaignConfig } from "./he-campaign-config.service.js";
import { listBatches, listLaunches, previewLaunch, startLaunch, type LaunchInput } from "./he-launch.service.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { sendStageSamples } from "./he-samples.service.js";
import { emailConfigured } from "./he-email.service.js";
import { previewWhatsAppSamples, startWhatsAppSample, whatsAppSampleStatus } from "./he-whatsapp-sample.service.js";
import { engineAutoOn, engineMode, getCoolingOffDays, getDailyPlan, getPlanMetaOnly, getPlanRequisitions, lastEngineTick, setCoolingOffDays, setDailyPlan, setEngineAuto, setPlanMetaOnly, setPlanRequisitions, setWhatsappRequiresOptIn, whatsappRequiresOptIn } from "./he-policy.service.js";
import { nextWorkingDay, planNextDay } from "./he-plan.service.js";
import { dailyPlanNumbers } from "./he-slots.js";
import { getInboxThread, listInbox, replyToCandidate } from "./he-inbox.service.js";
import { resolveBranchScope } from "../meta-campaign/meta-access.js";

export const heRouter = Router();
// Master tab rollups: cached a minute (they only change on refresh/import, which clear it).
let masterCache: { at: number; data: unknown } | null = null;
// Warm the Meta recruitment numbers shortly after start so the first visitor does not wait for the full computation.
setTimeout(() => { void getMetaRecruitment().catch(() => undefined); }, 20_000).unref?.();
const VIEW_ROLES = ["super_admin", "admin", "hr", "hr_admin", "recruitment_hr", "ceo"];
const ADMIN_ROLES = ["super_admin", "admin"];

heRouter.get("/summary", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try {
    const t0 = Date.now();
    // Independent counts: run them side by side instead of one after another.
    const [[byStatus], [byAction], [bySource], [handoff]] = await Promise.all([
      db.execute<RowDataPacket[]>("SELECT status, COUNT(*) AS n FROM he_lead GROUP BY status"),
      db.execute<RowDataPacket[]>("SELECT next_action, COUNT(*) AS n FROM he_lead_insight GROUP BY next_action"),
      db.execute<RowDataPacket[]>("SELECT primary_source, COUNT(*) AS n FROM he_lead GROUP BY primary_source"),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT lead_id) AS n FROM he_lead_event e WHERE event_type = 'needs_human_followup'
            AND NOT EXISTS (SELECT 1 FROM he_lead_event d WHERE d.lead_id = e.lead_id AND d.event_type = 'human_followup_done' AND d.id > e.id)`),
    ]);
    res.setHeader("Server-Timing", `db;dur=${Date.now() - t0}`);
    res.json({ success: true, data: { byStatus, byAction, bySource, humanFollowupOpen: Number(handoff[0]?.n ?? 0) } });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] summary failed");
    res.status(500).json({ success: false, message: "Could not load summary" });
  }
});

const leadCountCache = new Map<string, { n: number; at: number }>();

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
    const t0 = Date.now();
    // Page first (index on updated_at), insight fetched only for those 25 rows, count cached for a minute per filter:
    // the total moves slowly and counting 38k+ rows on every page turn is what made the list slow.
    const needsInsight = typeof req.query.action === "string" && Boolean(req.query.action);
    // Two steps so the sort never touches the wide lead rows: ids come straight off idx_he_lead_updated (index-only,
    // LIMIT applied there), then only those 25 rows are read. On production the one-step join took 4 s per page.
    const [idRows] = needsInsight
      ? await db.execute<RowDataPacket[]>(`SELECT l.id FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id ${w} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size])
      : await db.execute<RowDataPacket[]>(`SELECT l.id FROM he_lead l ${w} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`, [...args, size, (page - 1) * size]);
    const ids = idRows.map((r) => String(r.id));
    let rows: RowDataPacket[] = [];
    if (ids.length) {
      const [detail] = await db.execute<RowDataPacket[]>(
        `SELECT l.id, l.mobile10, l.full_name, l.status, l.primary_source, l.last_contact_at, l.created_at, l.updated_at,
                i.engagement_score, i.reliability_score, i.best_channel, i.best_hour_ist, i.next_action, i.next_action_reason
           FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id WHERE l.id IN (${ids.map(() => "?").join(",")})`, ids);
      const pos = new Map(ids.map((id, n) => [id, n]));
      rows = detail.sort((a, b) => (pos.get(String(a.id)) ?? 0) - (pos.get(String(b.id)) ?? 0));
    }
    const t1 = Date.now();
    const key = JSON.stringify([w, args]);
    const hit = leadCountCache.get(key);
    let total: number;
    if (hit && Date.now() - hit.at < 60_000) total = hit.n;
    else {
      const [cnt] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM he_lead l ${needsInsight ? "LEFT JOIN he_lead_insight i ON i.lead_id = l.id" : ""} ${w}`, args);
      total = Number(cnt[0].n);
      if (leadCountCache.size > 200) leadCountCache.clear();
      leadCountCache.set(key, { n: total, at: Date.now() });
    }
    res.setHeader("Server-Timing", `rows;dur=${t1 - t0}, count;dur=${Date.now() - t1}`);
    res.json({ success: true, data: rows, total, page, size });
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
      targetShows: Number(b.targetShows) > 0 ? Math.min(2000, Math.floor(Number(b.targetShows))) : undefined,
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
  const b = (req.body ?? {}) as { approvalState?: string; pinbotName?: string; language?: string };
  if (b.approvalState && !["draft", "submitted", "approved", "rejected"].includes(b.approvalState)) return res.status(400).json({ success: false, message: "invalid approvalState" });
  if (b.pinbotName && !/^[a-z0-9_]{1,120}$/.test(b.pinbotName)) return res.status(400).json({ success: false, message: "pinbotName must be lowercase letters, digits, underscores" });
  // Meta language code of the approved template ("en", "en_US", "hi"): must match exactly or Meta rejects the send.
  if (b.language && !/^[a-z]{2}(_[A-Z]{2})?$/.test(b.language)) return res.status(400).json({ success: false, message: "language must look like en, en_US or hi" });
  try {
    const [r] = await db.execute<ResultSetHeader>(
      "UPDATE he_template SET approval_state = COALESCE(?, approval_state), pinbot_name = COALESCE(?, pinbot_name), language = COALESCE(?, language) WHERE template_key = ?",
      [b.approvalState ?? null, b.pinbotName ?? null, b.language ?? null, String(req.params.key)]);
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
    if (!masterCache || Date.now() - masterCache.at > 60_000) masterCache = { at: Date.now(), data: await getMasterSummary() };
    res.json(masterCache.data);
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
    masterCache = null;
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

heRouter.post("/master/ex-employees/refresh", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  masterCache = null;
  try { const after = (req.body as { after?: unknown })?.after; res.json({ success: true, data: await refreshExEmployees({ after: typeof after === "string" ? after : null }) }); }
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

// Upload preview: which column is which (auto-detected or remembered), how many rows are valid / new / already known.
heRouter.post("/candidates/preview", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const rows = (req.body as { rows?: unknown })?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ message: "rows must be a non-empty array" });
    if (rows.length > 5000) return res.status(400).json({ message: "Too many rows in one upload (max 5000)" });
    res.json({ success: true, data: await previewCandidates(rows as Array<Record<string, unknown>>) });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] candidate preview failed");
    res.status(500).json({ message: "Could not read the file" });
  }
});

// Candidate upload from any pool (portal export, vendor list, walk-in sheet...). Rows are parsed in the browser.
heRouter.post("/candidates/import", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body as { rows?: unknown; source?: unknown; dryRun?: unknown };
    const source = String(b.source ?? "other") as IntakeSource;
    if (!INTAKE_SOURCES.includes(source)) return res.status(400).json({ message: `source must be one of ${INTAKE_SOURCES.join(", ")}` });
    if (!Array.isArray(b.rows)) return res.status(400).json({ message: "rows must be an array" });
    const bb = req.body as { mapping?: unknown; saveMapping?: unknown; label?: unknown; fileName?: unknown; consentAttested?: unknown };
    masterCache = null;
    res.json({ success: true, data: await ingestCandidates(b.rows as Array<Record<string, unknown>>, source, {
      dryRun: b.dryRun === true, mapping: bb.mapping, saveMapping: bb.saveMapping !== false, userId: (req as AuthenticatedRequest).authUser?.id ?? null,
      label: typeof bb.label === "string" ? bb.label : null, fileName: typeof bb.fileName === "string" ? bb.fileName : null, consentAttested: bb.consentAttested === true,
    }) });
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

heRouter.get("/master/recruiters", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try { res.json({ success: true, data: await getRecruiterProductivity(Number((req.query as { days?: string }).days ?? 7) || 7) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] recruiter productivity failed"); res.status(500).json({ message: "Could not load recruiter productivity" }); }
});

// Drive launch panel: readiness, preview (dry run), send invites now (email first), and follow-ups on demand.
heRouter.get("/drives/:id/readiness", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const r = await getDriveReadiness(String(req.params.id));
    if (!r) return res.status(404).json({ message: "Drive not found" });
    res.json({ success: true, data: r });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] readiness failed"); res.status(500).json({ message: "Could not check readiness" }); }
});

heRouter.post("/drives/:id/launch", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = (req.body ?? {}) as { dryRun?: unknown; limit?: unknown };
    const dryRun = b.dryRun !== false;
    const limit = Math.max(1, Math.min(500, Math.floor(Number(b.limit) || 100)));
    const id = String(req.params.id);
    const [d] = await db.execute<RowDataPacket[]>("SELECT status FROM he_drive WHERE id = ? LIMIT 1", [id]);
    if (!d[0]) return res.status(404).json({ message: "Drive not found" });
    if (!dryRun && d[0].status !== "active") return res.status(400).json({ message: "Activate the drive before sending invites" });
    const r = await inviteForDrive(id, { dryRun, max: limit });
    if (!dryRun) logger.info({ driveId: id, by: (req as AuthenticatedRequest).authUser?.id, sent: r.sent, blocked: r.blocked }, "[he] invites sent from the launch panel");
    res.json({ success: true, data: r });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] launch failed"); res.status(500).json({ message: "Could not send invites" }); }
});

heRouter.post("/engine/follow-ups", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const dryRun = (req.body ?? {}).dryRun !== false;
    // T11 branch-HR arrival alert rides along, so the button covers every scheduled step.
    res.json({ success: true, data: { ...(await runFollowUps({ dryRun })), alerts: await runHrArrivalAlerts({ dryRun }) } }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] follow-ups failed"); res.status(500).json({ message: "Could not run follow-ups" }); }
});

// Shortlist for a drive: fit + reasons, outreach status per channel, and other requisitions each candidate also fits.
heRouter.get("/drives/:id/shortlist", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const filter = (SHORTLIST_FILTERS as readonly string[]).includes(q.filter ?? "") ? (q.filter as ShortlistFilter) : "all";
    const r = await getDriveShortlist(String(req.params.id), { filter, page: Number(q.page) || 1, size: Number(q.size) || 50, q: q.q });
    if (!r) return res.status(404).json({ message: "Drive not found" });
    res.json({ success: true, data: r });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] shortlist failed"); res.status(500).json({ message: "Could not load the shortlist" }); }
});

// JD as understood by the engine (BMS format): read, or upload a .docx / .pdf / .txt (base64) or pasted text.
/** Test emails for every outreach stage, to the signed-in user's own address only (the address comes from the login, not the body). */
heRouter.post("/templates/send-samples", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const to = String((req as AuthenticatedRequest).authUser?.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to)) return res.status(400).json({ success: false, message: "Your login has no email address on file, so a sample cannot be sent to you." });
  if (!emailConfigured()) return res.status(409).json({ success: false, message: "Email is not set up on the server." });
  try {
    const results = await sendStageSamples(to);
    res.json({ success: true, to: to.replace(/^(.).*(@.*)$/, "$1***$2"), sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he] send samples failed");
    res.status(500).json({ success: false, message: "Could not send the samples" });
  }
});

/** WhatsApp sample journey to the signed-in user's own mobile, one message at a time. confirm:false only previews where it would go. */
heRouter.post("/templates/whatsapp-sample", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  const userId = String((req as AuthenticatedRequest).authUser?.id ?? "");
  const b = (req.body ?? {}) as { confirm?: unknown; scenario?: unknown; gapMinutes?: unknown };
  try {
    if (b.confirm !== true) return res.json({ success: true, ...(await previewWhatsAppSamples(userId)) });
    res.json({ success: true, job: await startWhatsAppSample(userId, String(b.scenario ?? "happy"), Number(b.gapMinutes ?? 2)) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
    logger.error({ err: e.message }, "[he] whatsapp samples failed");
    res.status(500).json({ success: false, message: "Could not start the WhatsApp sample" });
  }
});
heRouter.get("/templates/whatsapp-sample/status", requireAuth, requireRole(...WRITE_ROLES), (req, res) => {
  res.json({ success: true, job: whatsAppSampleStatus(String((req as AuthenticatedRequest).authUser?.id ?? "")) });
});

async function policySnapshot() {
  const auto = await engineAutoOn();
  return { coolingOffDays: await getCoolingOffDays(), whatsappRequiresOptIn: await whatsappRequiresOptIn(), engineAuto: auto, engineMode: engineMode(process.env, auto), engineLastTick: await lastEngineTick() };
}
/** Owner-adjustable outreach policy (no deploy needed). */
heRouter.get("/policy", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, ...(await policySnapshot()) }); } catch { res.status(500).json({ success: false }); }
});
heRouter.put("/policy", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const b = (req.body ?? {}) as { coolingOffDays?: unknown; whatsappRequiresOptIn?: unknown; engineAuto?: unknown };
    if (b.coolingOffDays !== undefined) await setCoolingOffDays(Number(b.coolingOffDays));
    if (b.whatsappRequiresOptIn !== undefined) await setWhatsappRequiresOptIn(b.whatsappRequiresOptIn === true);
    if (b.engineAuto !== undefined) await setEngineAuto(b.engineAuto === true);
    logger.info({ body: { coolingOffDays: b.coolingOffDays, whatsappRequiresOptIn: b.whatsappRequiresOptIn, engineAuto: b.engineAuto }, by: (req as AuthenticatedRequest).authUser?.id }, "[he] outreach policy changed");
    res.json({ success: true, ...(await policySnapshot()) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    res.status(e.statusCode ?? 500).json({ success: false, message: e.statusCode ? e.message : "Could not save" });
  }
});

/** The daily outreach plan: numbers, derived sizes, and which requisitions run on it. */
heRouter.get("/plan", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try {
    const plan = await getDailyPlan();
    res.json({ success: true, plan, numbers: dailyPlanNumbers(plan), requisitionIds: await getPlanRequisitions(), metaOnly: await getPlanMetaOnly(), nextDay: nextWorkingDay() });
  } catch { res.status(500).json({ success: false }); }
});
heRouter.put("/plan", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const b = (req.body ?? {}) as { plan?: Record<string, unknown>; requisitionIds?: unknown; metaOnly?: unknown };
    if (b.plan) await setDailyPlan({
      walkInsPerDay: b.plan.walkInsPerDay === undefined ? undefined : Number(b.plan.walkInsPerDay), minOutreachPerDay: b.plan.minOutreachPerDay === undefined ? undefined : Number(b.plan.minOutreachPerDay),
      showRatePct: b.plan.showRatePct === undefined ? undefined : Number(b.plan.showRatePct), slotStart: b.plan.slotStart === undefined ? undefined : String(b.plan.slotStart),
      slotEnd: b.plan.slotEnd === undefined ? undefined : String(b.plan.slotEnd), slotMinutes: b.plan.slotMinutes === undefined ? undefined : Number(b.plan.slotMinutes),
    } as never);
    if (Array.isArray(b.requisitionIds)) await setPlanRequisitions(b.requisitionIds as string[]);
    if (b.metaOnly !== undefined) await setPlanMetaOnly(b.metaOnly === true);
    logger.info({ by: (req as AuthenticatedRequest).authUser?.id }, "[he] daily plan changed");
    const plan = await getDailyPlan();
    res.json({ success: true, plan, numbers: dailyPlanNumbers(plan), requisitionIds: await getPlanRequisitions(), metaOnly: await getPlanMetaOnly(), nextDay: nextWorkingDay() });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    res.status(e.statusCode ?? 500).json({ success: false, message: e.statusCode ? e.message : "Could not save the plan" });
  }
});
/** Create (or confirm) the next working day's drives for the plan's requisitions now. dryRun previews only. */
heRouter.post("/plan/run", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try { res.json({ success: true, ...(await planNextDay({ date: typeof (req.body ?? {}).date === "string" ? (req.body as { date: string }).date : undefined, dryRun: (req.body ?? {}).dryRun === true })) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] plan run failed"); res.status(500).json({ success: false, message: "Could not plan the day" }); }
});

/** WhatsApp Inbox, Hiring Engine source: conversations with candidates the engine has messaged (branch-scoped like the Meta inbox). */
const inboxScope = async (req: AuthenticatedRequest) => resolveBranchScope(req.authUser.id, ((req as unknown as { userRoles?: string[] }).userRoles?.length ? (req as unknown as { userRoles: string[] }).userRoles : [req.authUser.role ?? ""]).filter(Boolean));
heRouter.get("/inbox", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try { res.json({ success: true, ...(await listInbox(await inboxScope(req as AuthenticatedRequest), typeof req.query.search === "string" ? req.query.search : undefined)) }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] inbox failed"); res.status(500).json({ success: false, message: "Could not load the inbox" }); }
});
heRouter.get("/inbox/:leadId/messages", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const t = await getInboxThread(String(req.params.leadId), await inboxScope(req as AuthenticatedRequest), (req as AuthenticatedRequest).authUser?.id ?? null);
    if (!t) return res.status(404).json({ success: false, message: "Conversation not found or outside your branch" });
    res.json({ success: true, ...t });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] inbox thread failed"); res.status(500).json({ success: false, message: "Could not load the conversation" }); }
});
heRouter.post("/inbox/:leadId/reply", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const r = await replyToCandidate(String(req.params.leadId), String((req.body ?? {}).message ?? ""), await inboxScope(req as AuthenticatedRequest), (req as AuthenticatedRequest).authUser?.id ?? null);
    res.status(r.ok ? 200 : r.status).json(r.ok ? { success: true, messageId: r.messageId } : { success: false, message: r.message });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] inbox reply failed"); res.status(500).json({ success: false, message: "Could not send the reply" }); }
});

heRouter.get("/requisitions/:id/jd", requireAuth, requireRole(...VIEW_ROLES), async (req, res) => {
  try {
    const jd = await getRequisitionJd(String(req.params.id));
    if (!jd) return res.status(404).json({ message: "Requisition not found" });
    res.json({ success: true, data: jd });
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] jd read failed"); res.status(500).json({ message: "Could not read the JD" }); }
});

heRouter.post("/requisitions/:id/jd", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const b = (req.body ?? {}) as { fileName?: unknown; base64?: unknown; text?: unknown };
    const [r] = await db.execute<RowDataPacket[]>("SELECT id FROM job_requisition WHERE id = ? LIMIT 1", [String(req.params.id)]);
    if (!r[0]) return res.status(404).json({ message: "Requisition not found" });
    const jd = await saveRequisitionJd(String(req.params.id), {
      fileName: typeof b.fileName === "string" ? b.fileName : null, base64: typeof b.base64 === "string" ? b.base64 : null, text: typeof b.text === "string" ? b.text : null,
    }, (req as AuthenticatedRequest).authUser?.id ?? null);
    res.json({ success: true, data: jd });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode === 400) return res.status(400).json({ message: e.message });
    logger.error({ err: e.message }, "[he] jd save failed"); res.status(500).json({ message: "Could not save the JD" });
  }
});

/** Provider hookups (admin only). The token is shown here so the admin can paste the URLs into Pinbot and Superbot; the Superbot key only as its last four characters. */
async function integrationsSnapshot(req: ExpressRequest) {
  const t = await webhookToken();
  const sb = await superbotConfig();
  const base = (process.env.BACKEND_PUBLIC_URL?.trim() || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const url = (path: string) => (t.token ? `${base}/api/he-hook/${path}?token=${t.token}` : null);
  return {
    webhook: { configured: Boolean(t.token), source: t.source, urls: { pinbot: url("whatsapp"), superbotFeedback: url("superbot"), superbotRejected: url("superbot-rejected") } },
    superbot: { configured: Boolean(sb), apiKey: last4(sb?.apiKey), superbotId: sb?.superbotId ?? null, campaignId: sb?.campaignId ?? null, baseUrl: sb?.baseUrl ?? "https://api.superbot.one/tel/v2", lang: sb?.lang ?? "en-IN", whitelistIps: ["163.61.132.15", "163.61.133.15"] },
  };
}
heRouter.get("/integrations", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try { res.json({ success: true, ...(await integrationsSnapshot(req)) }); } catch { res.status(500).json({ success: false }); }
});
heRouter.post("/integrations/webhook-token", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    if (process.env.HE_WEBHOOK_TOKEN?.trim()) return res.status(409).json({ success: false, message: "The server sets this token itself (HE_WEBHOOK_TOKEN); change it there." });
    await generateWebhookToken((req as AuthenticatedRequest).authUser?.id ?? null);
    logger.info({ by: (req as AuthenticatedRequest).authUser?.id }, "[he] webhook token generated");
    res.json({ success: true, ...(await integrationsSnapshot(req)) });
  } catch { res.status(500).json({ success: false, message: "Could not generate" }); }
});
heRouter.put("/integrations/superbot", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    await saveSuperbot((req.body ?? {}) as Record<string, string>, (req as AuthenticatedRequest).authUser?.id ?? null);
    logger.info({ by: (req as AuthenticatedRequest).authUser?.id }, "[he] superbot settings saved");
    res.json({ success: true, ...(await integrationsSnapshot(req)) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    res.status(e.statusCode ?? 500).json({ success: false, message: e.statusCode ? e.message : "Could not save" });
  }
});
heRouter.post("/integrations/superbot/test", requireAuth, requireRole(...ADMIN_ROLES), async (_req, res) => {
  try { res.json({ success: true, ...(await testSuperbotConnection()) }); } catch { res.status(500).json({ success: false }); }
});

/** Call sheet (CSV) for uploading to the Superbot portal: pending = invited, not yet confirmed; all = also confirmed. */
heRouter.get("/drives/:id/superbot-sheet", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const r = await buildSuperbotSheet(String(req.params.id), req.query.which === "all" ? "all" : "pending");
    if (!r) return res.status(404).json({ message: "Drive not found" });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="superbot-calls-${String(req.params.id).slice(0, 8)}.csv"`);
    res.setHeader("X-Rows", String(r.rows));
    res.setHeader("X-Skipped-No-Address", String(r.skippedNoAddress));
    logger.info({ drive: req.params.id, rows: r.rows, by: (req as AuthenticatedRequest).authUser?.id }, "[he] superbot call sheet downloaded");
    res.send(r.csv);
  } catch (err) { logger.error({ err: (err as Error).message }, "[he] superbot sheet failed"); res.status(500).json({ message: "Could not build the call sheet" }); }
});

/** The Meta campaign walk-in funnel (per campaign and total): form fill to outreach to walk-in to hire. */
heRouter.get("/meta-funnel", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await getMetaFunnel() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] meta funnel failed"); res.status(500).json({ success: false, message: "Could not load the Meta funnel" }); }
});

// Per Meta campaign: who owns the outreach (old Meta flow / Hiring Engine), channel switches, Superbot campaign.
heRouter.get("/campaign-config", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await listCampaignConfigs() }); }
  catch (err) { logger.error({ err: (err as Error).message }, "[he] campaign config list failed"); res.status(500).json({ success: false, message: "Could not load the campaign settings" }); }
});
heRouter.put("/campaign-config/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const bool = (v: unknown) => (v === undefined ? undefined : v === true);
    const data = await setCampaignConfig(String(req.params.id), {
      owner: b.owner === "he" ? "he" : b.owner === "meta" ? "meta" : undefined, emailOn: bool(b.emailOn), whatsappOn: bool(b.whatsappOn), voiceOn: bool(b.voiceOn),
      superbotCampaign: b.superbotCampaign === undefined ? undefined : b.superbotCampaign === null ? null : String(b.superbotCampaign),
    }, (req as AuthenticatedRequest).authUser?.id ?? null);
    logger.info({ campaign: req.params.id, by: (req as AuthenticatedRequest).authUser?.id }, "[he] campaign settings changed");
    res.json({ success: true, data });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    res.status(e.statusCode ?? 500).json({ success: false, message: e.statusCode ? e.message : "Could not save the campaign settings" });
  }
});

// Campaign / upload-batch launches: pick the audience, an OPEN requisition and a date; the engine takes it from there.
const launchInput = (req: ExpressRequest): LaunchInput => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    kind: b.kind === "batch" ? "batch" : "campaign", ids: Array.isArray(b.ids) ? (b.ids as unknown[]).map(String) : [], requisitionId: String(b.requisitionId ?? ""), date: String(b.date ?? ""),
    maxLeadAgeDays: num(b.maxLeadAgeDays), label: typeof b.label === "string" ? b.label : null, reinvite: b.reinvite !== false, walkInsWanted: num(b.walkInsWanted),
    autoSend: b.autoSend !== false, userId: (req as AuthenticatedRequest).authUser?.id ?? null,
  };
};
const launchError = (res: import("express").Response, err: unknown, what: string) => {
  const e = err as Error & { statusCode?: number };
  if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
  logger.error({ err: e.message }, `[he] ${what} failed`);
  return res.status(500).json({ success: false, message: `Could not ${what}` });
};
heRouter.post("/launch/preview", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try { res.json({ success: true, data: await previewLaunch(launchInput(req)) }); } catch (err) { launchError(res, err, "preview the launch"); }
});
heRouter.post("/launch", requireAuth, requireRole(...WRITE_ROLES), async (req, res) => {
  try {
    const r = await startLaunch(launchInput(req));
    logger.info({ drive: r.driveId, by: (req as AuthenticatedRequest).authUser?.id, lined: r.shortlist.suggested }, "[he] campaign launched");
    res.json({ success: true, data: r });
  } catch (err) { launchError(res, err, "start the launch"); }
});
heRouter.get("/launches", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await listLaunches() }); } catch (err) { launchError(res, err, "load the launches"); }
});
heRouter.get("/import-batches", requireAuth, requireRole(...VIEW_ROLES), async (_req, res) => {
  try { res.json({ success: true, data: await listBatches() }); } catch (err) { launchError(res, err, "load the upload batches"); }
});
