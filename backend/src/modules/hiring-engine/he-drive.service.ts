/**
 * Walk-in drives: turn a requisition's open positions into a dated drive with a slot calendar, suggest the
 * best-fit leads for it, and reserve slots atomically (the drive row is locked, so two simultaneous invites
 * or voice calls can never be handed the same last seat).
 */
import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { eduRank } from "../meta-campaign/lead-screener.service.js";
import { rankRequisitions, scoreLead, type MatchRequisition } from "./he-matcher.js";
import { driveCapacity, inviteTarget, nextFreeSlot, nowIst, type SlotConfig } from "./he-slots.js";
import { addEvent } from "./he-lead.service.js";

export interface DriveInput {
  requisitionId: string;
  driveDate: string; // YYYY-MM-DD
  slotStart?: string;
  slotEnd?: string;
  slotMinutes?: number;
  slotCapacity?: number;
  showRatePct?: number;
  autoSend?: boolean;
  createdBy?: string | null;
}

interface ReqRow extends RowDataPacket {
  id: string; branch_name: string; process_name: string | null; designation_name: string;
  requested_headcount: number; fulfilled_headcount: number; approval_status: string; active_status: number;
  meta_target_age_min: number | null; meta_target_age_max: number | null; meta_target_radius_km: number | null;
  education_requirement: string | null; experience_min_years: number | null; night_shift_required: number;
  blat: number | null; blng: number | null;
}

export function toMatchRequisition(r: ReqRow): MatchRequisition & { id: string } {
  const edu = r.education_requirement ? eduRank(r.education_requirement) : 0;
  return {
    id: r.id,
    ageMin: r.meta_target_age_min, ageMax: r.meta_target_age_max,
    minEducationRank: edu > 0 ? edu : null,
    minExperienceYears: r.experience_min_years,
    nightShift: Boolean(r.night_shift_required),
    branchLat: r.blat, branchLng: r.blng, maxDistanceKm: r.meta_target_radius_km,
    processName: r.process_name,
  };
}

