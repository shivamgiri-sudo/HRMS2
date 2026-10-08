/**
 * Every enrolled journey is booked on a drive (D2): a wrapper that maps a follow-up row onto the shared booking core
 * (walkin-booking.service.ts bookLeadOnDrive / createDriveIfAbsent, which pick the drive and slot and never modify an HR drive),
 * writes the booking back on the row and mirrors the slot onto meta_lead_raw for the Meta screens. Sends nothing.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requisitionOpenReason } from "./followup-guards.js";
import { loadRequisitionFacts } from "./followup-guards.service.js";
import { ensureHeLead, type FollowupRow } from "./qualified-followup.context.js";
import { bookLeadOnDrive, targetDriveDates } from "./walkin-booking.service.js";
import { nowIst } from "./he-slots.js";

export { createDriveIfAbsent, targetDriveDates } from "./walkin-booking.service.js";

export type BookingResult =
  | { status: "booked"; matchId: string; driveId: string; slotAt: string /* 'YYYY-MM-DD HH:MM:SS' IST */ }
  | { status: "would_book"; driveDate: string }
  | { status: "slotless"; reason: "no_branch_address" | "no_capacity" | "requisition_closed" | "no_lead" | "drive_closed" };

const C = "COLLATE utf8mb4_unicode_ci";

/** Book the journey (simulate: reads only, for dry_run and test rows other than the owner's test phone). */
export async function bookJourney(row: FollowupRow, o: { now: Date; simulate: boolean }): Promise<BookingResult> {
  if (requisitionOpenReason(await loadRequisitionFacts(row.requisitionId))) return { status: "slotless", reason: "requisition_closed" };
  const branch = row.branchName?.trim() ?? "";
  if (!branch) return { status: "slotless", reason: "no_branch_address" };
  const [b] = await db.execute<RowDataPacket[]>("SELECT address FROM branch_master WHERE branch_name = ? AND active_status = 1 LIMIT 1", [branch]);
  if (!String(b[0]?.address ?? "").trim()) return { status: "slotless", reason: "no_branch_address" };

  // A line-up row prefers its drive's day (the stream day for Old Meta / HE).
  let preferred: string | null = null;
  if (row.driveId) {
    const [d] = await db.execute<RowDataPacket[]>("SELECT drive_date FROM he_drive WHERE id = ? LIMIT 1", [row.driveId]);
    if (d[0]?.drive_date) preferred = `${String(d[0].drive_date).slice(0, 10)} 00:00:00`;
  }

  let leadId = row.heLeadId;
  if (o.simulate) {
    if (!leadId) {
      const [l] = await db.execute<RowDataPacket[]>(`SELECT id FROM he_lead WHERE mobile10 = ? ${C} LIMIT 1`, [row.mobile10]);
      leadId = l[0]?.id ? String(l[0].id) : null;
    }
  } else leadId = await ensureHeLead(row);
  if (!leadId && !o.simulate) return { status: "slotless", reason: "no_lead" };

  // A booking the person already holds (invited / confirmed, slot still ahead) is kept: the core would move it to a new day.
  if (leadId) {
    const [m] = await db.execute<RowDataPacket[]>("SELECT id, state, drive_id, slot_at FROM he_match WHERE lead_id = ? AND requisition_id = ? LIMIT 1", [leadId, row.requisitionId]);
    const x = m[0];
    if (x && (x.state === "invited" || x.state === "confirmed") && x.slot_at && x.drive_id && String(x.slot_at).slice(0, 19) > nowIst(o.now)) {
      const kept = { status: "booked" as const, matchId: String(x.id), driveId: String(x.drive_id), slotAt: String(x.slot_at).slice(0, 19) };
      if (!o.simulate) await writeBack(row, kept);
      return kept;
    }
  }
  if (o.simulate) return { status: "would_book", driveDate: targetDriveDates(o.now, preferred)[0] };

  const r = await bookLeadOnDrive({ leadId: leadId as string, requisitionId: row.requisitionId, branchName: branch, preferredSlotAt: preferred, now: o.now, state: "invited" });
  if (r.status === "unavailable") return { status: "slotless", reason: r.reason === "no_branch" ? "no_branch_address" : r.reason };
  const booked = { status: "booked" as const, matchId: r.matchId, driveId: r.driveId, slotAt: r.slotAt };
  await writeBack(row, booked);
  return booked;
}

async function writeBack(row: FollowupRow, b: { matchId: string; driveId: string; slotAt: string }): Promise<void> {
  await db.execute("UPDATE qualified_followup SET match_id = ?, drive_id = ? WHERE id = ?", [b.matchId, b.driveId, row.id]);
  if (row.metaLeadId) await mirrorSlotToMeta(row.metaLeadId, b.slotAt);
}

/** A line-up match (suggested) becomes invited once the first message of its journey went out. */
export async function markInvitedAfterSend(matchId: string): Promise<void> {
  await db.execute("UPDATE he_match SET state = 'invited' WHERE id = ? AND state = 'suggested'", [matchId]);
}

/** The Meta screens read interview_date / interview_time; the booking is the truth, this is its mirror. */
export async function mirrorSlotToMeta(metaLeadId: string, slotAt: string): Promise<void> {
  await db.execute("UPDATE meta_lead_raw SET interview_date = ?, interview_time = ? WHERE id = ?", [slotAt.slice(0, 10), slotAt.slice(11, 19), metaLeadId]);
}
