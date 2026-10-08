/**
 * One owner per person (spec 4.4): followup_person holds the one journey allowed in stage A for a mobile, the last first contact (the
 * 7-day re-contact hold across requisitions) and the re-invite count of the last 30 days. Stage A starts only after claimPerson; stage B
 * never claims (it answers a booking the person already has).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { normaliseMobile10 } from "./qualified-followup.schedule.js";

export interface PersonFacts { activeFollowupId: string | null; lastFirstContactAt: Date | null; reinvites30d: number; optedOutAt: Date | null }

// DATETIME columns are IST wall-clock strings (pool has dateStrings).
const ist = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v).replace(" ", "T") + "+05:30"));

export async function personFacts(mobile10: string): Promise<PersonFacts> {
  const m = normaliseMobile10(mobile10);
  if (!m) return { activeFollowupId: null, lastFirstContactAt: null, reinvites30d: 0, optedOutAt: null };
  const [r] = await db.execute<RowDataPacket[]>(
    "SELECT active_followup_id, last_first_contact_at, reinvites_30d, opted_out_at FROM followup_person WHERE mobile10 = ? LIMIT 1", [m]);
  const x = r[0];
  return {
    activeFollowupId: x?.active_followup_id ?? null, lastFirstContactAt: ist(x?.last_first_contact_at),
    reinvites30d: Number(x?.reinvites_30d ?? 0), optedOutAt: ist(x?.opted_out_at),
  };
}

/** True when this journey holds the person (newly or already). Race-safe: the IF keeps another holder. */
export async function claimPerson(mobile10: string, followupId: string): Promise<boolean> {
  const m = normaliseMobile10(mobile10);
  if (!m) return false;
  await db.execute(
    `INSERT INTO followup_person (mobile10, active_followup_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE active_followup_id = IF(active_followup_id IS NULL OR active_followup_id = VALUES(active_followup_id), VALUES(active_followup_id), active_followup_id)`,
    [m, followupId]);
  const [r] = await db.execute<RowDataPacket[]>("SELECT active_followup_id FROM followup_person WHERE mobile10 = ? LIMIT 1", [m]);
  return r[0]?.active_followup_id === followupId;
}

/** Only the holder releases (journey ended, declined, arrived, reinvite_wait, stage A over without a reply). */
export async function releasePerson(mobile10: string, followupId: string): Promise<void> {
  const m = normaliseMobile10(mobile10);
  if (!m) return;
  await db.execute("UPDATE followup_person SET active_followup_id = NULL WHERE mobile10 = ? AND active_followup_id = ?", [m, followupId]);
}

/** A first contact (stage A start): the re-contact hold starts; a re-invite counts within a 30-day window that restarts after it. */
export async function notePersonFirstContact(mobile10: string, at: Date, o: { reinvite: boolean }): Promise<void> {
  const m = normaliseMobile10(mobile10);
  if (!m) return;
  const r = o.reinvite ? 1 : 0;
  const stale = "(reinvite_window_start IS NULL OR reinvite_window_start < DATE_SUB(?, INTERVAL 30 DAY))";
  // ON DUPLICATE assignments run left to right: the counter reads the window before the window is moved.
  await db.execute(
    `INSERT INTO followup_person (mobile10, last_first_contact_at, reinvites_30d, reinvite_window_start) VALUES (?, ?, ?, IF(? = 1, ?, NULL))
     ON DUPLICATE KEY UPDATE last_first_contact_at = VALUES(last_first_contact_at),
       reinvites_30d = IF(? = 1, IF(${stale}, 1, reinvites_30d + 1), reinvites_30d),
       reinvite_window_start = IF(? = 1 AND ${stale}, ?, reinvite_window_start)`,
    [m, at, r, r, at, r, at, r, at, at]);
}
