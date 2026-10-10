/**
 * Morning health check for the hiring drives: one email a day (from 08:15 IST) to the owner listing anything stuck or waiting, so a
 * silent failure (a reader that never connected, a WhatsApp queue that stopped, a requisition that is past its end date but still open)
 * shows up the next morning, not weeks later. Read-only apart from the one email and a "sent today" stamp. Never throws.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { emailService } from "../communication/email.service.js";
import { DEFAULT_CALL_FILE_TO } from "./qualified-followup.policy.js";

export type Level = "ok" | "warn" | "crit";
export interface Check { key: string; level: Level; title: string; detail: string }

const IST_MS = 5.5 * 3600_000;
export const istDay = (now: Date): string => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
export const istHour = (now: Date): number => new Date(now.getTime() + IST_MS).getUTCHours() + new Date(now.getTime() + IST_MS).getUTCMinutes() / 60;

const n = (v: unknown): number => Number(v ?? 0) || 0;
const one = async (sql: string, p: unknown[] = []): Promise<RowDataPacket | null> => {
  try { const [r] = await db.execute<RowDataPacket[]>(sql, p); return r[0] ?? null; } catch { return null; }
};
const many = async (sql: string, p: unknown[] = []): Promise<RowDataPacket[] | null> => {
  try { const [r] = await db.execute<RowDataPacket[]>(sql, p); return r; } catch { return null; }
};

/** The checks, each independent: a query that fails is reported as unknown, never as healthy. */
export async function collectHealth(now = new Date()): Promise<Check[]> {
  const out: Check[] = [];
  const add = (key: string, level: Level, title: string, detail: string) => out.push({ key, level, title, detail });

  const sync = await one("SELECT TIMESTAMPDIFF(HOUR, MAX(created_at), NOW()) AS h FROM meta_lead_raw");
  if (!sync) add("meta_sync", "warn", "Meta lead sync", "could not be read");
  else if (n(sync.h) >= 18) add("meta_sync", "warn", "Meta leads are not arriving", `the newest lead came in ${n(sync.h)} hours ago`);
  else add("meta_sync", "ok", "Meta leads are arriving", `newest lead ${n(sync.h)} h ago`);

  const reader = await one("SELECT last_uid FROM inbound_email_cursor LIMIT 1");
  add("reply_reader", reader ? "ok" : "crit", reader ? "Candidate replies are being read" : "Candidate replies are NOT being read",
    reader ? "the mailbox cursor is moving" : "the reader has never recorded a position: check the mailbox settings and the installed packages");

  const waDue = await one("SELECT COUNT(*) n, MIN(wa_due_at) oldest FROM qualified_followup WHERE mode_at_enqueue = 'live' AND stopped_reason IS NULL AND wa_status IS NULL AND wa_sent_at IS NULL AND wa_due_at IS NOT NULL AND wa_due_at < DATE_SUB(NOW(), INTERVAL 20 HOUR)");
  if (waDue && n(waDue.n) > 0) add("wa_backlog", "crit", "WhatsApp is stuck", `${n(waDue.n)} people have been waiting for their WhatsApp more than 20 hours (oldest due ${String(waDue.oldest).slice(0, 16)})`);
  else add("wa_backlog", "ok", "WhatsApp is keeping up", "nobody has waited more than 20 hours");

  const fail = await one("SELECT SUM(channel = 'email') em, SUM(channel = 'whatsapp') wa FROM he_message WHERE direction = 'out' AND delivery_status = 'failed' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)");
  if (fail && (n(fail.em) > 10 || n(fail.wa) > 20)) add("send_failures", "warn", "Many sends failed in the last day", `${n(fail.em)} emails and ${n(fail.wa)} WhatsApp messages failed`);
  else add("send_failures", "ok", "Sends are going through", `${n(fail?.em)} emails and ${n(fail?.wa)} WhatsApp failed in the last day`);

  const q = await one("SELECT SUM(status = 'queued') queued, SUM(status IN ('draft','held') AND hold_reason IN ('needs_human','low_confidence','validation_failed','draft_mode') AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)) stale, SUM(status IN ('draft','held')) waiting FROM candidate_reply");
  if (q && n(q.queued) > 0) add("queued_replies", "crit", "Replies are queued and not leaving", `${n(q.queued)} replies are waiting to be sent`);
  if (q && n(q.stale) > 0) add("stale_replies", "warn", "Candidate replies waiting for HR over a day", `${n(q.stale)} replies have had no answer from HR in 24 hours`);
  else add("replies", "ok", "Candidate replies", `${n(q?.waiting)} waiting for HR`);

  const portal = await one("SELECT COUNT(*) n FROM qualified_followup_call_batch WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND JSON_EXTRACT(summary, '$.portal.ok') = false");
  if (portal && n(portal.n) > 0) add("portal_upload", "crit", "A calling file did not reach the portal", `${n(portal.n)} files in the last day: upload them by hand and check the portal login`);

  const stuckCorr = await one(`SELECT COUNT(*) n FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.state = 'invited' AND m.slot_at > NOW() AND m.drive_id IS NOT NULL AND l.status <> 'opted_out'
     AND EXISTS (SELECT 1 FROM he_message x WHERE x.lead_id = m.lead_id AND x.requisition_id = m.requisition_id AND x.template_key = 'he_walkin_invite_email' AND x.direction = 'out' AND x.delivery_status <> 'failed' AND NOT (x.drive_id <=> m.drive_id))
     AND NOT EXISTS (SELECT 1 FROM he_message y WHERE y.lead_id = m.lead_id AND y.requisition_id = m.requisition_id AND y.template_key = 'he_walkin_invite_email' AND y.direction = 'out' AND y.delivery_status <> 'failed' AND y.drive_id <=> m.drive_id)`);
  if (stuckCorr && n(stuckCorr.n) > 50) add("slot_corrections", "warn", "Corrected invitations are piling up", `${n(stuckCorr.n)} people hold a new slot that has not been emailed to them yet`);

  const past = await many("SELECT requisition_code c, requisition_validity v FROM job_requisition WHERE active_status = 1 AND approval_status = 'approved' AND fulfilled_headcount < requested_headcount AND requisition_validity IS NOT NULL AND requisition_validity < CURDATE() ORDER BY requisition_validity LIMIT 12");
  if (past && past.length) add("past_deadline", "warn", "Requisitions past their end date are still open", past.map((r) => `${r.c} (ended ${String(r.v).slice(0, 10)})`).join(", ") + ". Close or extend them.");

  const noBmi = await one("SELECT COUNT(*) n FROM job_requisition WHERE active_status = 1 AND approval_status = 'approved' AND fulfilled_headcount < requested_headcount AND (requisition_validity IS NULL OR requisition_validity >= CURDATE()) AND (bmi_assessment_url IS NULL OR bmi_assessment_url = '')");
  if (noBmi && n(noBmi.n) > 0) add("bmi_links", "warn", "Open requisitions without an assessment link", `${n(noBmi.n)} requisitions: add the link in Hiring Engine, Master tab`);

  const idle = await many(`SELECT j.requisition_code c FROM job_requisition j WHERE j.active_status = 1 AND j.approval_status = 'approved' AND j.fulfilled_headcount < j.requested_headcount
      AND (j.requisition_validity IS NULL OR j.requisition_validity >= CURDATE())
      AND NOT EXISTS (SELECT 1 FROM qualified_followup q WHERE q.requisition_id = j.id AND q.mode_at_enqueue = 'live') LIMIT 12`);
  if (idle && idle.length) add("idle_requisitions", "warn", "Open requisitions nobody has been invited for", idle.map((r) => String(r.c)).join(", "));

  const calls = await one("SELECT COUNT(*) n FROM qualified_followup WHERE mode_at_enqueue = 'live' AND call_state = 'in_file' AND call_file_batch_id IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 36 HOUR)");
  if (calls && n(calls.n) > 0) add("call_backlog", "warn", "People waiting for a calling file", `${n(calls.n)} people have been ready for a call for over a day`);

  return out;
}

