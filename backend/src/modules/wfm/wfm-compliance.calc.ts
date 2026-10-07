/**
 * Pure roster-rule compliance calculations for the Roster Command Center "Compliance" tab.
 *
 * One incident model feeds summary, violations feed, trend and drill-downs, so the four can
 * never disagree (before: summary counted employees per rule, the feed listed attendance
 * exceptions, the trend counted absent shifts — three different units under one heading).
 *
 * No I/O here: everything takes plain rows so it is unit-testable.
 */

export type RuleId =
  | "MIN_REST"
  | "CONSECUTIVE_DAYS"
  | "WEEKOFF_FAIRNESS"
  | "MAX_HOURS"
  | "NIGHT_SHIFT_LIMIT";
export type Severity = "high" | "medium" | "low";

export const MIN_REST_HOURS = 11;
export const MAX_CONSECUTIVE_WORK_DAYS = 6;
export const MAX_WEEK_HOURS = 48;
export const MAX_CONSECUTIVE_NIGHTS = 5;
export const WEEKOFF_ONE_PER_DAYS = 7;

export const RULE_META: Record<
  RuleId,
  { name: string; description: string; threshold: string; severity: Severity }
> = {
  MIN_REST: {
    name: "Minimum Rest Period",
    description: `Less than ${MIN_REST_HOURS} hours between consecutive shifts`,
    threshold: `${MIN_REST_HOURS} hours`,
    severity: "high",
  },
  CONSECUTIVE_DAYS: {
    name: "Consecutive Working Days",
    description: `More than ${MAX_CONSECUTIVE_WORK_DAYS} working days in a row`,
    threshold: `${MAX_CONSECUTIVE_WORK_DAYS} days max`,
    severity: "high",
  },
  WEEKOFF_FAIRNESS: {
    name: "Week-off Fairness",
    description: "Fewer than one week-off per 7 rostered days in the month",
    threshold: "1 per 7 days",
    severity: "medium",
  },
  MAX_HOURS: {
    name: "Maximum Weekly Hours",
    description: `More than ${MAX_WEEK_HOURS} productive hours in a Mon-Sun week`,
    threshold: `${MAX_WEEK_HOURS} hours/week`,
    severity: "high",
  },
  NIGHT_SHIFT_LIMIT: {
    name: "Night Shift Limit",
    description: `More than ${MAX_CONSECUTIVE_NIGHTS} consecutive night shifts`,
    threshold: `${MAX_CONSECUTIVE_NIGHTS} nights max`,
    severity: "medium",
  },
};

export const RULE_IDS = Object.keys(RULE_META) as RuleId[];

export interface ShiftTemplate {
  id: string;
  name: string;
  /** Minutes after midnight. */
  startMin: number;
  endMin: number;
  nightShift: boolean;
  productiveMinutes: number | null;
  breakMinutes: number | null;
}

export interface RosterDay {
  employeeId: string;
  /** YYYY-MM-DD */
  date: string;
  isWeekOff: boolean;
  shiftId: string | null;
}

export interface Incident {
  id: string;
  ruleId: RuleId;
  employeeId: string;
  /** Date the breach occurs (the day that crosses the limit). */
  date: string;
  severity: Severity;
  detail: string;
  /** Every date that contributes to the breach. */
  dates: string[];
}

