/**
 * Pure calculation rules for the Reginald Abandoned Cart dashboard.
 *
 * Every formula the dashboard shows lives here so it can be unit-tested
 * without a dialler connection, and so the Overview, CDR, Monthly, Day-wise
 * and TPR views all use one definition.
 *
 *   Connect %      = Unique Connect / Unique Dialed x 100 (unique = distinct phone)
 *   Daily target   = 13,500 per analyst per eligible present day; 0 otherwise
 *   Period target  = 13,500 x eligible present days
 *   Gap            = Actual - Target (negative = shortfall)
 *   Achievement %  = Actual / Target x 100; null (shown "N/A") when target is 0
 *   MoM change %   = (Current - Previous) / Previous x 100; null when previous is 0
 *   Utilization    = (Talk + Wait) / Net Login x 100, Net Login = Talk + Wrap + Wait + Pause
 *                    (the dashboard's existing APR definition)
 */

import { PRESENT_STATUSES, HALF_DAY_STATUS } from '../../shared/attendanceStatus.js';

export const DAILY_ANALYST_TARGET = 13500;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Unique Connect / Unique Dialed x 100. 0 when nothing was dialled. */
export function connectPct(uniqueConnected: number, uniqueDialed: number): number {
  if (!(uniqueDialed > 0)) return 0;
  return round2((uniqueConnected / uniqueDialed) * 100);
}

/**
 * How much of a working day an attendance status counts for. Uses HRMS's own
 * attendance vocabulary: present and week-off-worked are a full day, a half day
 * is half (as in the HRMS attendance numerator); absent, leave, holiday, week
 * off, missing punch, unreconciled and "no record" earn no target.
 */
export function eligibleDayFraction(status: string | null | undefined): number {
  const s = String(status ?? '').trim().toLowerCase();
  if ((PRESENT_STATUSES as readonly string[]).includes(s)) return 1;
  if (s === HALF_DAY_STATUS) return 0.5;
  return 0;
}

/** Daily target for one analyst-date. */
export function dailyTarget(status: string | null | undefined, perDay = DAILY_ANALYST_TARGET): number {
  return round2(eligibleDayFraction(status) * perDay);
}

/** Period target = per-day target x eligible present days. */
export function periodTarget(eligibleDays: number, perDay = DAILY_ANALYST_TARGET): number {
  return round2(Math.max(0, eligibleDays) * perDay);
}

export function gap(actual: number, target: number): number {
  return round2(actual - target);
}

/** Actual / Target x 100, or null when there is no target (shown as N/A). */
export function achievementPct(actual: number, target: number): number | null {
  if (!(target > 0)) return null;
  return round2((actual / target) * 100);
}

/** (Current - Previous) / Previous x 100, or null when there is no previous base. */
export function momPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !(previous > 0)) return null;
  return round2(((current - previous) / previous) * 100);
}

/** Sum / count as a weighted average (never an average of averages). */
export function weightedAvg(sum: number, count: number): number {
  return count > 0 ? Math.round(sum / count) : 0;
}

export function utilizationPct(talkSec: number, waitSec: number, netLoginSec: number): number {
  if (!(netLoginSec > 0)) return 0;
  return round2(((talkSec + waitSec) / netLoginSec) * 100);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? m}-${String(y).slice(2)}`;
}

/**
 * Every calendar month touching from..to, clipped to the range and never past
 * `today` — a future month is not fabricated, but a past month with no data is
 * still listed (and shows zero) rather than disappearing.
 */
export function monthSlicesUntil(from: string, to: string, today: string): { month: string; from: string; to: string }[] {
  const end = to > today ? today : to;
  if (from > end) return [];
  const out: { month: string; from: string; to: string }[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  for (let guard = 0; guard < 240; guard++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym > end.slice(0, 7)) break;
    const last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    out.push({ month: ym, from: `${ym}-01` < from ? from : `${ym}-01`, to: last > end ? end : last });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Inclusive list of YYYY-MM-DD dates. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let i = 0; d <= end && i < 1000; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** A dialler DATE/DATETIME cell as YYYY-MM-DD (mysql2 hands back local-time Dates). */
export function ymd(v: unknown): string {
  if (v instanceof Date) {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v ?? '').slice(0, 10);
}
