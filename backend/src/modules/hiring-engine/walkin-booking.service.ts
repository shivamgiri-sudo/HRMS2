/**
 * Booking core shared by the answer links (a Yes / another time on an invite token) and the unified follow-up (U-Task 6 bookJourney
 * wraps bookLeadOnDrive). Books a lead on the drive for requisition + branch + day: an existing drive is used exactly as HR made it
 * (never modified); a missing one is created active with auto_send 0, so the engine tick never sends invites for it. The slot is
 * chosen under a lock on the drive row, like reserveSlot, so two answers can never take the same last seat.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { requisitionClosedReason } from "../meta-campaign/lead-screener.service.js";
import { addEvent } from "./he-lead.service.js";
import { generateSlots, istAddMinutes, nowIst, type SlotConfig } from "./he-slots.js";

export interface BookingDriveInput { requisitionId: string; branchName: string; driveDate: string /* YYYY-MM-DD */; createdBy?: string | null }
export type DriveStatus = "draft" | "active" | "paused" | "closed";

export type BookResult =
  | { status: "booked"; matchId: string; driveId: string; slotAt: string; token: string; created: boolean }
  | { status: "unavailable"; reason: "requisition_closed" | "requisition_ended" | "drive_closed" | "no_capacity" | "no_branch" };

export interface BookInput {
  leadId: string; requisitionId: string; branchName: string; preferredSlotAt: string | null; now: Date; state: "invited";
  /** Run on the caller's connection (the caller owns the transaction); otherwise each date is its own short transaction. */
  tx?: PoolConnection;
}

const LOOKAHEAD = 6;
/** People invited per drive day (owner rule: about 400 touches a day to land the seats, because only a few percent walk in). */
export const DAILY_INVITES_PARAM = "policy.walkin_daily_invites";
export const DAILY_INVITES_DEFAULT = 400;
let invitesCache: { at: number; v: number } | null = null;
/** Test hook. */
export const resetInviteTargetCache = (): void => { invitesCache = null; };
async function dailyInviteTarget(): Promise<number> {
  if (invitesCache && Date.now() - invitesCache.at < 60_000) return invitesCache.v;
  let v = DAILY_INVITES_DEFAULT;
  try {
    const [r] = await db.execute<RowDataPacket[]>("SELECT value FROM he_model_param WHERE param_key = ? LIMIT 1", [DAILY_INVITES_PARAM]);
    if (r[0] != null) { const n = Number(r[0].value); if (Number.isFinite(n) && n >= 0) v = Math.floor(n); }
  } catch { /* the default stands */ }
  invitesCache = { at: Date.now(), v };
  return v;
}
/** Per-slot invitations for a day's target: never below the drive's own seat count (0 = the drive's seats are the limit). */
export const softSlotCapacity = (hard: number, slotsInDay: number, dailyTarget: number): number =>
  dailyTarget > 0 && slotsInDay > 0 ? Math.max(hard, Math.ceil(dailyTarget / slotsInDay)) : hard;

