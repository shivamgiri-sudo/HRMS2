/**
 * One slot chooser for Meta rolling slots and engine drive slots (HE_SMART_SLOTS). Pure: spreads load across the
 * day, leans toward the candidate's best hour, and gives far-away candidates a later slot. All times are IST
 * wall-clock strings, so the host timezone never matters.
 */
import { istAddMinutes } from "./he-slots.js";

export interface SlotPrefs { bestHourIst: number | null; etaMin: number | null; distanceKm: number | null }

export const FAR_ETA_MIN = 60;
export const SPREAD_TOLERANCE = 1;
const DEFAULT_BAND_KM = 15;

export function isFar(p: SlotPrefs, bandKm: number = DEFAULT_BAND_KM): boolean {
  return p.etaMin != null ? p.etaMin >= FAR_ETA_MIN : p.distanceKm != null && p.distanceKm > bandKm;
}

const hourOf = (slot: string): number => Number(slot.slice(11, 13));

export function chooseSlot(o: { slots: string[]; capacity: number; booked: Record<string, number>; nowIst: string; leadMinutes: number; prefs: SlotPrefs; bandKm?: number }): string | null {
  const earliest = istAddMinutes(o.nowIst, o.leadMinutes);
  const count = (s: string) => o.booked[s] ?? 0;
  const eligible = o.slots.filter((s) => s >= earliest && count(s) < o.capacity);
  if (!eligible.length) return null;
  const min = Math.min(...eligible.map(count));
  let pool = eligible.filter((s) => count(s) <= min + SPREAD_TOLERANCE);
  const far = isFar(o.prefs, o.bandKm);
  if (far) {
    const half = Math.floor(o.slots.length / 2);
    const later = pool.filter((s) => o.slots.indexOf(s) >= half);
    if (later.length) pool = later;
  }
  const best = o.prefs.bestHourIst;
  pool.sort((a, b) =>
    (best == null ? 0 : Math.abs(hourOf(a) - best) - Math.abs(hourOf(b) - best))
    || count(a) - count(b)
    || (far ? (a < b ? 1 : -1) : (a < b ? -1 : 1)));
  return pool[0];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * First working day (Mon-Sat, from IST tomorrow, up to maxDays ahead) with a free 30-minute slot between 10:00 and 17:30.
 * `booked` holds "YYYY-MM-DD|HH:MM" keys (the Meta service's shape); "YYYY-MM-DD HH:MM:SS" is accepted too.
 */
export function metaDay(nowIst: string, booked: Set<string>, maxDays = 60): { date: string; slots: string[] } | null {
  const [y, mo, d] = nowIst.slice(0, 10).split("-").map(Number);
  for (let i = 1; i <= maxDays; i++) {
    const day = new Date(Date.UTC(y, mo - 1, d + i));
    if (day.getUTCDay() === 0) continue;
    const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
    const slots: string[] = [];
    for (let m = 600; m < 1080; m += 30) slots.push(`${date} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`);
    if (slots.some((s) => !booked.has(`${date}|${s.slice(11, 16)}`) && !booked.has(s))) return { date, slots };
  }
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Same label formats as the Meta service has always printed ("Wed, 14 Oct 2026", "10:30 AM"). */
export function slotLabels(date: string, time: string): { dateLabel: string; timeLabel: string } {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { dateLabel: `${wd}, ${pad(d)} ${MONTHS[m - 1]} ${y}`, timeLabel: `${pad(h12)}:${pad(min)} ${h < 12 ? "AM" : "PM"}` };
}
