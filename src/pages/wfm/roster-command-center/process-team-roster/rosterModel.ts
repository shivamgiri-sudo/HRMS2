/** Pure model/helpers for the Process Team Roster panel (no React) so they are unit-testable. */
import type { PillTone } from "@/components/wfm/console/StatusPill";

export type Status = "ON_TIME" | "LATE" | "ABSENT" | "ON_LEAVE" | "WEEK_OFF_HOLIDAY" | "UPCOMING";

export interface Member {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  branchName: string | null;
  lobId: string | null;
  lobName: string | null;
  status: Status;
  shiftName: string | null;
  shiftTime: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  minutesLate: number | null;
  leaveType: string | null;
}

export interface RosterView {
  processId: string;
  processName: string | null;
  date: string;
  members: Member[];
  counts: { onTime: number; late: number; absent: number; onLeave: number; weekOffHoliday: number; upcoming: number; total: number };
}

export const STATUS_ORDER: Status[] = ["ON_TIME", "LATE", "ABSENT", "ON_LEAVE", "WEEK_OFF_HOLIDAY", "UPCOMING"];

export const STATUS_LABEL: Record<Status, string> = {
  ON_TIME: "On Time", LATE: "Late", ABSENT: "Absent", ON_LEAVE: "On Leave", WEEK_OFF_HOLIDAY: "Week Off / Holiday", UPCOMING: "Upcoming",
};

export const STATUS_TONE: Record<Status, PillTone> = {
  ON_TIME: "green", LATE: "amber", ABSENT: "red", ON_LEAVE: "blue", WEEK_OFF_HOLIDAY: "neutral", UPCOMING: "violet",
};

/** Chart fills (CSS vars from index.css --chart-N are theme colours; status colours are semantic). */
export const STATUS_FILL: Record<Status, string> = {
  ON_TIME: "#047857", LATE: "#b45309", ABSENT: "#b91c1c", ON_LEAVE: "#1d4ed8", WEEK_OFF_HOLIDAY: "#64748b", UPCOMING: "#6d28d9",
};

/** Sort weight: attention-first (absent, late) so the top of the table is what needs action. */
export const STATUS_SEVERITY: Record<Status, number> = {
  ABSENT: 0, LATE: 1, UPCOMING: 2, ON_LEAVE: 3, WEEK_OFF_HOLIDAY: 4, ON_TIME: 5,
};

/** Recompute counts from a (possibly branch-filtered) member list — one source of truth for tiles. */
export function countMembers(members: Member[]): RosterView["counts"] {
  const c = { onTime: 0, late: 0, absent: 0, onLeave: 0, weekOffHoliday: 0, upcoming: 0, total: members.length };
  for (const m of members) {
    if (m.status === "ON_TIME") c.onTime++;
    else if (m.status === "LATE") c.late++;
    else if (m.status === "ABSENT") c.absent++;
    else if (m.status === "ON_LEAVE") c.onLeave++;
    else if (m.status === "WEEK_OFF_HOLIDAY") c.weekOffHoliday++;
    else c.upcoming++;
  }
  return c;
}

/**
 * Attendance rate over people who were expected AND due: present / (present + absent).
 * Week-off, leave and not-yet-due are excluded from the denominator. null when nobody is due.
 */
export function presentRate(c: RosterView["counts"]): number | null {
  const due = c.onTime + c.late + c.absent;
  if (due <= 0) return null;
  return Math.round(((c.onTime + c.late) / due) * 1000) / 10;
}

/** Punctuality over people who showed up: on time / (on time + late). */
export function punctualityRate(c: RosterView["counts"]): number | null {
  const present = c.onTime + c.late;
  if (present <= 0) return null;
  return Math.round((c.onTime / present) * 1000) / 10;
}

export function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

/** Percentage-point delta between two nullable rates, 1dp; undefined when either is unknown. */
export function deltaPoints(cur: number | null, prev: number | null): number | undefined {
  if (cur === null || prev === null) return undefined;
  return Math.round((cur - prev) * 10) / 10;
}