/** National holidays (leave_holiday_master) among these IST days; a read error means none (booking is never blocked by it). */
export async function nationalHolidays(days: string[]): Promise<Set<string>> {
  if (!days.length) return new Set();
  try {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT DATE_FORMAT(holiday_date, '%Y-%m-%d') AS d FROM leave_holiday_master
        WHERE holiday_type = 'national' AND active_status = 1 AND holiday_date IN (${days.map(() => "?").join(",")})`, days);
    return new Set(r.map((x) => String(x.d)));
  } catch { return new Set(); }
}
const FROZEN = new Set(["arrived", "selected", "declined"]);
/** db or a pool connection: only execute is used. */
type Exec = { execute: <T extends RowDataPacket[] | ResultSetHeader>(sql: string, params?: unknown[]) => Promise<[T, unknown]> };

/** Next Mon-Sat dates after today IST (`lookahead` of them); the preferred day goes first when it is today or later and not a Sunday. */
export function targetDriveDates(now: Date, preferred: string | null, lookahead = LOOKAHEAD): string[] {
  const today = nowIst(now).slice(0, 10);
  const dayAfter = (d: string) => istAddMinutes(`${d} 00:00:00`, 1440).slice(0, 10);
  const sunday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
  let start = preferred && preferred.slice(0, 10) >= today ? preferred.slice(0, 10) : dayAfter(today);
  while (sunday(start)) start = dayAfter(start);
  const out = [start];
  let d = start;
  while (out.length < lookahead + 1) { d = dayAfter(d); if (!sunday(d)) out.push(d); }
  return out;
}

/** The drive for requisition + branch + date; created (active, auto_send 0, 10:00-17:30 / 30 min / 6 a slot) only when absent. */
export async function createDriveIfAbsent(i: BookingDriveInput, conn: Exec = db): Promise<{ id: string; created: boolean; status: DriveStatus }> {
  const id = randomUUID();
  await conn.execute(
    `INSERT INTO he_drive (id, requisition_id, branch_name, drive_date, slot_start, slot_end, slot_minutes, slot_capacity, status, auto_send, created_by, source_kind, run_label)
     VALUES (?,?,?,?, '10:00:00', '17:30:00', 30, 6, 'active', 0, ?, 'pool', 'booked from answer')
     ON DUPLICATE KEY UPDATE id = id`,
    [id, i.requisitionId, i.branchName, i.driveDate, i.createdBy ?? null]);
  const [rows] = await conn.execute<RowDataPacket[]>("SELECT id, status FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ? LIMIT 1", [i.requisitionId, i.branchName, i.driveDate]);
  if (!rows[0]) throw new Error("createDriveIfAbsent: drive missing after insert");
  return { id: String(rows[0].id), created: String(rows[0].id) === id, status: rows[0].status as DriveStatus };
}

/** Preferred time when free, else the free slot nearest to it (earlier wins a tie), never within 60 minutes of now. */
export function pickSlot(cfg: SlotConfig, booked: Record<string, number>, nowIstStr: string, preferredTime: string | null): string | null {
  const earliest = istAddMinutes(nowIstStr, 60);
  const free = generateSlots(cfg).filter((s) => s >= earliest && (booked[s] ?? 0) < cfg.capacity);
  if (!free.length) return null;
  if (!preferredTime) return free[0];
  const want = `${cfg.date} ${preferredTime}`;
  const dist = (s: string) => Math.abs(Date.parse(s.replace(" ", "T") + "Z") - Date.parse(want.replace(" ", "T") + "Z"));
  return free.reduce((best, s) => (dist(s) < dist(best) ? s : best), free[0]);
}

async function requisitionOpen(requisitionId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT approval_status, active_status, closed_at, requested_headcount, fulfilled_headcount FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  const r = rows[0];
  if (!r) return false;
  const closed = requisitionClosedReason({
    approvalStatus: r.approval_status ?? null, activeStatus: r.active_status ?? null, closedAt: r.closed_at ?? null,
    requestedHeadcount: r.requested_headcount != null ? Number(r.requested_headcount) : null, fulfilledHeadcount: r.fulfilled_headcount != null ? Number(r.fulfilled_headcount) : null,
  });
  return closed == null && String(r.approval_status ?? "").toLowerCase() === "approved";
}

type MatchRow = { id: string; state: string; drive_id: string | null; slot_at: string | null; token: string | null };

/** One date: lock the drive, pick the slot, write the match. Returns null when that date cannot take the booking. */
async function bookOnDate(conn: Exec, a: BookInput, driveId: string, existing: MatchRow | null, preferredTime: string | null): Promise<{ matchId: string; slotAt: string; token: string } | "closed" | "full"> {
  const [d] = await conn.execute<RowDataPacket[]>("SELECT * FROM he_drive WHERE id = ? FOR UPDATE", [driveId]);
  const drive = d[0];
  if (!drive || drive.status === "closed" || drive.status === "paused") return "closed";
  if (existing && existing.drive_id === driveId && existing.slot_at && (existing.state === "invited" || existing.state === "confirmed")) {
    return { matchId: existing.id, slotAt: String(existing.slot_at).slice(0, 19), token: existing.token ?? "" };
  }
  const [b] = await conn.execute<RowDataPacket[]>(
    "SELECT slot_at, COUNT(*) AS n FROM he_match WHERE drive_id = ? AND slot_at IS NOT NULL AND state IN ('invited','confirmed') AND id <> ? GROUP BY slot_at",
    [driveId, existing?.id ?? ""]);
  const booked: Record<string, number> = {};
  for (const r of b) booked[String(r.slot_at).slice(0, 19)] = Number(r.n);
  const cfg: SlotConfig = { date: String(drive.drive_date).slice(0, 10), start: String(drive.slot_start).slice(0, 5), end: String(drive.slot_end).slice(0, 5), minutes: Number(drive.slot_minutes), capacity: Number(drive.slot_capacity) };
  cfg.capacity = softSlotCapacity(cfg.capacity, generateSlots(cfg).length, await dailyInviteTarget());
  const slot = pickSlot(cfg, booked, nowIst(a.now), preferredTime);
  if (!slot) return "full";
  const token = existing?.token ?? randomBytes(16).toString("hex");
  if (existing) {
    await conn.execute("UPDATE he_match SET drive_id = ?, slot_at = ?, state = ?, token = COALESCE(token, ?) WHERE id = ?", [driveId, slot, a.state, token, existing.id]);
    return { matchId: existing.id, slotAt: slot, token };
  }
  const id = randomUUID();
  await conn.execute("INSERT INTO he_match (id, lead_id, requisition_id, drive_id, score, state, slot_at, token) VALUES (?,?,?,?,?,?,?,?)",
    [id, a.leadId, a.requisitionId, driveId, 0, a.state, slot, token]);
  return { matchId: id, slotAt: slot, token };
}

/** Book a lead on the requisition's drive for the preferred day (or the next working day that has room). Never sends anything. */
export async function bookLeadOnDrive(a: BookInput): Promise<BookResult> {
  if (!a.branchName?.trim()) return { status: "unavailable", reason: "no_branch" };
  if (!(await requisitionOpen(a.requisitionId))) return { status: "unavailable", reason: "requisition_closed" };
  const [m] = await db.execute<RowDataPacket[]>("SELECT id, state, drive_id, slot_at, token FROM he_match WHERE lead_id = ? AND requisition_id = ? LIMIT 1", [a.leadId, a.requisitionId]);
  const existing = (m[0] as MatchRow | undefined) ?? null;
  if (existing && FROZEN.has(existing.state)) {
    return { status: "booked", matchId: existing.id, driveId: String(existing.drive_id ?? ""), slotAt: String(existing.slot_at ?? "").slice(0, 19), token: existing.token ?? "", created: false };
  }
  const preferredTime = a.preferredSlotAt && a.preferredSlotAt.length >= 16 ? `${a.preferredSlotAt.slice(11, 16)}:00` : null;
  // E10: with the end date enforced, no day after the requisition's end is booked (a read only while enforced).
  const lastDay = await lastBookableDay(a.requisitionId);
  const candidates = targetDriveDates(a.now, a.preferredSlotAt);
  // Nearest working day first: Sundays are skipped by targetDriveDates, national holidays here, and never a day after the requisition's end.
  const holidays = await nationalHolidays(candidates);
  const dates = candidates.filter((d) => !holidays.has(d) && (!lastDay || d <= lastDay));
  if (!dates.length) return { status: "unavailable", reason: "requisition_ended" };
  let sawOpenDrive = false;
  for (const date of dates) {
    let drive: Awaited<ReturnType<typeof createDriveIfAbsent>>;
    let r: Awaited<ReturnType<typeof bookOnDate>>;
    if (a.tx) {
      drive = await createDriveIfAbsent({ requisitionId: a.requisitionId, branchName: a.branchName.trim(), driveDate: date }, a.tx as unknown as Exec);
      if (drive.status === "closed" || drive.status === "paused") continue;
      sawOpenDrive = true;
      r = await bookOnDate(a.tx as unknown as Exec, a, drive.id, existing, preferredTime);
    } else {
      // E10: the drive is created in the booking's own transaction, so a date that cannot take the booking leaves no unused drive.
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        drive = await createDriveIfAbsent({ requisitionId: a.requisitionId, branchName: a.branchName.trim(), driveDate: date }, conn as unknown as Exec);
        if (drive.status === "closed" || drive.status === "paused") { await conn.rollback(); continue; }
        sawOpenDrive = true;
        r = await bookOnDate(conn as unknown as Exec, a, drive.id, existing, preferredTime);
        if (typeof r === "string") await conn.rollback(); else await conn.commit();
      } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
    }
    if (r === "closed") continue;
    if (r === "full") continue;
    await addEvent(a.leadId, "slot_assigned", { driveId: drive.id, detail: r.slotAt });
    return { status: "booked", matchId: r.matchId, driveId: drive.id, slotAt: r.slotAt, token: r.token, created: drive.created };
  }
  if (lastDay && dates.length < candidates.length) return { status: "unavailable", reason: "requisition_ended" };
  return { status: "unavailable", reason: sawOpenDrive ? "no_capacity" : "drive_closed" };
}

/** The requisition's last bookable IST day (its end date), or null when it has none. A day after the end is never offered. */
async function lastBookableDay(requisitionId: string): Promise<string | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT requisition_validity FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  const v = r[0]?.requisition_validity;
  if (!v) return null;
  return v instanceof Date ? new Date(v.getTime() + 330 * 60_000).toISOString().slice(0, 10) : String(v).slice(0, 10);
}
