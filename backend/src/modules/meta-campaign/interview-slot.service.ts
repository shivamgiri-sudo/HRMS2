/**
 * Interview slot auto-assignment for META campaign qualified leads.
 *
 * Mirrors the Google Apps Script TAB_SETTINGS slot logic exactly:
 *   - Slots: 10:00 to 18:00, 30-minute intervals, Mon–Sat (no Sunday)
 *   - Start: tomorrow minimum (DAYS_AHEAD = 1)
 *   - Per-branch calendar: NOIDA and NOIDA-2 don't share slots
 *   - Collision-safe: reads already-assigned slots before allocating a new one
 *
 * Returns a date label ("Wed, 24 Sep 2026") and time label ("10:30 AM") in
 * IST. The date/time is stored in meta_lead_raw and included in the
 * shortlist email and WhatsApp message.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export interface InterviewSlot {
  date: string;       // YYYY-MM-DD for DB storage
  time: string;       // HH:MM:00 for DB storage
  dateLabel: string;  // "Wed, 24 Sep 2026"
  timeLabel: string;  // "10:30 AM"
}

const SLOT_START_HOUR = 10;
const SLOT_START_MIN  = 0;
const SLOT_END_HOUR   = 18;   // up to but not including 18:00
const SLOT_DURATION   = 30;   // minutes
const DAYS_AHEAD      = 1;    // start from tomorrow

/** Days 1–6 = Mon–Sat (0 = Sunday, excluded) */
function isWorkingDay(date: Date): boolean {
  return date.getDay() !== 0;
}

function addMinutes(date: Date, mins: number): Date {
  return new Date(date.getTime() + mins * 60_000);
}

function toIST(date: Date): Date {
  // Convert UTC to IST (+5:30)
  return new Date(date.getTime() + (5.5 * 3600 * 1000));
}

function formatDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const wd = days[date.getDay()];
  return `${wd}, ${d} ${m} ${y}`;
}

function formatTime(h: number, m: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function toDbDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDbTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Fetch already-booked slots for a given branch (by branch_name via requisition).
 * Returns a Set of "YYYY-MM-DD|HH:MM" keys.
 */
async function getBookedSlots(branchName: string): Promise<Set<string>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ml.interview_date, ml.interview_time
       FROM meta_lead_raw ml
       LEFT JOIN job_requisition jr ON jr.id = ml.requisition_id
      WHERE jr.branch_name = ?
        AND ml.interview_date IS NOT NULL
        AND ml.interview_time IS NOT NULL`,
    [branchName]
  );
  const booked = new Set<string>();
  for (const r of rows) {
    const d = r.interview_date instanceof Date
      ? toDbDate(r.interview_date)
      : String(r.interview_date).substring(0, 10);
    const t = typeof r.interview_time === 'string'
      ? r.interview_time.substring(0, 5)
      : String(r.interview_time).substring(0, 5);
    booked.add(`${d}|${t}`);
  }
  return booked;
}

/**
 * Assign the next available interview slot for the given branch.
 * Writes the slot back to meta_lead_raw immediately so concurrent calls
 * for the same branch cannot be offered the same slot.
 */
export async function assignInterviewSlot(
  leadId: string,
  branchName: string
): Promise<InterviewSlot> {
  const booked = await getBookedSlots(branchName);

  // Start from tomorrow IST
  const nowUtc = new Date();
  const nowIst = toIST(nowUtc);
  const start = new Date(nowIst);
  start.setDate(start.getDate() + DAYS_AHEAD);
  start.setHours(SLOT_START_HOUR, SLOT_START_MIN, 0, 0);

  // Skip to a working day
  while (!isWorkingDay(start)) {
    start.setDate(start.getDate() + 1);
  }

  // Walk forward until we find a free slot
  let cursor = new Date(start);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const h = cursor.getHours();
    const m = cursor.getMinutes();

    // Past end of day — advance to next working day
    if (h > SLOT_END_HOUR || (h === SLOT_END_HOUR && m >= 0)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(SLOT_START_HOUR, SLOT_START_MIN, 0, 0);
      while (!isWorkingDay(cursor)) {
        cursor.setDate(cursor.getDate() + 1);
      }
      continue;
    }

    const dateKey = toDbDate(cursor);
    const timeKey = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const slotKey = `${dateKey}|${timeKey}`;

    if (!booked.has(slotKey)) {
      // Reserve immediately to prevent concurrent double-booking
      booked.add(slotKey);

      const slot: InterviewSlot = {
        date: dateKey,
        time: toDbTime(h, m),
        dateLabel: formatDate(cursor),
        timeLabel: formatTime(h, m),
      };

      // Write back to DB (best-effort — failure must not block the outreach)
      await db.execute(
        `UPDATE meta_lead_raw
            SET interview_date = ?, interview_time = ?, interview_slot_assigned_at = NOW()
          WHERE id = ?`,
        [slot.date, slot.time, leadId]
      ).catch((e: unknown) =>
        console.warn('[meta] assignInterviewSlot write failed', e instanceof Error ? e.message : e)
      );

      return slot;
    }

    // Slot taken — try next 30-min interval
    cursor = addMinutes(cursor, SLOT_DURATION);
  }
}
