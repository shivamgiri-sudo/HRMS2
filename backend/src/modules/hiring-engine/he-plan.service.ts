/**
 * Daily plan: for every requisition the owner put on the plan, make sure the next working day has a drive sized to the plan's numbers,
 * activate it and line people up (Find leads). Drives are created with auto-send on, so when the scheduler is on the morning tick emails
 * them, WhatsApp follows an hour later, and so on. Runs from the engine tick (evening) and from "Plan tomorrow now" on the Master tab.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { createDrive, setDriveStatus, suggestMatches } from "./he-drive.service.js";
import { bridgeAllMetaLeads, sweepOwnedCampaigns } from "./he-meta-bridge.service.js";
import { getDailyPlan, getPlanMetaOnly, getPlanRequisitions } from "./he-policy.service.js";
import { dailyPlanNumbers } from "./he-slots.js";
import { logger } from "../../logger.js";
import { planStreamsForDay, readStreamOwned, readStreamPlanned, type StreamDayPlan, type StreamPassResult } from "./he-stream-plan.service.js";
import { addDays, istToday, isSunday } from "./requisition-stream.window.js";

export interface PlannedDay { requisitionId: string; code: string; role: string; branch: string; date: string; status: "created" | "exists" | "skipped"; reason?: string; invitesWanted: number; lined: number; driveId?: string }

/** Tomorrow in IST, skipping Sundays. */
export function nextWorkingDay(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 5.5 * 3600_000 + 86_400_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function planNextDay(o: { date?: string; dryRun?: boolean } = {}): Promise<{ date: string; invitesPerDay: number; seatsPerSlot: number; days: PlannedDay[]; streams: StreamDayPlan[]; streamsClosed: StreamPassResult["closed"] }> {
  const plan = await getDailyPlan();
  const n = dailyPlanNumbers(plan);
  const date = o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : nextWorkingDay();
  const planIds = await getPlanRequisitions();
  const metaOnly = await getPlanMetaOnly();
  // Campaigns the Hiring Engine owns are on the plan automatically (their own requisition, lined up from their own leads), so a live Meta
  // campaign needs no manual plan setup. A requisition already on the owner's list keeps the owner's audience.
  const owned = new Map<string, string[]>();
  const [oc] = await db.execute<RowDataPacket[]>(
    `SELECT c.requisition_id, c.id FROM meta_campaign c JOIN he_campaign_config cfg ON cfg.campaign_id = c.id AND cfg.owner = 'he'
      WHERE c.campaign_status = 'active' AND c.requisition_id IS NOT NULL`);
  for (const r of oc) owned.set(String(r.requisition_id), [...(owned.get(String(r.requisition_id)) ?? []), String(r.id)]);
  const ids = [...planIds, ...[...owned.keys()].filter((x) => !planIds.includes(x))];
  if (!o.dryRun) { await sweepOwnedCampaigns(); if (metaOnly) await bridgeAllMetaLeads(); }
  const days: PlannedDay[] = [];
  // A requisition with an open or paused stream, or one a stream already planned for this day, is planned only by the stream pass.
  // When the planned-day read fails nobody is planned here this run (a whole-audience drive must never be mixed with stream caps).
  const streamOwned = await readStreamOwned();
  const streamPlanned = await readStreamPlanned(date);
  for (const id of streamPlanned ? ids.filter((x) => !streamOwned?.has(x) && !streamPlanned.has(x)) : []) {
    const [rq] = await db.execute<RowDataPacket[]>(
      `SELECT id, requisition_code, designation_name, branch_name, approval_status, active_status, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1`, [id]);
    const r = rq[0];
    const base = { requisitionId: id, code: String(r?.requisition_code ?? id), role: String(r?.designation_name ?? ""), branch: String(r?.branch_name ?? ""), date, invitesWanted: n.invites, lined: 0 };
    if (!r) { days.push({ ...base, status: "skipped", reason: "requisition not found" }); continue; }
    if (r.approval_status !== "approved" || !r.active_status || Number(r.fulfilled_headcount) >= Number(r.requested_headcount)) { days.push({ ...base, status: "skipped", reason: "requisition is closed or filled" }); continue; }
    const [ex] = await db.execute<RowDataPacket[]>("SELECT id, status FROM he_drive WHERE requisition_id = ? AND drive_date = ? LIMIT 1", [id, date]);
    if (ex[0] && ex[0].status !== "closed") { days.push({ ...base, status: "exists", driveId: String(ex[0].id) }); continue; }
    if (o.dryRun) { days.push({ ...base, status: "created", reason: "dry run" }); continue; }
    try {
      const audience = planIds.includes(id) ? (metaOnly ? { kind: "meta" as const } : undefined) : { kind: "campaign" as const, ids: owned.get(id) };
      const d = await createDrive({ requisitionId: id, audience, driveDate: date, slotStart: plan.slotStart, slotEnd: plan.slotEnd, slotMinutes: plan.slotMinutes, slotCapacity: n.perSlot, showRatePct: plan.showRatePct, targetShows: n.targetShows, autoSend: true });
      await setDriveStatus(d.id, "active");
      const lined = await suggestMatches(d.id);
      days.push({ ...base, status: "created", driveId: d.id, lined });
    } catch (e) { days.push({ ...base, status: "skipped", reason: (e instanceof Error ? e.message : String(e)).slice(0, 160) }); }
  }
  const { streams, streamsClosed } = await streamPass(o, date, streamOwned !== null);
  return { date, invitesPerDay: n.invites, seatsPerSlot: n.perSlot, days, streams, streamsClosed };
}

/**
 * The stream pass for `date`; on Saturday's evening run (no explicit date) also for Sunday first, which only a stream that added that
 * Sunday covers. Skipped when stream ownership could not be read (the legacy loop then saw every requisition). Never throws.
 */
async function streamPass(o: { date?: string; dryRun?: boolean }, date: string, ownershipKnown: boolean): Promise<{ streams: StreamDayPlan[]; streamsClosed: StreamPassResult["closed"] }> {
  const out = { streams: [] as StreamDayPlan[], streamsClosed: [] as StreamPassResult["closed"] };
  if (!ownershipKnown) { logger.warn({ date }, "[he-plan] stream pass skipped: stream ownership unknown"); return out; }
  try {
    const explicit = Boolean(o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date));
    const tomorrow = addDays(istToday(), 1);
    const dates = !explicit && isSunday(tomorrow) && tomorrow !== date ? [tomorrow, date] : [date];
    for (const d of dates) {
      const r = await planStreamsForDay({ date: d, dryRun: Boolean(o.dryRun) });
      out.streams.push(...r.plans);
      out.streamsClosed.push(...r.closed);
      if (r.failed) logger.warn({ date: d }, "[he-plan] stream pass failed");
    }
    return out;
  } catch (err) {
    logger.warn({ date, code: (err as { code?: string })?.code ?? "error" }, "[he-plan] stream pass failed");
    return { streams: [], streamsClosed: [] };
  }
}
