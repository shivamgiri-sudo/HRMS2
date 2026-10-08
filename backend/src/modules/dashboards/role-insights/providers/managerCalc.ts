import { addDaysIso } from "./mgmtOpsQaShared.js";

/** Pure calculations behind the Manager dashboard, kept free of I/O so they can be unit-tested. */

export interface DayCounts {
  present: number; // present + week_off_worked
  half: number;
  absent: number;
  leave: number;
  missing: number; // missing_punch + unreconciled
  late: number;
  notExpected: number; // week_off + holiday
  total: number;
}

/**
 * Attendance rate for one day: (present + 0.5 x half_day) / rows where attendance was expected.
 * "Expected" excludes week-offs, holidays and approved leave, exactly as the ATTENDANCE metric does,
 * so this tile cannot disagree with the Employee/HR dashboards. null when nobody was expected.
 */
export function attendanceRate(c: DayCounts): number | null {
  const expected = c.total - c.notExpected - c.leave;
  if (expected <= 0) return null;
  return Math.round(((c.present + c.half / 2) / expected) * 1000) / 10;
}

export function lateRate(c: DayCounts): number | null {
  const worked = c.present + c.half;
  return worked > 0 ? Math.round((c.late / worked) * 1000) / 10 : null;
}

/** `MM-DD` keys for [today, today + days - 1], with the calendar date each one falls on (handles year wrap). */
export function upcomingMonthDays(today: string, days: number): Array<{ md: string; date: string }> {
  const out: Array<{ md: string; date: string }> = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(today, i);
    out.push({ md: date.slice(5), date });
  }
  return out;
}

/** Years completed on `date` for an anniversary that falls on it (joined `joined`). */
export function yearsOn(joined: string, date: string): number {
  return Number(date.slice(0, 4)) - Number(joined.slice(0, 4));
}

/** Expands inclusive leave ranges into a per-day head-count of people out, for the days in [from, to]. */
export function expandLeaveDays(ranges: Array<{ from: string; to: string; people?: number }>, from: string, to: string): Array<{ date: string; out: number }> {
  const days: Array<{ date: string; out: number }> = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    let out = 0;
    for (const r of ranges) if (r.from <= d && r.to >= d) out += r.people ?? 1;
    days.push({ date: d, out });
  }
  return days;
}

export interface KpiGroupRow {
  code: string;
  name: string;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better";
  processId: string | null;
  n: number | null;
  d: number | null;
  avg: number | null;
  samples: number;
  employees: number;
}

export interface KpiRollup {
  code: string;
  name: string;
  unit: string | null;
  direction: "higher_is_better" | "lower_is_better";
  value: number | null;
  target: number | null;
  achievementPct: number | null;
  samples: number;
  employees: number;
}

/** target vs actual, capped at 120 (same cap Operations Command uses). */
export function achievement(value: number | null, target: number | null, dir: KpiRollup["direction"]): number | null {
  if (value === null || target === null || target === 0) return null;
  if (dir === "lower_is_better") return value <= 0 ? 120 : Math.min((target / value) * 100, 120);
  return Math.min((value / target) * 100, 120);
}

/**
 * Rolls per-(metric, process) rows into one row per metric.
 *
 * Ratio metrics use SUM(numerator)/SUM(denominator) - never an average of daily percentages - and fall
 * back to the sample-weighted mean only when a metric carries no numerator/denominator. A target is
 * shown only when processes holding at least half the samples have one; units are never mixed because
 * every metric stays on its own row.
 */
export function rollupKpis(rows: KpiGroupRow[], targets: Map<string, number>): KpiRollup[] {
  const by = new Map<string, KpiGroupRow[]>();
  for (const r of rows) by.set(r.code, [...(by.get(r.code) ?? []), r]);
  const out: KpiRollup[] = [];
  for (const [code, list] of by) {
    const first = list[0];
    const samples = list.reduce((s, r) => s + r.samples, 0);
    const haveRatio = list.every((r) => r.n !== null && r.d !== null && (r.d as number) > 0);
    let value: number | null;
    if (haveRatio) {
      const n = list.reduce((s, r) => s + (r.n as number), 0);
      const d = list.reduce((s, r) => s + (r.d as number), 0);
      value = d > 0 ? (n / d) * (first.unit === "percent" || first.unit === "percentage" ? 100 : 1) : null;
    } else {
      const w = list.filter((r) => r.avg !== null);
      const ws = w.reduce((s, r) => s + r.samples, 0);
      value = ws ? w.reduce((s, r) => s + (r.avg as number) * r.samples, 0) / ws : null;
    }
    const withTarget = list.filter((r) => r.processId && targets.has(`${r.processId}|${code}`));
    const targetSamples = withTarget.reduce((s, r) => s + r.samples, 0);
    const target = targetSamples * 2 >= samples && targetSamples > 0
      ? withTarget.reduce((s, r) => s + (targets.get(`${r.processId}|${code}`) as number) * r.samples, 0) / targetSamples
      : null;
    out.push({
      code, name: first.name, unit: first.unit, direction: first.direction,
      value: value === null ? null : Math.round(value * 100) / 100,
      target: target === null ? null : Math.round(target * 100) / 100,
      achievementPct: (() => { const a = achievement(value, target, first.direction); return a === null ? null : Math.round(a * 10) / 10; })(),
      samples, employees: Math.max(...list.map((r) => r.employees)),
    });
  }
  return out.sort((a, b) => b.samples - a.samples);
}

/**
 * Team health 0-100, built only from components that exist; each carries a stated weight. Returns null when
 * fewer than two components are available, because one number alone is not a "health" score.
 */
export function teamHealth(input: { attendancePct: number | null; overdueShare: number | null; highRiskShare: number | null }): { score: number; basis: string } | null {
  const parts: Array<{ w: number; v: number; label: string }> = [];
  if (input.attendancePct !== null) parts.push({ w: 0.5, v: Math.max(0, Math.min(100, input.attendancePct)), label: "attendance 50%" });
  if (input.overdueShare !== null) parts.push({ w: 0.3, v: 100 - Math.max(0, Math.min(100, input.overdueShare * 100)), label: "approvals on time 30%" });
  if (input.highRiskShare !== null) parts.push({ w: 0.2, v: 100 - Math.max(0, Math.min(100, input.highRiskShare * 100 * 4)), label: "retention risk 20%" });
  if (parts.length < 2) return null;
  const total = parts.reduce((s, p) => s + p.w, 0);
  const score = Math.round(parts.reduce((s, p) => s + p.v * p.w, 0) / total);
  return { score, basis: `Weighted blend of ${parts.map((p) => p.label).join(", ")} (weights re-normalised over available parts). Retention component = 100 - 4 x share of team at high risk.` };
}
