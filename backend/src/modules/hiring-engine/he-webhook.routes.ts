/**
 * Public, secret-gated capture endpoints (called by Pinbot, the email provider and the voice bot, none of
 * which can present a session). Every route REFUSES when no webhook token exists (env HE_WEBHOOK_TOKEN or the one generated on the Hiring Engine Master tab) instead of falling open.
 * Mounted at /api/he-hook, above the authenticated /api routers.
 */
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { parseWhatsAppWebhook } from "./he-webhook-parse.js";
import { recordDeliveryStatus, recordEmailEvent, recordInboundReply, recordVoiceResult, type VoiceCallbackInput } from "./he-ingest.service.js";
import type { EmailEvent } from "./he-signals.js";
import { mapVapiEndOfCall, type VapiEndOfCall } from "./he-voice.js";
import { loadToolResult, toolNextSlot, toolReportResult } from "./he-voice.service.js";
import { completeBulkJob } from "./he-bulk-call.service.js";
import { ingestCandidates } from "./he-intake.service.js";
import { webhookToken } from "./he-secrets.service.js";
import { mapSuperbotFeedback, type SuperbotFeedback } from "./he-superbot.js";
import { addEvent } from "./he-lead.service.js";

export const heWebhookRouter = Router();

async function authorised(req: Request, res: Response): Promise<boolean> {
  const secret = (await webhookToken()).token ?? "";
  if (!secret) { res.status(503).json({ success: false, message: "webhook not configured" }); return false; }
  const supplied = String(req.header("x-he-token") ?? req.query.token ?? "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ success: false, message: "invalid token" });
    return false;
  }
  return true;
}

// Meta-style GET handshake (hub.challenge) so the same URL can be registered with Pinbot/Meta.
heWebhookRouter.get("/whatsapp", async (req, res) => {
  const secret = (await webhookToken()).token ?? "";
  if (secret && req.query["hub.verify_token"] === secret) return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  return res.status(403).send("forbidden");
});

heWebhookRouter.post("/whatsapp", async (req, res) => {
  if (!(await authorised(req, res))) return;
  const { inbound, statuses } = parseWhatsAppWebhook(req.body);
  // Process BEFORE acknowledging: if the process dies after a 200 the provider never retries and the candidate's reply
  // is lost. Every handler is idempotent (UNIQUE provider_message_id), so on any failure we answer 500 and the provider
  // safely redelivers the whole batch.
  try {
    for (const s of statuses) await recordDeliveryStatus(s.id, s.status, s.error);
    for (const m of inbound) await recordInboundReply({ mobile: m.from, text: m.text, providerMessageId: m.id });
    return res.status(200).json({ success: true, inbound: inbound.length, statuses: statuses.length });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-hook] whatsapp batch failed - asking the provider to retry");
    return res.status(500).json({ success: false });
  }
});

const EMAIL_EVENTS = new Set<EmailEvent>(["sent", "delivered", "opened", "clicked", "bounced", "replied", "unsubscribed"]);
heWebhookRouter.post("/email", async (req, res) => {
  if (!(await authorised(req, res))) return;
  const b = req.body as { messageId?: string; event?: string; detail?: string };
  if (!b?.messageId || !EMAIL_EVENTS.has(b.event as EmailEvent)) return res.status(400).json({ success: false, message: "messageId and a valid event are required" });
  try {
    const ok = await recordEmailEvent({ providerMessageId: b.messageId, event: b.event as EmailEvent, detail: b.detail });
    return res.status(ok ? 200 : 404).json({ success: ok });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-hook] email failed");
    return res.status(500).json({ success: false });
  }
});

/** Voice bot posts the STRUCTURED result of the call (BRD section 5 fields); never a transcript to parse. */
heWebhookRouter.post("/voice", async (req, res) => {
  if (!(await authorised(req, res))) return;
  const b = req.body as VoiceCallbackInput;
  if (!b?.result || typeof b.result.answered !== "boolean" || (!b.leadId && !b.mobile)) {
    return res.status(400).json({ success: false, message: "result.answered and leadId or mobile are required" });
  }
  try {
    const r = await recordVoiceResult(b);
    return r ? res.status(200).json({ success: true, ...r }) : res.status(404).json({ success: false, message: "lead not found" });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-hook] voice failed");
    return res.status(500).json({ success: false });
  }
});

/**
 * Vapi server messages for calls placed by the engine. Handles the two mid-call tools and the end-of-call report.
 * Always answers 200 for message types we do not use so the platform does not retry them.
 */
