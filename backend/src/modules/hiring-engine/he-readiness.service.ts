/**
 * Drive readiness: everything that decides whether outreach can actually go out, in one place, so HR sees why the
 * screen is quiet instead of guessing. Read-only.
 */
import { superbotConfig } from "./he-secrets.service.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { PinbotWhatsAppProvider } from "../communication/providers/whatsapp/pinbot.provider.js";
import { emailConfigured } from "./he-email.service.js";
import { istHour } from "./he-guardrails.js";
import { cadenceGapMin } from "./he-cadence.js";
import { sendsPaused } from "./he-send.service.js";
import { getRequisitionJd } from "./he-jd.service.js";
import { loadRequisitionForMatching } from "./he-drive.service.js";
import { engineAutoOn, engineMode, getDailyPlan } from "./he-policy.service.js";
import { evaluateRequisitionReadiness, isBlocking, type ReadinessProblem } from "./requisition-readiness.js";
import type { SourceType } from "./qualified-followup.types.js";

export interface Check { key: string; ok: boolean; label: string; detail: string; blocks: "email" | "whatsapp" | "voice" | "followups" | "all" | null }

export async function getDriveReadiness(driveId: string) {
  const [dr] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.requisition_id, d.status, d.auto_send, d.drive_date, d.target_shows, jr.requisition_code, jr.designation_name, jr.approval_status, jr.active_status,
            jr.requested_headcount, jr.fulfilled_headcount, bm.address
       FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE d.id = ? LIMIT 1`, [driveId]);
  const d = dr[0];
  if (!d) return null;
  const [m] = await db.execute<RowDataPacket[]>(
    `SELECT m.state, COUNT(*) AS n,
            SUM(l.email IS NOT NULL AND l.email <> '') AS with_email,
            SUM(EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = m.lead_id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL)) AS with_consent
       FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.drive_id = ? GROUP BY m.state`, [driveId]);
  const st = (s: string) => m.find((r) => r.state === s);
  const sug = st("suggested");
  const [tpl] = await db.execute<RowDataPacket[]>("SELECT SUM(approval_state = 'approved') AS approved, COUNT(*) AS total FROM he_template");
  const [inv] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_template WHERE template_key LIKE 'he_walkin_invite:%' AND approval_state = 'approved'");
  const [sent] = await db.execute<RowDataPacket[]>(
    // Messages sent FOR this drive (an earlier drive's emails to the same people do not count towards it).
    `SELECT msg.channel, COUNT(*) AS n FROM he_message msg
      WHERE msg.drive_id = ? AND msg.direction = 'out' AND msg.delivery_status <> 'failed' GROUP BY msg.channel`, [driveId]);
  const pinbotOk = new PinbotWhatsAppProvider().isConfigured();
  const vapiOk = Boolean(process.env.VAPI_API_KEY && process.env.VAPI_PHONE_NUMBER_ID) || Boolean(await superbotConfig());
  const mode = engineMode(process.env, await engineAutoOn());
  const engineOn = mode === "live", engineLive = mode === "live";
  const h = istHour(new Date());
  const reqOpen = d.approval_status === "approved" && Boolean(d.active_status) && Number(d.fulfilled_headcount) < Number(d.requested_headcount);
  const checks: Check[] = [
    { key: "requisition", ok: reqOpen, label: "Requisition open", detail: reqOpen ? `${d.requisition_code}: ${Number(d.requested_headcount) - Number(d.fulfilled_headcount)} open` : `${d.requisition_code} is closed or filled`, blocks: reqOpen ? null : "all" },
    { key: "paused", ok: !sendsPaused(), label: "Sending not paused", detail: sendsPaused() ? "HE_SENDS_PAUSED is on" : "ok", blocks: sendsPaused() ? "all" : null },
    { key: "hours", ok: h >= 9 && h < 20, label: "Within 09:00-20:00 IST", detail: h >= 9 && h < 20 ? "messages can go out now" : "nothing is sent outside 09:00-20:00; send after 9 AM", blocks: h >= 9 && h < 20 ? null : "all" },
    { key: "email", ok: emailConfigured(), label: "Email set up on the server", detail: emailConfigured() ? "ok" : "mail provider not configured", blocks: emailConfigured() ? null : "email" },
    { key: "address", ok: Boolean(d.address), label: "Branch address on file", detail: d.address ? "used in the email and the call" : "add the branch address in Branch master (the bot never invents one)", blocks: d.address ? null : "voice" },
    { key: "wa_template", ok: Number(inv[0]?.n ?? 0) > 0 && pinbotOk, label: "WhatsApp invite template approved", detail: !pinbotOk ? "WhatsApp provider not configured" : Number(inv[0]?.n ?? 0) > 0 ? "ok" : `${Number(tpl[0]?.approved ?? 0)} of ${Number(tpl[0]?.total ?? 0)} templates approved - WhatsApp step waits; the call follows the email instead`, blocks: Number(inv[0]?.n ?? 0) > 0 && pinbotOk ? null : "whatsapp" },
    { key: "voice", ok: vapiOk, label: "Voice bot set up", detail: vapiOk ? "ok" : "voice provider keys not configured", blocks: vapiOk ? null : "voice" },
    { key: "engine", ok: engineOn && engineLive, label: "Automatic follow-ups on", detail: engineOn && engineLive ? `WhatsApp ${cadenceGapMin()} min after the email, call after another ${cadenceGapMin()} min` : "automatic follow-ups are switched off: turn them on in the Follow-ups section below, or use 'Run follow-ups now'", blocks: engineOn && engineLive ? null : "followups" },
  ];
  const jd = await getRequisitionJd(String(d.requisition_id));
  const rules = await loadRequisitionForMatching(String(d.requisition_id));
  return {
    requirements: { jd, rules },
    drive: { id: d.id, requisitionId: d.requisition_id, status: d.status, autoSend: Boolean(d.auto_send), date: String(d.drive_date).slice(0, 10), targetShows: Number(d.target_shows), requisition: d.requisition_code, role: d.designation_name },
    checks,
    pool: {
      suggested: Number(sug?.n ?? 0), suggestedWithEmail: Number(sug?.with_email ?? 0), suggestedWithConsent: Number(sug?.with_consent ?? 0),
      invited: Number(st("invited")?.n ?? 0), confirmed: Number(st("confirmed")?.n ?? 0), arrived: Number(st("arrived")?.n ?? 0),
    },
    sent: Object.fromEntries(sent.map((r) => [String(r.channel), Number(r.n)])),
    canSendEmailNow: reqOpen && !sendsPaused() && h >= 9 && h < 20 && emailConfigured(),
    gapMinutes: cadenceGapMin(),
  };
}

export interface RequisitionReadiness { requisitionId: string; code: string; branch: string; ok: boolean; problems: ReadinessProblem[] }

/** Can a source stream be opened on this requisition? Null when the requisition does not exist. */
export async function getRequisitionReadiness(requisitionId: string, sourceType?: SourceType | null): Promise<RequisitionReadiness | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT jr.requisition_code, jr.branch_name, jr.approval_status, jr.active_status, jr.requested_headcount, jr.fulfilled_headcount, jr.bmi_assessment_url,
            (SELECT bm.address FROM branch_master bm WHERE bm.branch_name = jr.branch_name COLLATE utf8mb4_unicode_ci AND bm.active_status = 1 LIMIT 1) AS branch_address
       FROM job_requisition jr WHERE jr.id = ? LIMIT 1`, [requisitionId]);
  const r = rows[0];
  if (!r) return null;
  const [t] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(template_key LIKE 'he_walkin_invite:%') AS t1, SUM(template_key LIKE 'he_winback:%') AS t8 FROM he_template WHERE approval_state = 'approved'`);
  const plan = await getDailyPlan();
  const problems = evaluateRequisitionReadiness({
    approvalStatus: r.approval_status == null ? null : String(r.approval_status), activeStatus: r.active_status == null ? null : Number(r.active_status),
    requested: Number(r.requested_headcount ?? 0), fulfilled: Number(r.fulfilled_headcount ?? 0),
    branchAddress: r.branch_address == null ? null : String(r.branch_address), bmiLink: r.bmi_assessment_url == null ? null : String(r.bmi_assessment_url),
    slotStart: plan.slotStart, slotEnd: plan.slotEnd, slotMinutes: plan.slotMinutes,
    t1Approved: Number(t[0]?.t1 ?? 0), t8Approved: Number(t[0]?.t8 ?? 0), sourceType: sourceType ?? null,
  });
  return { requisitionId, code: String(r.requisition_code), branch: String(r.branch_name), ok: !isBlocking(problems), problems };
}
