/**
 * Public, secret-gated capture endpoints (called by Pinbot, the email provider and the voice bot, none of
 * which can present a session). Every route REFUSES when HE_WEBHOOK_TOKEN is unset instead of falling open.
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

export const heWebhookRouter = Router();

function authorised(req: Request, res: Response): boolean {
  const secret = process.env.HE_WEBHOOK_TOKEN ?? "";
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
heWebhookRouter.get("/whatsapp", (req, res) => {
  const secret = process.env.HE_WEBHOOK_TOKEN ?? "";
  if (secret && req.query["hub.verify_token"] === secret) return res.status(200).send(String(req.query["hub.challenge"] ?? ""));
  return res.status(403).send("forbidden");
});

heWebhookRouter.post("/whatsapp", async (req, res) => {
  if (!authorised(req, res)) return;
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
  if (!authorised(req, res)) return;
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
  if (!authorised(req, res)) return;
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
  if (!authorised(req, res)) return;
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
