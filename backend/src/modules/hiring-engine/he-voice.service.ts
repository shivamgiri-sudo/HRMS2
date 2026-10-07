/**
 * Places the BRD interview-confirmation call through Vapi and serves its two mid-call tools. The slot offered
 * on a reschedule comes from reserveSlot() (drive row locked, seat held at lookup) - the bot never invents one.
 */
import axios from "axios";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent, hasConsent } from "./he-lead.service.js";
import { reserveSlot } from "./he-drive.service.js";
import { istHour } from "./he-guardrails.js";
import { dateLabel, metaFlowNotifiedRecently, sendsPaused, timeLabel } from "./he-send.service.js";
import { configForLead } from "./he-campaign-config.service.js";
import { buildVoiceSystemPrompt, canPlaceCall, VOICE_FIRST_MESSAGE, VOICE_RESULT_SCHEMA, type VoiceCtx } from "./he-voice.js";
import { displayFirstName } from "./he-name.js";
import { whatsappRequiresOptIn } from "./he-policy.service.js";
import { superbotConfig, webhookToken } from "./he-secrets.service.js";
import { queueSuperbotCall } from "./he-superbot.service.js";
import { sbDate, sbTime } from "./he-superbot.js";

const env = (k: string, d = "") => (process.env[k] && process.env[k]!.trim() ? process.env[k]!.trim() : d);

export type CallPlacement =
  | { status: "placed"; callId: string }
  | { status: "dry_run"; promptPreview: string }
  | { status: "blocked"; reason: string }
  | { status: "failed"; error: string };

function toE164(mobile10: string): string { return `+91${mobile10}`; }