async function loadRequisition(id: string): Promise<ReqRow | null> {
  const [rows] = await db.execute<ReqRow[]>(
    `SELECT jr.id, jr.branch_name, jr.process_name, jr.designation_name, jr.requested_headcount, jr.fulfilled_headcount,
            jr.approval_status, jr.active_status, jr.meta_target_age_min, jr.meta_target_age_max, jr.meta_target_radius_km,
            jr.education_requirement, jr.experience_min_years, jr.night_shift_required,
            bm.latitude AS blat, bm.longitude AS blng
       FROM job_requisition jr LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE jr.id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function createDrive(i: DriveInput): Promise<{ id: string; invites: number; targetShows: number; capacity: number }> {
  const req = await loadRequisition(i.requisitionId);
  if (!req) throw new Error("Requisition not found");
  if (req.approval_status !== "approved" || !req.active_status) throw new Error("Requisition is not open for hiring");
  const open = req.requested_headcount - req.fulfilled_headcount;
  if (open <= 0) throw new Error("Requisition has no open positions");
  const cfg: SlotConfig = { date: i.driveDate, start: i.slotStart ?? "10:00", end: i.slotEnd ?? "17:30", minutes: i.slotMinutes ?? 30, capacity: i.slotCapacity ?? 6 };
  const cap = driveCapacity(cfg);
  const { targetShows, invites } = inviteTarget({ openPositions: open, showRatePct: i.showRatePct ?? 40, capacity: cap });
  const [r] = await db.execute<ResultSetHeader>(
    `INSERT INTO he_drive (requisition_id, branch_name, drive_date, slot_start, slot_end, slot_minutes, slot_capacity, target_shows, show_rate_pct, status, auto_send, created_by)
     VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?, ?)
     ON DUPLICATE KEY UPDATE slot_start = VALUES(slot_start), slot_end = VALUES(slot_end), slot_minutes = VALUES(slot_minutes),
       slot_capacity = VALUES(slot_capacity), target_shows = VALUES(target_shows), show_rate_pct = VALUES(show_rate_pct)`,
    [i.requisitionId, req.branch_name, i.driveDate, `${cfg.start}:00`.slice(0, 8), `${cfg.end}:00`.slice(0, 8), cfg.minutes, cfg.capacity, targetShows, i.showRatePct ?? 40, i.autoSend ? 1 : 0, i.createdBy ?? null]);
  const [row] = await db.execute<RowDataPacket[]>("SELECT id FROM he_drive WHERE requisition_id = ? AND branch_name = ? AND drive_date = ?", [i.requisitionId, req.branch_name, i.driveDate]);
  void r;
  return { id: row[0].id as string, invites, targetShows, capacity: cap };
}

export async function setDriveStatus(id: string, status: "draft" | "active" | "paused" | "closed"): Promise<void> {
  await db.execute("UPDATE he_drive SET status = ? WHERE id = ?", [status, id]);
}

interface DriveRow extends RowDataPacket {
  id: string; requisition_id: string; branch_name: string; drive_date: string; slot_start: string; slot_end: string;
  slot_minutes: number; slot_capacity: number; target_shows: number; show_rate_pct: number; status: string; auto_send: number;
}
const slotCfg = (d: DriveRow): SlotConfig => ({ date: String(d.drive_date).slice(0, 10), start: String(d.slot_start).slice(0, 5), end: String(d.slot_end).slice(0, 5), minutes: d.slot_minutes, capacity: d.slot_capacity });

/**
 * Score open, eligible leads against the drive's requisition and store the best as `suggested` matches.
 * A lead already booked into another live drive is skipped (no double booking); leads that cleared a round
 * for this process before get a bonus. Returns how many matches were written.
 */
export async function suggestMatches(driveId: string, limit?: number): Promise<number> {
  const [dr] = await db.execute<DriveRow[]>("SELECT * FROM he_drive WHERE id = ? LIMIT 1", [driveId]);
  const drive = dr[0];
  if (!drive) throw new Error("Drive not found");
  const req = await loadRequisition(drive.requisition_id);
  if (!req) throw new Error("Requisition not found");
  const mreq = toMatchRequisition(req);
  const cfg = slotCfg(drive);
  const { invites } = inviteTarget({ openPositions: Math.max(1, req.requested_headcount - req.fulfilled_headcount), showRatePct: drive.show_rate_pct, capacity: driveCapacity(cfg) });
  const want = limit ?? invites;

  const [leads] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.age, l.education_rank, l.experience_years, l.night_shift_ok, l.lat, l.lng, COALESCE(i.engagement_score, 0) AS eng
       FROM he_lead l LEFT JOIN he_lead_insight i ON i.lead_id = l.id
      WHERE l.status IN ('new','contacted','interested','declined','no_show')
        AND NOT EXISTS (SELECT 1 FROM he_match m WHERE m.lead_id = l.id AND m.state IN ('invited','confirmed') AND m.slot_at >= NOW())
        AND NOT EXISTS (SELECT 1 FROM he_consent c WHERE c.lead_id = l.id AND c.consent_type = 'whatsapp_contact' AND c.revoked_at IS NOT NULL)
      ORDER BY eng DESC LIMIT 5000`);
  const scored = leads
    .map((l) => ({ id: l.id as string, res: scoreLead({ age: l.age, educationRank: l.education_rank, experienceYears: l.experience_years == null ? null : Number(l.experience_years), nightShiftOk: l.night_shift_ok == null ? null : Boolean(l.night_shift_ok), lat: l.lat == null ? null : Number(l.lat), lng: l.lng == null ? null : Number(l.lng) }, mreq), eng: Number(l.eng) }))
    .filter((x) => x.res.eligible)
    .sort((a, b) => b.res.score + b.eng * 0.2 - (a.res.score + a.eng * 0.2))
    .slice(0, want);
  for (const s of scored) {
    await db.execute(
      `INSERT INTO he_match (lead_id, requisition_id, drive_id, score, reasons_json, distance_km, state, token)
       VALUES (?,?,?,?,?,?, 'suggested', ?)
       ON DUPLICATE KEY UPDATE drive_id = VALUES(drive_id), score = VALUES(score), reasons_json = VALUES(reasons_json), distance_km = VALUES(distance_km)`,
      [s.id, drive.requisition_id, driveId, s.res.score, JSON.stringify({ reasons: s.res.reasons, unknown: s.res.unknown }), s.res.distanceKm, randomBytes(16).toString("hex")]);
  }
  return scored.length;
}