heWebhookRouter.post("/voice-vapi", async (req, res) => {
  if (!(await authorised(req, res))) return;
  const msg = (req.body?.message ?? req.body) as { type?: string; call?: VapiEndOfCall["call"]; toolCallList?: Array<{ id: string; function?: { name?: string; arguments?: unknown } }> } & VapiEndOfCall;
  try {
    if (msg.type === "tool-calls") {
      const matchId = msg.call?.metadata?.matchId;
      const leadId = msg.call?.metadata?.leadId;
      const results: Array<{ toolCallId: string; result: unknown }> = [];
      for (const t of msg.toolCallList ?? []) {
        // Manual bulk-upload calls have no drive, so there is no slot calendar to offer from: tell the bot plainly so it hands off.
        if (t.function?.name === "get_next_slot" && !matchId) results.push({ toolCallId: t.id, result: { error: "no alternative slot is available for this call" } });
        else if (t.function?.name === "get_next_slot" && matchId) results.push({ toolCallId: t.id, result: await toolNextSlot(matchId) });
        else if (t.function?.name === "report_result" && leadId && msg.call?.id) {
          const args = typeof t.function.arguments === "string" ? JSON.parse(t.function.arguments) : (t.function.arguments as Record<string, unknown>) ?? {};
          await toolReportResult(leadId, msg.call.id, args);
          results.push({ toolCallId: t.id, result: "recorded" });
        } else results.push({ toolCallId: t.id, result: { error: "unknown tool" } });
      }
      return res.status(200).json({ results });
    }
    if (msg.type === "end-of-call-report") {
      const callId = msg.call?.id;
      const merged = mapVapiEndOfCall(msg, callId ? await loadToolResult(callId) : undefined);
      if (!merged.leadId && !merged.matchId) return res.status(200).json({ success: true, ignored: "no metadata" });
      let leadId = merged.leadId;
      if (!leadId && merged.matchId) {
        const [r] = await db.execute<RowDataPacket[]>("SELECT lead_id FROM he_match WHERE id = ? LIMIT 1", [merged.matchId]);
        leadId = r[0]?.lead_id as string | undefined;
      }
      if (!leadId) return res.status(200).json({ success: true, ignored: "lead not found" });
      const out = await recordVoiceResult({ leadId, providerCallId: merged.providerCallId, attemptNo: merged.attempt, startedAt: merged.startedAt, result: merged.result, transcript: merged.transcript, summary: merged.summary, recordingUrl: merged.recordingUrl });
      // Manual bulk upload: close the row (or put it back for the one allowed retry).
      if (merged.jobId && out && out.outcome !== "duplicate") await completeBulkJob(merged.jobId, out.outcome);
      return res.status(200).json({ success: true, ...out });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err: (err as Error).message, type: msg.type }, "[he-hook] vapi failed");
    return res.status(500).json({ success: false });
  }
});

// Job website / portal feed: POST {source?: "website", candidates: [{mobile, name, email, ...}]} with x-he-token.
heWebhookRouter.post("/candidates", async (req, res) => {
  if (!(await authorised(req, res))) return;
  try {
    const b = req.body as { candidates?: unknown; source?: unknown };
    if (!Array.isArray(b.candidates) || b.candidates.length === 0) return res.status(400).json({ success: false, message: "candidates must be a non-empty array" });
    if (b.candidates.length > 500) return res.status(400).json({ success: false, message: "max 500 candidates per call" });
    const source = b.source === "portal" || b.source === "vendor" || b.source === "referral" ? b.source : "website";
    res.json({ success: true, data: await ingestCandidates(b.candidates as Array<Record<string, unknown>>, source) });
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode === 400) return res.status(400).json({ success: false, message: e.message });
    logger.error({ err: e.message }, "[he-hook] candidate feed failed");
    res.status(500).json({ success: false, message: "could not ingest" });
  }
});

/**
 * Superbot post-call feedback (reference_id = our match id). Always answers 200 for anything we cannot use so Superbot does not retry forever;
 * 500 only when our own database failed, which is safe to redeliver (recordVoiceResult dedupes on reference_id:time).
 */
heWebhookRouter.post("/superbot", async (req, res) => {
  if (!(await authorised(req, res))) return;
  const f = (req.body ?? {}) as SuperbotFeedback;
  if (!f.reference_id && !f.phone) return res.status(200).json({ success: true, ignored: "no reference" });
  try {
    const mapped = mapSuperbotFeedback(f);
    let leadId: string | undefined;
    let matchId: string | undefined;
    if (mapped.referenceId) {
      const [r] = await db.execute<RowDataPacket[]>("SELECT id, lead_id FROM he_match WHERE id = ? LIMIT 1", [mapped.referenceId]);
      if (r[0]) { leadId = String(r[0].lead_id); matchId = String(r[0].id); }
    }
    const mobile = !leadId && mapped.phone ? mapped.phone.replace(/\D/g, "").slice(-10) : undefined;
    if (!leadId && !mobile) return res.status(200).json({ success: true, ignored: "lead not found" });
    const out = await recordVoiceResult({ leadId, mobile, providerCallId: mapped.providerCallId, startedAt: mapped.startedAt, result: mapped.result, summary: mapped.summary, recordingUrl: mapped.recordingUrl });
    if (!out) return res.status(200).json({ success: true, ignored: "lead not found" });
    if (mapped.humanFollowUp && out.outcome !== "duplicate") await addEvent(out.leadId, "human_followup_needed", { channel: "voice", detail: mapped.humanFollowUp, meta: { matchId, disposition: f.disposition ?? null } });
    return res.status(200).json({ success: true, ...out });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-hook] superbot feedback failed");
    return res.status(500).json({ success: false });
  }
});

/** Numbers Superbot rejected from a queued batch: mark the lead so we stop chasing a bad number. Always 200. */
heWebhookRouter.post("/superbot-rejected", async (req, res) => {
  if (!(await authorised(req, res))) return;
  try {
    const b = req.body as { reference_id?: string; phone?: string; reason?: string; numbers?: Array<{ reference_id?: string; phone?: string; reason?: string }> };
    const list = Array.isArray(b?.numbers) ? b.numbers : [b ?? {}];
    for (const n of list) {
      if (!n.reference_id) continue;
      const [r] = await db.execute<RowDataPacket[]>("SELECT lead_id FROM he_match WHERE id = ? LIMIT 1", [n.reference_id]);
      if (r[0]) await addEvent(String(r[0].lead_id), "call_failed_to_place", { channel: "voice", detail: `superbot rejected: ${String(n.reason ?? "unknown").slice(0, 200)}` });
    }
  } catch (err) { logger.warn({ err: (err as Error).message }, "[he-hook] superbot-rejected failed"); }
  return res.status(200).json({ success: true });
});