export async function placeVoiceCall(matchId: string, o: { dryRun?: boolean } = {}): Promise<CallPlacement> {
  const dryRun = o.dryRun !== false;
  const [mr] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.requisition_id, m.state, m.slot_at, l.full_name, l.mobile10, l.status, l.meta_lead_id, jr.designation_name, jr.branch_name, jr.approval_status, jr.active_status,
            jr.requested_headcount, jr.fulfilled_headcount, bm.address, d.drive_date, d.status AS drive_status
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id JOIN job_requisition jr ON jr.id = m.requisition_id
       LEFT JOIN he_drive d ON d.id = m.drive_id LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE m.id = ? LIMIT 1`, [matchId]);
  const m = mr[0];
  if (!m) return { status: "blocked", reason: "match_not_found" };
  if (!["invited", "confirmed"].includes(String(m.state)) || !m.slot_at) return { status: "blocked", reason: "no_active_slot" };
  if (["opted_out", "arrived", "joined", "dead", "declined"].includes(String(m.status))) return { status: "blocked", reason: `lead_${m.status}` };
  if (m.approval_status !== "approved" || !m.active_status || Number(m.fulfilled_headcount) >= Number(m.requested_headcount)) return { status: "blocked", reason: "requisition_closed" };
  if (sendsPaused() || m.drive_status === "paused") return { status: "blocked", reason: "paused" };
  if (await metaFlowNotifiedRecently(m.meta_lead_id as string | null)) return { status: "blocked", reason: "meta_flow_already_notified" };
  const cfg = await configForLead(m.lead_id as string);
  if (cfg && !cfg.voiceOn) return { status: "blocked", reason: "voice_off_for_campaign" };
  // WhatsApp needs an explicit opt-in; a confirmation call about the walk-in we already emailed them (their own application) does not,
  // which is what lets the email -> call path reach candidates who never opted in to WhatsApp. Opt-out above always wins.
  if (!(await hasConsent(m.lead_id as string, "whatsapp_contact"))) {
    const [emailed] = await db.execute<RowDataPacket[]>(
      "SELECT 1 FROM he_message WHERE lead_id = ? AND requisition_id = ? AND template_key = 'he_walkin_invite_email' AND direction = 'out' AND delivery_status <> 'failed' LIMIT 1", [m.lead_id, m.requisition_id]);
    if (!emailed.length && (await whatsappRequiresOptIn())) return { status: "blocked", reason: "no_consent" };
  }
  if (!m.address) return { status: "blocked", reason: "missing_branch_address" }; // never read out an invented address

  const [att] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM he_lead_event WHERE lead_id = ? AND event_type = 'call_placed' AND created_at >= CURDATE()", [m.lead_id]);
  const [ans] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM he_call WHERE lead_id = ? AND created_at >= CURDATE() AND outcome IS NOT NULL AND outcome NOT LIKE 'CALL_FAILED%' AND outcome <> 'NO_ANSWER' LIMIT 1", [m.lead_id]);
  const gate = canPlaceCall({
    attemptsToday: Number(att[0].n), lastAttemptAt: att[0].last_at ? new Date(String(att[0].last_at).replace(" ", "T") + "+05:30") : null,
    now: new Date(), istHour: istHour(new Date()), hasAnsweredToday: ans.length > 0,
  });
  if (!gate.ok) return { status: "blocked", reason: gate.reason };

  const ctx: VoiceCtx = {
    candidateName: displayFirstName(m.full_name), role: String(m.designation_name),
    driveDate: dateLabel(String(m.drive_date)), slotTime: timeLabel(String(m.slot_at)), branchAddress: String(m.address),
    contactName: env("HE_HR_CONTACT_NAME", "our HR team"), contactPhone: env("HE_HR_CONTACT_PHONE", ""),
    referenceId: `HE-${String(m.id).replace(/-/g, "").slice(0, 6).toUpperCase()}`,
  };
  const prompt = buildVoiceSystemPrompt(ctx);
  if (dryRun) return { status: "dry_run", promptPreview: prompt.slice(0, 400) };

  // Superbot is the voice provider when configured; Vapi stays as the fallback. Superbot gets the match id as reference_id so its feedback finds the match.
  if (await superbotConfig()) {
    const q = await queueSuperbotCall({ referenceId: matchId, campaignId: cfg?.superbotCampaign ?? undefined, mobile10: String(m.mobile10),
      params: { name: ctx.candidateName, role: ctx.role, interview_date: sbDate(String(m.drive_date)), interview_time: sbTime(String(m.slot_at).slice(11, 16)), branch_address: ctx.branchAddress } });
    if (!q.ok) {
      if (q.reason === "bad_number") await db.execute("UPDATE he_lead SET last_outcome = 'wrong_number' WHERE id = ?", [m.lead_id]);
      if (q.reason === "auth") return { status: "blocked", reason: "voice_auth_failed" };
      await addEvent(m.lead_id as string, "call_failed_to_place", { channel: "voice", detail: `${q.reason}: ${q.error}`.slice(0, 300) });
      return { status: "failed", error: `${q.reason}: ${q.error}` };
    }
    // Already waiting in Superbot's queue: not a new attempt.
    if (q.alreadyQueued) return { status: "blocked", reason: "already_queued" };
    await addEvent(m.lead_id as string, "call_placed", { channel: "voice", detail: q.requestId || matchId, meta: { attempt: Number(att[0].n) + 1, matchId, provider: "superbot" } });
    return { status: "placed", callId: q.requestId || matchId };
  }
  const started = await startVapiCall({ ctx, mobile10: String(m.mobile10), metadata: { matchId, leadId: m.lead_id, attempt: Number(att[0].n) + 1, source: "hiring-engine" } });
  if (!started.ok) {
    if (started.reason !== "voice_not_configured") await addEvent(m.lead_id as string, "call_failed_to_place", { channel: "voice", detail: started.error.slice(0, 300) });
    return started.reason === "voice_not_configured" ? { status: "blocked", reason: "voice_not_configured" } : { status: "failed", error: started.error };
  }
  await addEvent(m.lead_id as string, "call_placed", { channel: "voice", detail: started.callId, meta: { attempt: Number(att[0].n) + 1, matchId } });
  return { status: "placed", callId: started.callId };
}

export type VapiStart = { ok: true; callId: string } | { ok: false; reason: "voice_not_configured" | "provider_error"; error: string };

/**
 * One outbound Vapi confirmation call. Shared by engine-driven calls (metadata carries matchId) and manual bulk
 * uploads (metadata carries jobId), so both get the same BRD prompt, structured-result schema and slot tool.
 */
export async function startVapiCall(a: { ctx: VoiceCtx; mobile10: string; metadata: Record<string, unknown> }): Promise<VapiStart> {
  const apiKey = env("VAPI_API_KEY");
  const phoneNumberId = env("VAPI_PHONE_NUMBER_ID");
  const token = (await webhookToken()).token ?? "";
  const base = env("BACKEND_PUBLIC_URL");
  if (!apiKey || !phoneNumberId || !token || !base) return { ok: false, reason: "voice_not_configured", error: "voice_not_configured" };

  const serverUrl = `${base}/api/he-hook/voice-vapi?token=${encodeURIComponent(token)}`;
  try {
    const { data } = await axios.post(
      `${env("VAPI_BASE_URL", "https://api.vapi.ai").replace(/\/$/, "")}/call/phone`, // VAPI_BASE_URL only for a sandbox
      {
        phoneNumberId,
        customer: { number: toE164(a.mobile10), name: a.ctx.candidateName },
        assistant: {
          name: `Interview confirmation ${a.ctx.referenceId}`,
          model: {
            provider: "openai", model: "gpt-4o-mini", messages: [{ role: "system", content: buildVoiceSystemPrompt(a.ctx) }],
            tools: [
              { type: "function", async: false, function: { name: "get_next_slot", description: "Reserve and return the next free walk-in slot at this branch. Use only after the candidate declines the original slot.", parameters: { type: "object", properties: {} } }, server: { url: serverUrl } },
              { type: "function", async: true, function: { name: "report_result", description: "Report what you learned on this call. Call exactly once before ending.", parameters: VOICE_RESULT_SCHEMA }, server: { url: serverUrl } },
            ],
          },
          voice: { provider: "11labs", voiceId: env("VAPI_VOICE_ID", "sarah") },
          firstMessage: VOICE_FIRST_MESSAGE(a.ctx.candidateName),
          maxDurationSeconds: 180,
          transcriber: { provider: "deepgram", language: "hi" },
          analysisPlan: { structuredDataPlan: { enabled: true, schema: VOICE_RESULT_SCHEMA } },
          serverMessages: ["end-of-call-report"],
        },
        metadata: a.metadata,
        serverUrl,
      },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 30000 },
    );
    return { ok: true, callId: String(data?.id ?? "") };
  } catch (err) {
    const msg = axios.isAxiosError(err) ? (err.response?.data?.message ?? err.message) : (err as Error).message;
    logger.warn({ error: msg }, "[he-voice] call placement failed");
    return { ok: false, reason: "provider_error", error: String(msg) };
  }
}

/** Tool: get_next_slot - reserves a replacement slot for this match and returns spoken labels. */
export async function toolNextSlot(matchId: string): Promise<{ dateLabel: string; timeLabel: string; slotAt: string } | { error: string }> {
  const slot = await reserveSlot(matchId, true);
  if (!slot) return { error: "no free slot" };
  const [r] = await db.execute<RowDataPacket[]>("SELECT d.drive_date FROM he_match m JOIN he_drive d ON d.id = m.drive_id WHERE m.id = ? LIMIT 1", [matchId]);
  return { dateLabel: dateLabel(String(r[0]?.drive_date ?? slot.slice(0, 10))), timeLabel: timeLabel(slot), slotAt: slot };
}

/** Tool: report_result - keep the arguments against the call so the end-of-call report can merge them. */
export async function toolReportResult(leadId: string, callId: string, args: Record<string, unknown>): Promise<void> {
  await addEvent(leadId, "voice_tool_result", { channel: "voice", detail: callId, meta: args });
}

export async function loadToolResult(callId: string): Promise<Record<string, unknown> | undefined> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT meta_json FROM he_lead_event WHERE event_type = 'voice_tool_result' AND detail = ? ORDER BY id DESC LIMIT 1", [callId]);
  if (!r[0]?.meta_json) return undefined;
  try { return typeof r[0].meta_json === "string" ? JSON.parse(r[0].meta_json) : (r[0].meta_json as Record<string, unknown>); } catch { return undefined; }
}