/** Other open requisitions a declined lead fits (feeds the "other role" offer). Same branch ranked first by score. */
export async function alternativeRequisitions(leadId: string, excludeRequisitionId: string, limit = 3): Promise<Array<{ requisitionId: string; score: number; reasons: string[] }>> {
  const [lr] = await db.execute<RowDataPacket[]>("SELECT age, education_rank, experience_years, night_shift_ok, lat, lng FROM he_lead WHERE id = ? LIMIT 1", [leadId]);
  const l = lr[0];
  if (!l) return [];
  const [reqs] = await db.execute<ReqRow[]>(
    `SELECT jr.id, jr.branch_name, jr.process_name, jr.designation_name, jr.requested_headcount, jr.fulfilled_headcount, jr.approval_status, jr.active_status,
            jr.meta_target_age_min, jr.meta_target_age_max, jr.meta_target_radius_km, jr.education_requirement, jr.experience_min_years, jr.night_shift_required,
            bm.latitude AS blat, bm.longitude AS blng
       FROM job_requisition jr LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
      WHERE jr.approval_status = 'approved' AND jr.active_status = 1 AND jr.fulfilled_headcount < jr.requested_headcount AND jr.id <> ? LIMIT 200`, [excludeRequisitionId]);
  const ranked = rankRequisitions(
    { age: l.age, educationRank: l.education_rank, experienceYears: l.experience_years == null ? null : Number(l.experience_years), nightShiftOk: l.night_shift_ok == null ? null : Boolean(l.night_shift_ok), lat: l.lat == null ? null : Number(l.lat), lng: l.lng == null ? null : Number(l.lng) },
    reqs.map(toMatchRequisition), limit);
  return ranked.map((x) => ({ requisitionId: x.req.id, score: x.result.score, reasons: x.result.reasons }));
}

/**
 * Reserve the next free slot for a match. Locks the drive row so concurrent callers serialise; the slot is
 * held the moment it is returned (BRD: "immediately reserves that slot"). Returns null when the drive is full.
 * Only a REPLACEMENT slot logs `slot_offered`: he-ingest counts those to decide when a second decline goes to a
 * human, so the first invite slot must not count (it logs `slot_assigned`).
 */
export async function reserveSlot(matchId: string, isReplacement = false): Promise<string | null> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [m] = await conn.execute<RowDataPacket[]>("SELECT id, lead_id, drive_id FROM he_match WHERE id = ? FOR UPDATE", [matchId]);
    if (!m[0]?.drive_id) { await conn.rollback(); return null; }
    const [d] = await conn.execute<DriveRow[]>("SELECT * FROM he_drive WHERE id = ? FOR UPDATE", [m[0].drive_id]);
    const drive = d[0];
    if (!drive || drive.status === "closed") { await conn.rollback(); return null; }
    const [b] = await conn.execute<RowDataPacket[]>(
      "SELECT slot_at, COUNT(*) AS n FROM he_match WHERE drive_id = ? AND slot_at IS NOT NULL AND state IN ('invited','confirmed') AND id <> ? GROUP BY slot_at", [drive.id, matchId]);
    const booked: Record<string, number> = {};
    for (const r of b) booked[String(r.slot_at).slice(0, 19)] = Number(r.n);
    const slot = nextFreeSlot(slotCfg(drive), booked, nowIst());
    if (!slot) { await conn.rollback(); return null; }
    await conn.execute("UPDATE he_match SET slot_at = ? WHERE id = ?", [slot, matchId]);
    await conn.commit();
    await addEvent(m[0].lead_id as string, isReplacement ? "slot_offered" : "slot_assigned", { driveId: drive.id, detail: slot });
    return slot;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function releaseSlot(matchId: string): Promise<void> {
  await db.execute("UPDATE he_match SET slot_at = NULL WHERE id = ?", [matchId]);
}