/** "HH:MM[:SS]" -> minutes after midnight, null when unparseable. */
export function parseTimeToMinutes(t: unknown): number | null {
  if (typeof t !== "string") return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** YYYY-MM-DD -> whole days since epoch (UTC, so DST/timezone never shifts it). */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  return new Date((dayNumber(date) + n) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Monday (ISO week start) of the week containing `date`. */
export function isoWeekStart(date: string): string {
  const dow = (dayNumber(date) + 3) % 7; // 1970-01-01 was a Thursday; Monday -> 0
  return addDays(date, -dow);
}

/** Shift length in minutes; an end at/before the start means it runs past midnight. */
export function shiftSpanMinutes(t: ShiftTemplate): number {
  return t.endMin > t.startMin
    ? t.endMin - t.startMin
    : t.endMin + 1440 - t.startMin;
}

export function isNightShift(t: ShiftTemplate): boolean {
  return t.nightShift || t.startMin >= 20 * 60 || t.startMin < 6 * 60;
}

/** Productive hours a working day counts toward the weekly cap (never NaN). */
export function shiftHours(t: ShiftTemplate | undefined): number {
  if (!t) return 8;
  if (t.productiveMinutes && t.productiveMinutes > 0)
    return t.productiveMinutes / 60;
  return Math.max(shiftSpanMinutes(t) - (t.breakMinutes ?? 0), 0) / 60;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const hh = (h: number) => `${round1(h)}h`;

function incident(
  ruleId: RuleId,
  employeeId: string,
  date: string,
  detail: string,
  dates: string[],
): Incident {
  return {
    id: `${ruleId}|${employeeId}|${date}`,
    ruleId,
    employeeId,
    date,
    severity: RULE_META[ruleId].severity,
    detail,
    dates,
  };
}

/** Group by employee with rows sorted by date; a duplicated date keeps the last row. */
function groupByEmployee(days: RosterDay[]): Map<string, RosterDay[]> {
  const byEmp = new Map<string, Map<string, RosterDay>>();
  for (const d of days) {
    let m = byEmp.get(d.employeeId);
    if (!m) {
      m = new Map();
      byEmp.set(d.employeeId, m);
    }
    m.set(d.date, d);
  }
  const out = new Map<string, RosterDay[]>();
  for (const [emp, m] of byEmp)
    out.set(
      emp,
      [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    );
  return out;
}

/** Streaks of consecutive calendar dates where `pick` is true. */
function streaks(
  rows: RosterDay[],
  pick: (d: RosterDay) => boolean,
): RosterDay[][] {
  const out: RosterDay[][] = [];
  let cur: RosterDay[] = [];
  for (const d of rows) {
    if (!pick(d)) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    if (
      cur.length &&
      dayNumber(d.date) - dayNumber(cur[cur.length - 1].date) !== 1
    ) {
      out.push(cur);
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length) out.push(cur);
  return out;
}

export function evaluateRules(
  days: RosterDay[],
  templates: Map<string, ShiftTemplate>,
): Incident[] {
  const incidents: Incident[] = [];
  for (const [emp, rows] of groupByEmployee(days)) {
    const working = (d: RosterDay) => !d.isWeekOff;

    // Rule 1 — rest between two consecutive working days (overnight shifts handled via span).
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (
        a.isWeekOff ||
        b.isWeekOff ||
        dayNumber(b.date) - dayNumber(a.date) !== 1
      )
        continue;
      const ta = a.shiftId ? templates.get(a.shiftId) : undefined;
      const tb = b.shiftId ? templates.get(b.shiftId) : undefined;
      if (!ta || !tb) continue;
      const endA =
        dayNumber(a.date) * 1440 + ta.startMin + shiftSpanMinutes(ta);
      const startB = dayNumber(b.date) * 1440 + tb.startMin;
      const restH = (startB - endA) / 60;
      if (restH < MIN_REST_HOURS) {
        incidents.push(
          incident(
            "MIN_REST",
            emp,
            b.date,
            `${hh(Math.max(restH, 0))} rest between ${a.date} and ${b.date} (min ${MIN_REST_HOURS}h)`,
            [a.date, b.date],
          ),
        );
      }
    }

    // Rule 2 — working streak longer than the limit; one incident per streak, on day limit+1.
    for (const s of streaks(rows, working)) {
      if (s.length > MAX_CONSECUTIVE_WORK_DAYS) {
        incidents.push(
          incident(
            "CONSECUTIVE_DAYS",
            emp,
            s[MAX_CONSECUTIVE_WORK_DAYS].date,
            `${s.length} consecutive working days ${s[0].date} to ${s[s.length - 1].date} (max ${MAX_CONSECUTIVE_WORK_DAYS})`,
            s.map((d) => d.date),
          ),
        );
      }
    }

    // Rule 3 — week-off fairness per calendar month, only for months with a full week rostered.
    const months = new Map<string, RosterDay[]>();
    for (const d of rows) {
      const k = d.date.slice(0, 7);
      const arr = months.get(k);
      if (arr) arr.push(d);
      else months.set(k, [d]);
    }
    for (const [month, md] of months) {
      const required = Math.floor(md.length / WEEKOFF_ONE_PER_DAYS);
      const offs = md.filter((d) => d.isWeekOff);
      if (required > 0 && offs.length < required) {
        incidents.push(
          incident(
            "WEEKOFF_FAIRNESS",
            emp,
            md[md.length - 1].date,
            `${offs.length} week-off(s) in ${md.length} rostered days of ${month} (min ${required})`,
            offs.map((d) => d.date),
          ),
        );
      }
    }

    // Rule 4 — weekly productive hours (Mon-Sun); incident dated on the day the cap is crossed.
    const weeks = new Map<string, RosterDay[]>();
    for (const d of rows) {
      if (d.isWeekOff) continue;
      const k = isoWeekStart(d.date);
      const arr = weeks.get(k);
      if (arr) arr.push(d);
      else weeks.set(k, [d]);
    }
    for (const [wk, wd] of weeks) {
      let total = 0;
      let crossed: string | null = null;
      for (const d of wd) {
        total += shiftHours(d.shiftId ? templates.get(d.shiftId) : undefined);
        if (!crossed && total > MAX_WEEK_HOURS) crossed = d.date;
      }
      if (crossed) {
        incidents.push(
          incident(
            "MAX_HOURS",
            emp,
            crossed,
            `${hh(total)} productive hours in week of ${wk} (max ${MAX_WEEK_HOURS}h)`,
            wd.map((d) => d.date),
          ),
        );
      }
    }

    // Rule 5 — consecutive night shifts.
    const night = (d: RosterDay) => {
      if (d.isWeekOff || !d.shiftId) return false;
      const t = templates.get(d.shiftId);
      return !!t && isNightShift(t);
    };
    for (const s of streaks(rows, night)) {
      if (s.length > MAX_CONSECUTIVE_NIGHTS) {
        incidents.push(
          incident(
            "NIGHT_SHIFT_LIMIT",
            emp,
            s[MAX_CONSECUTIVE_NIGHTS].date,
            `${s.length} consecutive night shifts ${s[0].date} to ${s[s.length - 1].date} (max ${MAX_CONSECUTIVE_NIGHTS})`,
            s.map((d) => d.date),
          ),
        );
      }
    }
  }
  return incidents;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export interface RuleSummary {
  ruleId: RuleId;
  ruleName: string;
  description: string;
  threshold: string;
  severity: Severity;
  /** Incidents in the period. */
  violationCount: number;
  employeesAffected: number;
}

/** Percent of rostered employees with no breach; null when nobody was rostered (never a fake 100). */
export function compliancePercent(
  breaching: number,
  rostered: number,
): number | null {
  if (rostered <= 0) return null;
  const pct = round1(((rostered - breaching) / rostered) * 100);
  return breaching > 0 && pct >= 100 ? 99.9 : Math.max(0, pct);
}

/** Signed change in percentage points; null unless both sides exist. */
export function pointsDelta(
  cur: number | null,
  prev: number | null,
): number | null {
  return cur === null || prev === null ? null : round1(cur - prev);
}

export const monthOf = (date: string) => date.slice(0, 7);

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
  };
}

export function isValidMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function rosteredEmployees(
  days: RosterDay[],
  month: string,
): Set<string> {
  const s = new Set<string>();
  for (const d of days) if (monthOf(d.date) === month) s.add(d.employeeId);
  return s;
}

export interface MonthSummary {
  month: string;
  rostered: number;
  employeesWithViolations: number;
  totalViolations: number;
  compliancePct: number | null;
  rules: RuleSummary[];
}

export function summarizeMonth(
  incidents: Incident[],
  days: RosterDay[],
  month: string,
): MonthSummary {
  const inMonth = incidents.filter((i) => monthOf(i.date) === month);
  const rostered = rosteredEmployees(days, month);
  const breaching = new Set(inMonth.map((i) => i.employeeId));
  const rules = RULE_IDS.map((ruleId) => {
    const r = inMonth.filter((i) => i.ruleId === ruleId);
    return {
      ruleId,
      ruleName: RULE_META[ruleId].name,
      description: RULE_META[ruleId].description,
      threshold: RULE_META[ruleId].threshold,
      severity: RULE_META[ruleId].severity,
      violationCount: r.length,
      employeesAffected: new Set(r.map((i) => i.employeeId)).size,
    };
  });
  return {
    month,
    rostered: rostered.size,
    employeesWithViolations: breaching.size,
    totalViolations: inMonth.length,
    compliancePct: compliancePercent(breaching.size, rostered.size),
    rules,
  };
}

/** Per-group (e.g. branch) compliance in one month, using the same incident model. */
export function groupCompliance(
  incidents: Incident[],
  days: RosterDay[],
  month: string,
  groupOf: (employeeId: string) => string | null,
): Map<
  string,
  {
    rostered: number;
    breaching: number;
    violations: number;
    compliancePct: number | null;
  }
> {
  const out = new Map<
    string,
    { rostered: Set<string>; breaching: Set<string>; violations: number }
  >();
  const slot = (g: string) => {
    let s = out.get(g);
    if (!s) {
      s = { rostered: new Set(), breaching: new Set(), violations: 0 };
      out.set(g, s);
    }
    return s;
  };
  for (const e of rosteredEmployees(days, month)) {
    const g = groupOf(e);
    if (g) slot(g).rostered.add(e);
  }
  for (const i of incidents) {
    if (monthOf(i.date) !== month) continue;
    const g = groupOf(i.employeeId);
    if (!g) continue;
    const s = slot(g);
    s.breaching.add(i.employeeId);
    s.violations += 1;
  }
  const res = new Map<
    string,
    {
      rostered: number;
      breaching: number;
      violations: number;
      compliancePct: number | null;
    }
  >();
  for (const [g, s] of out)
    res.set(g, {
      rostered: s.rostered.size,
      breaching: s.breaching.size,
      violations: s.violations,
      compliancePct: compliancePercent(s.breaching.size, s.rostered.size),
    });
  return res;
}

// ── Attendance adherence (secondary domain, clearly separate from rule compliance) ─────────

export type AttendanceClass =
  "adhered" | "late" | "absent" | "missing_punch" | "unreconciled" | "excused";

/**
 * Classifies one rostered WORKING day that has already elapsed. Leave/holiday/week-off are
 * excused (not violations, not in the denominator); unreconciled/no record is its own bucket
 * rather than being silently called absence.
 */
export function classifyAttendance(
  status: string | null | undefined,
  lateMark: number | boolean | null | undefined,
): AttendanceClass {
  switch (status) {
    case "present":
    case "half_day":
      return lateMark ? "late" : "adhered";
    case "late":
      return "late";
    case "absent":
      return "absent";
    case "missing_punch":
      return "missing_punch";
    case "leave_approved":
    case "holiday":
    case "week_off":
    case "week_off_worked":
      return "excused";
    default:
      return "unreconciled";
  }
}

export interface AttendanceSummary {
  scheduled: number;
  adhered: number;
  late: number;
  absent: number;
  missingPunch: number;
  unreconciled: number;
  excused: number;
  /** (adhered+late) / (scheduled - excused); null when nothing is measurable. */
  adherencePct: number | null;
}

export function summarizeAttendance(
  rows: Array<{ status: string | null; late: number; n: number }>,
): AttendanceSummary {
  const s: AttendanceSummary = {
    scheduled: 0,
    adhered: 0,
    late: 0,
    absent: 0,
    missingPunch: 0,
    unreconciled: 0,
    excused: 0,
    adherencePct: null,
  };
  for (const r of rows) {
    const n = Number(r.n) || 0;
    s.scheduled += n;
    switch (classifyAttendance(r.status, r.late)) {
      case "adhered":
        s.adhered += n;
        break;
      case "late":
        s.late += n;
        break;
      case "absent":
        s.absent += n;
        break;
      case "missing_punch":
        s.missingPunch += n;
        break;
      case "unreconciled":
        s.unreconciled += n;
        break;
      case "excused":
        s.excused += n;
        break;
    }
  }
  const measurable = s.scheduled - s.excused;
  s.adherencePct =
    measurable > 0 ? round1(((s.adhered + s.late) / measurable) * 100) : null;
  return s;
}
