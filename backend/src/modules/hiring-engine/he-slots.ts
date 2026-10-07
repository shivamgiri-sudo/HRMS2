/**
 * Slot calendar for walk-in drives. All times are IST wall-clock strings ("YYYY-MM-DD HH:MM:SS") so the
 * logic is independent of the server timezone (the old Meta slot service assumed a UTC server).
 */
export interface SlotConfig {
  date: string; // YYYY-MM-DD
  start: string; // HH:MM[:SS]
  end: string; // HH:MM[:SS] exclusive
  minutes: number;
  capacity: number; // candidates per slot
}

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

export function generateSlots(c: SlotConfig): string[] {
  const out: string[] = [];
  for (let m = toMin(c.start); m < toMin(c.end); m += c.minutes) out.push(`${c.date} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`);
  return out;
}

export function driveCapacity(c: SlotConfig): number {
  return generateSlots(c).length * c.capacity;
}

/** Earliest slot with room that is still at least `leadMinutes` away from `nowIst`. */
export function nextFreeSlot(c: SlotConfig, booked: Record<string, number>, nowIst: string, leadMinutes = 60): string | null {
  const earliest = istAddMinutes(nowIst, leadMinutes);
  for (const s of generateSlots(c)) {
    if (s < earliest) continue;
    if ((booked[s] ?? 0) < c.capacity) return s;
  }
  return null;
}

/** Add minutes to an IST wall-clock string without touching the host timezone. */
export function istAddMinutes(ist: string, minutes: number): string {
  const d = new Date(ist.replace(" ", "T") + "Z"); // treat the wall-clock as UTC purely for arithmetic
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Current IST wall-clock as a string, independent of server TZ. */
export function nowIst(now: Date = new Date()): string {
  return istAddMinutes(now.toISOString().slice(0, 19).replace("T", " "), 330);
}

/**
 * How many leads to invite so the drive is expected to meet demand:
 * open positions x candidates-per-hire (selection ratio) / show rate, capped by the drive's real capacity.
 */
/** The owner states the walk-ins wanted for the day; invites follow from the show-up rate, never beyond the seats the drive has. */
export function invitesForTarget(o: { targetShows: number; showRatePct: number; capacity: number }): { targetShows: number; invites: number } {
  const show = Math.max(5, Math.min(100, o.showRatePct)) / 100;
  const wanted = Math.max(1, Math.round(o.targetShows));
  return { targetShows: wanted, invites: Math.min(o.capacity, Math.ceil(wanted / show)) };
}

export function inviteTarget(o: { openPositions: number; showRatePct: number; interviewToHirePct?: number; capacity: number }): { targetShows: number; invites: number } {
  const hire = (o.interviewToHirePct ?? 35) / 100;
  const show = Math.max(5, Math.min(100, o.showRatePct)) / 100;
  const targetShows = Math.ceil(o.openPositions / Math.max(0.05, hire));
  const cappedShows = Math.min(targetShows, o.capacity);
  return { targetShows: cappedShows, invites: Math.ceil(cappedShows / show) };
}

/**
 * Spread `count` candidates over a day's slots so nobody is told the same time as sixty others. Evenly spread when the
 * day has room (never more than `perSlot` in a slot); when it does not, the first `capacity` get a seat and the rest
 * are reported as overflow so the caller can say so instead of over-booking the branch.
 */
export function assignSlots(count: number, c: { start: string; end: string; minutes: number; perSlot: number }): { times: string[]; capacity: number; overflow: number } {
  const slots = generateSlots({ date: "x", start: c.start, end: c.end, minutes: c.minutes, capacity: c.perSlot }).map((s) => s.slice(2)); // " HH:MM:00"
  const times = slots.map((s) => s.trim());
  const capacity = times.length * c.perSlot;
  if (count <= 0 || times.length === 0) return { times: [], capacity, overflow: Math.max(0, count) };
  const seats = Math.min(count, capacity);
  const out: string[] = [];
  if (seats >= capacity) for (const t of times) for (let k = 0; k < c.perSlot; k++) out.push(t);
  else for (let i = 0; i < seats; i++) out.push(times[Math.min(times.length - 1, Math.floor((i * times.length) / seats))]);
  return { times: out, capacity, overflow: count - seats };
}

export interface DailyPlan { walkInsPerDay: number; minOutreachPerDay: number; showRatePct: number; slotStart: string; slotEnd: string; slotMinutes: number }
export const DEFAULT_DAILY_PLAN: DailyPlan = { walkInsPerDay: 100, minOutreachPerDay: 400, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 };

/**
 * What one day's drive needs for the owner's numbers: people messaged = whichever is larger of (walk-ins wanted / show rate) and the
 * minimum outreach per day; seats per slot are spread so every one of them has a slot.
 */
export function dailyPlanNumbers(p: DailyPlan): { invites: number; targetShows: number; slots: number; perSlot: number; capacity: number } {
  const show = Math.max(5, Math.min(100, p.showRatePct)) / 100;
  const invites = Math.max(Math.ceil(Math.max(1, p.walkInsPerDay) / show), Math.max(0, Math.floor(p.minOutreachPerDay)));
  const slots = Math.max(1, generateSlots({ date: "x", start: p.slotStart, end: p.slotEnd, minutes: p.slotMinutes, capacity: 1 }).length);
  const perSlot = Math.min(50, Math.max(1, Math.ceil(invites / slots)));
  return { invites, targetShows: Math.max(1, Math.round(invites * show)), slots, perSlot, capacity: slots * perSlot };
}
