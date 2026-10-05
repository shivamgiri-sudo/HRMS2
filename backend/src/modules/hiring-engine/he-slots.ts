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
export function inviteTarget(o: { openPositions: number; showRatePct: number; interviewToHirePct?: number; capacity: number }): { targetShows: number; invites: number } {
  const hire = (o.interviewToHirePct ?? 35) / 100;
  const show = Math.max(5, Math.min(100, o.showRatePct)) / 100;
  const targetShows = Math.ceil(o.openPositions / Math.max(0.05, hire));
  const cappedShows = Math.min(targetShows, o.capacity);
  return { targetShows: cappedShows, invites: Math.ceil(cappedShows / show) };
}