export type SortKey = "name" | "status" | "shift" | "clockIn" | "clockOut" | "branch" | "lob";
export type SortDir = "asc" | "desc";

const cmpStr = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base", numeric: true });
/** Nulls always sort last regardless of direction. */
const nullsLast = (a: string | null, b: string | null, dir: SortDir, cmp: (x: string, y: string) => number) => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir === "asc" ? cmp(a, b) : -cmp(a, b);
};

export function sortMembers(list: Member[], key: SortKey, dir: SortDir): Member[] {
  const out = [...list];
  const byName = (a: Member, b: Member) => cmpStr(a.employeeName, b.employeeName);
  out.sort((a, b) => {
    let r = 0;
    switch (key) {
      case "name": r = dir === "asc" ? byName(a, b) : -byName(a, b); break;
      case "status": r = (STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status]) * (dir === "asc" ? 1 : -1); break;
      case "shift": r = nullsLast(a.shiftName, b.shiftName, dir, cmpStr as never); break;
      case "clockIn": r = nullsLast(a.clockInTime, b.clockInTime, dir, (x, y) => x.localeCompare(y)); break;
      case "clockOut": r = nullsLast(a.clockOutTime, b.clockOutTime, dir, (x, y) => x.localeCompare(y)); break;
      case "branch": r = nullsLast(a.branchName, b.branchName, dir, cmpStr as never); break;
      case "lob": r = nullsLast(a.lobName, b.lobName, dir, cmpStr as never); break;
    }
    return r !== 0 ? r : byName(a, b);
  });
  return out;
}

export type AlertSeverity = "critical" | "warning" | "info";
export interface RosterAlert { key: string; severity: AlertSeverity; text: string; status: Status; count: number }

/** Insight strip: ordered by severity then count. Rates use the due-only denominator. */
export function buildAlerts(c: RosterView["counts"]): RosterAlert[] {
  const out: RosterAlert[] = [];
  const due = c.onTime + c.late + c.absent;
  if (c.absent > 0) {
    const pct = due > 0 ? Math.round((c.absent / due) * 100) : 0;
    out.push({ key: "absent", severity: pct >= 20 ? "critical" : "warning", status: "ABSENT", count: c.absent, text: `${c.absent} absent with no clock-in (${pct}% of those due)` });
  }
  if (c.late > 0) {
    const pct = c.onTime + c.late > 0 ? Math.round((c.late / (c.onTime + c.late)) * 100) : 0;
    out.push({ key: "late", severity: pct >= 30 ? "warning" : "info", status: "LATE", count: c.late, text: `${c.late} clocked in late (${pct}% of those present)` });
  }
  if (c.upcoming > 0) out.push({ key: "upcoming", severity: "info", status: "UPCOMING", count: c.upcoming, text: `${c.upcoming} shift${c.upcoming === 1 ? "" : "s"} not yet due` });
  const w = { critical: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => w[a.severity] - w[b.severity] || STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status]);
}

export interface Breakdown { name: string; ON_TIME: number; LATE: number; ABSENT: number; ON_LEAVE: number; WEEK_OFF_HOLIDAY: number; UPCOMING: number; total: number }

export function breakdownBy(members: Member[], pick: (m: Member) => string | null, fallback: string, limit = 8): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const m of members) {
    const name = pick(m) || fallback;
    let b = map.get(name);
    if (!b) { b = { name, ON_TIME: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, WEEK_OFF_HOLIDAY: 0, UPCOMING: 0, total: 0 }; map.set(name, b); }
    b[m.status]++;
    b.total++;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, limit);
}

// ── Formatting (Indian DD/MM/YYYY) ────────────────────────────────────────────
export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fmtDate(v);
}

export function hhmm(v: string | null | undefined): string {
  return v ? v.slice(0, 5) : "—";
}

export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function prevDayISO(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return todayISO(d);
}
