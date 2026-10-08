/**
 * Pure calculation helpers for the Roster Command Center "Trends & Publish" panel.
 * No DB, no Express: every rule that decides a number lives here so it can be unit-tested.
 */

export interface AttendanceCounts {
  /** Roster rows that are not a week-off / holiday (working + on-leave). Denominator of every % below. */
  scheduled: number;
  present: number;
  absent: number;
  onLeave: number;
  late: number;
}

export interface AttendanceRates {
  /** (absent + onLeave) / scheduled */
  shrinkagePct: number;
  /** absent / scheduled — no-shows with no approved leave */
  unplannedPct: number;
  /** onLeave / scheduled — approved leave */
  plannedPct: number;
  /** present / scheduled */
  attendancePct: number;
  /** late / present */
  lateRatePct: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Safe percentage: 0 when the denominator is 0/NaN, rounded to 1 dp. Never NaN/Infinity. */
export function safePct(numerator: number, denominator: number): number {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
  return round1((n / d) * 100);
}

export function deriveRates(c: AttendanceCounts): AttendanceRates {
  return {
    shrinkagePct: safePct(c.absent + c.onLeave, c.scheduled),
    unplannedPct: safePct(c.absent, c.scheduled),
    plannedPct: safePct(c.onLeave, c.scheduled),
    attendancePct: safePct(c.present, c.scheduled),
    lateRatePct: safePct(c.late, c.present),
  };
}

export function toCounts(row: Record<string, unknown>): AttendanceCounts {
  const n = (k: string) => {
    const v = Number(row[k] ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  return { scheduled: n("scheduled"), present: n("present"), absent: n("absent"), onLeave: n("on_leave"), late: n("late_count") };
}

export function sumCounts(rows: AttendanceCounts[]): AttendanceCounts {
  return rows.reduce<AttendanceCounts>(
    (a, r) => ({
      scheduled: a.scheduled + r.scheduled,
      present: a.present + r.present,
      absent: a.absent + r.absent,
      onLeave: a.onLeave + r.onLeave,
      late: a.late + r.late,
    }),
    { scheduled: 0, present: 0, absent: 0, onLeave: 0, late: 0 },
  );
}

/* ── Dates (pure string arithmetic, no timezone drift) ─────────────────────── */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive number of days between two YYYY-MM-DD strings. */
export function daySpan(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

/** Monday of the week containing `date` (roster weeks are Mon-Sun). */
export function weekStartMonday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon=0
  return addDays(date, -dow);
}

/** The window of identical length that ends the day before `from` — for "vs previous period" deltas. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const span = daySpan(from, to);
  return { from: addDays(from, -span), to: addDays(from, -1) };
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daySpan(from, to);
  for (let i = 0; i < n && i < 400; i++) out.push(addDays(from, i));
  return out;
}

/** Clamp a range so it never ends after `today` (future roster days are not yet attendance facts). */
export function clampToToday(from: string, to: string, today: string): { from: string; to: string; empty: boolean } {
  const effTo = to > today ? today : to;
  return { from, to: effTo, empty: from > effTo };
}

/* ── Roster publish lifecycle ──────────────────────────────────────────────── */

export const PUBLISH_STAGES = [
  "generated",
  "pending_employee_ack",
  "acknowledged",
  "rejected_by_employee",
  "pending_manager_action",
  "realigned_by_manager",
  "force_approved_by_manager",
  "escalated_to_hr",
  "approved_final",
  "published_to_rta",
  "manager_rejected_employee_request",
] as const;

export type PublishStage = (typeof PUBLISH_STAGES)[number];

export function isPublishStage(s: string): s is PublishStage {
  return (PUBLISH_STAGES as readonly string[]).includes(s);
}

const ACK_TERMINAL: readonly string[] = ["acknowledged", "approved_final", "published_to_rta", "force_approved_by_manager", "realigned_by_manager"];
const ACK_DISPUTED: readonly string[] = ["rejected_by_employee", "pending_manager_action", "escalated_to_hr", "manager_rejected_employee_request"];

export type AckGroup = "not_published" | "awaiting_ack" | "acknowledged" | "disputed";

/**
 * Same mapping wfm.routes.ts uses for /my-roster (mapAckStatus): the platform derives the
 * acknowledgement state from final_roster_status, not from employee_ack_status alone (which
 * defaults to 'pending' on every unpublished row and so over-counts "pending").
 */
export function ackGroupOf(stage: string): AckGroup {
  if (ACK_TERMINAL.includes(stage)) return "acknowledged";
  if (ACK_DISPUTED.includes(stage)) return "disputed";
  if (stage === "pending_employee_ack") return "awaiting_ack";
  return "not_published";
}

export interface StageCount { week: string; status: string; count: number }

export interface PublishFunnel {
  total: number;
  published: number;
  unpublished: number;
  awaitingAck: number;
  acknowledged: number;
  disputed: number;
  publishedPct: number;
  /** Share of PUBLISHED assignments that reached an acknowledged/resolved state. */
  ackPctOfPublished: number;
  disputedPctOfPublished: number;
}

export function buildFunnel(rows: Array<{ status: string; count: number }>): PublishFunnel {
  let total = 0, unpublished = 0, awaitingAck = 0, acknowledged = 0, disputed = 0;
  for (const r of rows) {
    const c = Number(r.count) || 0;
    total += c;
    switch (ackGroupOf(r.status)) {
      case "not_published": unpublished += c; break;
      case "awaiting_ack": awaitingAck += c; break;
      case "acknowledged": acknowledged += c; break;
      case "disputed": disputed += c; break;
    }
  }
  const published = total - unpublished;
  return {
    total, published, unpublished, awaitingAck, acknowledged, disputed,
    publishedPct: safePct(published, total),
    ackPctOfPublished: safePct(acknowledged, published),
    disputedPctOfPublished: safePct(disputed, published),
  };
}

export interface WeekPublishRow extends PublishFunnel { week: string }

/** Group (week,status,count) rows into one funnel per Monday-start week, oldest first. */
export function funnelByWeek(rows: StageCount[]): WeekPublishRow[] {
  const byWeek = new Map<string, StageCount[]>();
  for (const r of rows) {
    const list = byWeek.get(r.week) ?? [];
    list.push(r);
    byWeek.set(r.week, list);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, list]) => ({ week, ...buildFunnel(list) }));
}

export function stageTotals(rows: StageCount[]): Array<{ status: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + (Number(r.count) || 0));
  return [...m.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
}

/* ── Day status for a rostered day ─────────────────────────────────────────── */

export interface DayStatusInput {
  date: string;
  today: string;
  assignmentType: string | null;
  isWeekOff?: boolean;
  clockIn: string | null;
  lateMark: number | null;
  attendanceStatus?: string | null;
  /** HH:mm shift start; used so a shift that has not started yet today is not called Absent. */
  shiftStart?: string | null;
  nowMinutes?: number;
}

export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function dayStatus(i: DayStatusInput): string {
  const type = String(i.assignmentType ?? "REGULAR").toUpperCase();
  if (type === "WEEK_OFF" || i.isWeekOff) return "Week Off";
  if (type === "HOLIDAY") return "Holiday";
  if (type === "LEAVE") return "On Leave";
  if (i.date > i.today) return "Upcoming";
  if (!i.clockIn) {
    if (i.attendanceStatus === "leave_approved") return "On Leave";
    if (i.date === i.today) {
      const start = timeToMinutes(i.shiftStart);
      if (start !== null && i.nowMinutes !== undefined && i.nowMinutes < start) return "Upcoming";
    }
    return "Absent";
  }
  return Number(i.lateMark) === 1 ? "Late" : "On Time";
}

/* ── Lateness ──────────────────────────────────────────────────────────────── */

export const HABITUAL_LATE_THRESHOLD = 3;

export function isHabitual(count: number, threshold = HABITUAL_LATE_THRESHOLD): boolean {
  return count >= threshold;
}

/** Attrition % per the aon-bucket-attrition report's own stated denominator: exits / (headcount + exits). */
export function attritionPct(exits: number, activeHeadcount: number): number | null {
  const denom = Number(activeHeadcount) + Number(exits);
  if (!Number.isFinite(denom) || denom <= 0) return null;
  return round1((Number(exits) / denom) * 100);
}

/** Percentage-point delta between two values; null if either is unknown. */
export function deltaPts(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null) return null;
  return round1(current - previous);
}
