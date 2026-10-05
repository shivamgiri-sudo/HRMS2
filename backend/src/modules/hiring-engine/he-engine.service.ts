/**
 * The engine tick. Each step is independent and idempotent (events/states guard against double sends), and
 * every step honours `dryRun`, which reports what would happen without sending or writing.
 *   1 replacement slots  - candidates who asked to reschedule get ONE new slot (second no -> human, see he-state)
 *   2 drive invites      - suggested matches of ACTIVE auto-send drives get slot + invite
 *   3 reminders          - T-1d and T-2h for confirmed candidates
 *   4 arrival sync       - candidates who registered at the branch on the drive day are marked arrived
 *   5 no-shows           - slot passed with no arrival -> no_show + one recovery message
 *   6 voice calls        - invited, 30+ min since the WhatsApp invite, no reply -> BRD confirmation call (1 retry after 2h)
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { addEvent, setLeadStatus } from "./he-lead.service.js";
import { recomputeInsight } from "./he-insight.service.js";
import { reserveSlot, suggestMatches } from "./he-drive.service.js";
import { sendTemplateToLead, sendsPaused, type SendResult } from "./he-send.service.js";
import { placeVoiceCall } from "./he-voice.service.js";

export interface TickSummary {
  dryRun: boolean;
  paused: boolean;
  replacementSlots: Counts;
  invites: Counts;
  reminders: Counts;
  arrivals: number;
  noShows: number;
  recovery: Counts;
  calls: Counts;
}
interface Counts { sent: number; blocked: Record<string, number>; failed: number; dryRun: number }
const counts = (): Counts => ({ sent: 0, blocked: {}, failed: 0, dryRun: 0 });
function tally(c: Counts, r: SendResult): void {
  if (r.status === "sent") c.sent++;
  else if (r.status === "dry_run") c.dryRun++;
  else if (r.status === "failed") c.failed++;
  else c.blocked[r.reason] = (c.blocked[r.reason] ?? 0) + 1;
}

async function voiceCalls(dryRun: boolean, c: Counts, max: number): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id FROM he_match m
      WHERE m.state = 'invited' AND m.slot_at > NOW()
        AND EXISTS (SELECT 1 FROM he_message o WHERE o.lead_id = m.lead_id AND o.direction = 'out' AND o.template_key LIKE 'he_walkin_invite%'
                      AND o.created_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))
        AND NOT EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.created_at > DATE_SUB(NOW(), INTERVAL 2 DAY))
      ORDER BY m.slot_at LIMIT ?`, [max]);
  for (const r of rows) {
    const res = await placeVoiceCall(r.id as string, { dryRun });
    if (res.status === "placed") c.sent++;
    else if (res.status === "dry_run") c.dryRun++;
    else if (res.status === "failed") c.failed++;
    else c.blocked[res.reason] = (c.blocked[res.reason] ?? 0) + 1;
  }
}

async function eventExists(leadId: string, driveId: string, type: string): Promise<boolean> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT 1 FROM he_lead_event WHERE lead_id = ? AND drive_id = ? AND event_type = ? LIMIT 1", [leadId, driveId, type]);
  return r.length > 0;
}

async function replacementSlots(dryRun: boolean, c: Counts, max: number): Promise<void> {
  // reschedule_requested more recent than the last slot_offered, match released.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id AS match_id, m.lead_id FROM he_match m
      WHERE m.state = 'slot_released' AND m.drive_id IS NOT NULL
        AND (SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND e.event_type = 'reschedule_requested')
          > COALESCE((SELECT MAX(id) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND e.event_type = 'slot_offered'), 0)
      LIMIT ?`, [max]);
  for (const r of rows) {
    if (dryRun) { c.dryRun++; continue; }
    const slot = await reserveSlot(r.match_id as string, true);
    if (!slot) { await addEvent(r.lead_id as string, "needs_human_followup", { detail: "no free slot to reschedule into" }); c.blocked.no_free_slot = (c.blocked.no_free_slot ?? 0) + 1; continue; }
    const res = await sendTemplateToLead({ leadId: r.lead_id as string, key: "he_reschedule_offer", matchId: r.match_id as string });
    if (res.status === "sent") await db.execute("UPDATE he_match SET state = 'invited' WHERE id = ?", [r.match_id]);
    else await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [r.match_id]); // not sent -> do not hold the seat
    tally(c, res);
  }
}

async function driveInvites(dryRun: boolean, c: Counts, max: number): Promise<void> {
  const [drives] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM he_drive WHERE status = 'active' AND auto_send = 1 AND drive_date >= CURDATE() AND drive_date <= DATE_ADD(CURDATE(), INTERVAL 3 DAY)");
  let budget = max;
  for (const d of drives) {
    const driveId = d.id as string;
    if (!dryRun) await suggestMatches(driveId);
    const [ms] = await db.execute<RowDataPacket[]>(
      // Only leads that can actually be messaged: unconsented suggestions would be blocked at send time but still eat the
      // invite budget. They stay 'suggested' (visible in the drive) until consent exists, e.g. after a telecaller call.
      `SELECT m.id, m.lead_id FROM he_match m
        WHERE m.drive_id = ? AND m.state = 'suggested'
          AND EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = m.lead_id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NULL)
        ORDER BY m.score DESC LIMIT ?`, [driveId, budget]);
    for (const m of ms) {
      if (budget <= 0) return;
      if (dryRun) { c.dryRun++; budget--; continue; }
      const slot = await reserveSlot(m.id as string);
      if (!slot) break; // drive full
      const res = await sendTemplateToLead({ leadId: m.lead_id as string, key: "he_walkin_invite", matchId: m.id as string });
      if (res.status === "sent") await db.execute("UPDATE he_match SET state = 'invited' WHERE id = ?", [m.id]);
      else await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [m.id]);
      tally(c, res);
      budget--;
    }
  }
}

async function reminders(dryRun: boolean, c: Counts): Promise<void> {
  for (const [key, evt, loMin, hiMin] of [["he_reminder_1d", "reminder_1d_sent", 22 * 60, 26 * 60], ["he_reminder_2h_location", "reminder_2h_sent", 90, 150]] as const) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT m.id, m.lead_id, m.drive_id FROM he_match m
        WHERE m.state = 'confirmed' AND m.slot_at BETWEEN DATE_ADD(NOW(), INTERVAL ? MINUTE) AND DATE_ADD(NOW(), INTERVAL ? MINUTE)`, [loMin, hiMin]);
    for (const r of rows) {
      if (await eventExists(r.lead_id as string, r.drive_id as string, evt)) continue;
      const res = await sendTemplateToLead({ leadId: r.lead_id as string, key, matchId: r.id as string, dryRun });
      tally(c, res);
      if (res.status === "sent") await addEvent(r.lead_id as string, evt, { driveId: r.drive_id as string, channel: "whatsapp" });
    }
  }
}

/** A candidate who filled the branch walk-in form on the drive day (matched by mobile) has arrived. */
async function arrivalSync(dryRun: boolean): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.drive_id FROM he_match m
       JOIN he_drive d ON d.id = m.drive_id AND d.drive_date = CURDATE()
       JOIN he_lead l ON l.id = m.lead_id
       JOIN ats_candidate c ON RIGHT(REGEXP_REPLACE(c.mobile, '[^0-9]', ''), 10) = l.mobile10 AND c.walk_in_date = CURDATE()
      WHERE m.state IN ('invited','confirmed')`);
  if (dryRun) return rows.length;
  for (const r of rows) {
    await db.execute("UPDATE he_match SET state = 'arrived' WHERE id = ?", [r.id]);
    await setLeadStatus(r.lead_id as string, "arrived");
    await addEvent(r.lead_id as string, "arrived", { driveId: r.drive_id as string, channel: "branch", detail: "registered at branch" });
    await recomputeInsight(r.lead_id as string);
  }
  return rows.length;
}

async function noShows(dryRun: boolean, c: Counts): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.drive_id FROM he_match m
      WHERE m.state IN ('invited','confirmed') AND m.slot_at IS NOT NULL AND m.slot_at < DATE_SUB(NOW(), INTERVAL 120 MINUTE)
        AND m.slot_at > DATE_SUB(NOW(), INTERVAL 2 DAY)`);
  for (const r of rows) {
    if (dryRun) continue;
    await db.execute("UPDATE he_match SET state = 'no_show' WHERE id = ?", [r.id]);
    await setLeadStatus(r.lead_id as string, "no_show");
    await addEvent(r.lead_id as string, "no_show", { driveId: r.drive_id as string, channel: "system" });
    await recomputeInsight(r.lead_id as string);
    // One recovery message for a first no-show only; the insight stops it after two.
    const [ns] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM he_match WHERE lead_id = ? AND state = 'no_show'", [r.lead_id]);
    if (Number(ns[0].n) === 1) tally(c, await sendTemplateToLead({ leadId: r.lead_id as string, key: "he_no_show_recovery", matchId: r.id as string }));
  }
  return rows.length;
}

export async function runEngineTick(o: { dryRun?: boolean; maxInvites?: number } = {}): Promise<TickSummary> {
  const dryRun = o.dryRun !== false; // safe default: only an explicit false sends
  const s: TickSummary = { dryRun, paused: sendsPaused(), replacementSlots: counts(), invites: counts(), reminders: counts(), arrivals: 0, noShows: 0, recovery: counts(), calls: counts() };
  const guard = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (err) { logger.error({ err: (err as Error).message, step: name }, "[he-engine] step failed"); } };
  // Arrival + no-show bookkeeping is state hygiene, not outreach, so it runs even while sends are paused.
  await guard("arrival", async () => { s.arrivals = await arrivalSync(dryRun); });
  await guard("noshow", async () => { s.noShows = await noShows(dryRun, s.recovery); });
  if (!s.paused) {
    await guard("replacement", () => replacementSlots(dryRun, s.replacementSlots, 50));
    await guard("invites", () => driveInvites(dryRun, s.invites, o.maxInvites ?? 100));
    await guard("reminders", () => reminders(dryRun, s.reminders));
    await guard("voice", () => voiceCalls(dryRun, s.calls, 20));
  }
  return s;
}