const COLOR: Record<Level, string> = { ok: "#1b7f4b", warn: "#a15c00", crit: "#b3261e" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function healthEmail(checks: Check[], day: string): { subject: string; html: string; text: string; level: Level } {
  const level: Level = checks.some((c) => c.level === "crit") ? "crit" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  const bad = checks.filter((c) => c.level !== "ok");
  const subject = level === "ok" ? `[HRMS] Hiring drives: all healthy (${day})` : `[HRMS] Hiring drives: ${bad.length} need attention (${day})`;
  const order = [...checks].sort((a, b) => ["crit", "warn", "ok"].indexOf(a.level) - ["crit", "warn", "ok"].indexOf(b.level));
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><h3 style="margin:0 0 10px">Hiring drives, morning check ${esc(day)}</h3>` + order.map((c) =>
    `<p style="margin:0 0 10px;padding-left:10px;border-left:4px solid ${COLOR[c.level]}"><b>${esc(c.title)}</b><br><span style="color:#444">${esc(c.detail)}</span></p>`).join("") + "</div>";
  const text = order.map((c) => `[${c.level.toUpperCase()}] ${c.title}: ${c.detail}`).join("\n");
  return { subject, html, text, level };
}

const STAMP_KEY = "ops.health_last_day";
/** Once per IST day, from 08:15: collect and email. Returns whether it sent. */
export async function runMorningHealth(now = new Date(), deps: { send?: typeof emailService.send; to?: string } = {}): Promise<boolean> {
  try {
    if (istHour(now) < 8.25 || istHour(now) >= 12) return false;
    const day = istDay(now);
    const num = Number(day.replace(/-/g, ""));
    const stamp = await one("SELECT sample FROM he_model_param WHERE param_key = ? LIMIT 1", [STAMP_KEY]);
    if (stamp && n(stamp.sample) === num) return false;
    // Claim the day first so two processes never send twice.
    await db.execute("INSERT INTO he_model_param (param_key, value, sample) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE sample = VALUES(sample)", [STAMP_KEY, num]);
    const mail = healthEmail(await collectHealth(now), day);
    const to = deps.to ?? (process.env.HE_HEALTH_TO?.trim() || DEFAULT_CALL_FILE_TO);
    await (deps.send ?? emailService.send.bind(emailService))({ to, subject: mail.subject, html: mail.html, text: mail.text });
    logger.info({ level: mail.level }, "[ops-health] morning check sent");
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 160) }, "[ops-health] morning check failed");
    return false;
  }
}
