/**
 * Daily plan: for every requisition the owner put on the plan, make sure the next working day has a drive sized to the plan's numbers,
 * activate it and line people up (Find leads). Drives are created with auto-send on, so when the scheduler is on the morning tick emails
 * them, WhatsApp follows an hour later, and so on. Runs from the engine tick (evening) and from "Plan tomorrow now" on the Master tab.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { createDrive, setDriveStatus, suggestMatches } from "./he-drive.service.js";
import { getDailyPlan, getPlanMetaOnly, getPlanRequisitions } from "./he-policy.service.js";
import { dailyPlanNumbers } from "./he-slots.js";

export interface PlannedDay { requisitionId: string; code: string; role: string; branch: string; date: string; status: "created" | "exists" | "skipped"; reason?: string; invitesWanted: number; lined: number; driveId?: string }

/** Tomorrow in IST, skipping Sundays. */
export function nextWorkingDay(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 5.5 * 3600_000 + 86_400_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function planNextDay(o: { date?: string; dryRun?: boolean } = {}): Promise<{ date: string; invitesPerDay: number; seatsPerSlot: number; days: PlannedDay[] }> {
  const plan = await getDailyPlan();
  const n = dailyPlanNumbers(plan);
  const date = o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : nextWorkingDay();
  const ids = await getPlanRequisitions();
  const metaOnly = await getPlanMetaOnly();
  const days: PlannedDay[] = [];
  for (const id of ids) {
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
      const d = await createDrive({ requisitionId: id, driveDate: date, slotStart: plan.slotStart, slotEnd: plan.slotEnd, slotMinutes: plan.slotMinutes, slotCapacity: n.perSlot, showRatePct: plan.showRatePct, targetShows: n.targetShows, autoSend: true });
      await setDriveStatus(d.id, "active");
      const lined = await suggestMatches(d.id, undefined, { metaOnly });
      days.push({ ...base, status: "created", driveId: d.id, lined });
    } catch (e) { days.push({ ...base, status: "skipped", reason: (e instanceof Error ? e.message : String(e)).slice(0, 160) }); }
  }
  return { date, invitesPerDay: n.invites, seatsPerSlot: n.perSlot, days };
}
