/** Process Dashboard forecast -- turns normalized rows + targets into the endpoint payload (pure: rows in, JSON out; all numbers via pd.metrics + fc.engine). */
import { METRIC_BY_KEY } from "../pd.fields.js";
import { addQa, addRow, computeMetrics, emptyAcc, totalAcc, type NormRow, type QaBucket } from "../pd.metrics.js";
import { LOOKBACK_DAYS, addDaysIso, buildCalendar, datesBetween, monthBounds, type Calendar } from "./fc.calendar.js";
import { forecastKpi, monthDays, type DailyPoint, type ForecastKpi, type KpiKind, type KpiSpec } from "./fc.engine.js";

export interface AssembleInput {
  month: string; today: string; latestDate: string | null;
  rows: NormRow[]; qa: QaBucket[]; holidays: string[];
  kpiKeys: string[]; available: Record<string, boolean>; targets: Record<string, number>;
  rankMetric: string; filters: { tl?: string; lob?: string };
  tlLimit?: number;
}
const ADDITIVE_UNITS = new Set(["count", "currency", "hours"]);
export const kindOf = (unit: string): KpiKind => (ADDITIVE_UNITS.has(unit) ? "additive" : "rate");

type DayMetrics = Record<string, number | string | null>;
function dayMetrics(rows: NormRow[], qa: QaBucket[]): Map<string, DayMetrics> {
  const agents = new Set(rows.map((r) => r.agent_code));
  const m = new Map<string, ReturnType<typeof emptyAcc>>();
  for (const r of rows) { let a = m.get(r.date); if (!a) { a = emptyAcc(); m.set(r.date, a); } addRow(a, r); }
  for (const q of qa) if (agents.has(q.agentCode)) { const a = m.get(q.date); if (a) addQa(a, q); }
  return new Map([...m.entries()].map(([d, acc]) => [d, computeMetrics(acc) as DayMetrics]));
}

/** Additive days the scope did not report are real zeros only for sub-groups (a TL absent on a worked day produced nothing); the scope itself defines worked days. */
function dailySeries(spec: KpiSpec, byDay: Map<string, DayMetrics>, cal: Calendar, from: string, cutoff: string, zeroFill: boolean): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (const d of datesBetween(from, cutoff)) {
    if (!cal.isWorked(d)) continue;
    const v = byDay.get(d)?.[spec.key];
    out.push({ date: d, value: typeof v === "number" ? v : zeroFill && spec.kind === "additive" && !byDay.has(d) ? 0 : null });
  }
  return out;
}

/**
 * Last COMPLETE day and the rows window. The cutoff is the newest data day unless that is today (or later: today's feed is still filling),
 * capped at the month's end. The 8 week lookback hangs off the CUTOFF (not off today), so a lagging feed still gets its full history.
 */
export function forecastWindow(month: string, today: string, latestDate: string | null) {
  const mb = monthBounds(month);
  const yesterday = addDaysIso(today, -1);
  const partialToday = latestDate !== null && latestDate >= today && month === today.slice(0, 7);
  const latestComplete = latestDate === null ? yesterday : latestDate >= today ? yesterday : latestDate;
  const cutoff = latestComplete < mb.last ? latestComplete : mb.last;
  const winStart = addDaysIso(cutoff, -(LOOKBACK_DAYS - 1));
  const loadTo = mb.last < today ? mb.last : today;
  return { mb, yesterday, partialToday, cutoff, winStart, loadFrom: winStart < loadTo ? winStart : loadTo, loadTo };
}

export function assembleForecast(inp: AssembleInput) {
  const todayMonth = inp.today.slice(0, 7);
  const { mb, yesterday, partialToday, cutoff, winStart } = forecastWindow(inp.month, inp.today, inp.latestDate);

  const inScope = inp.rows.filter((r) => {
    const tl = inp.filters.tl?.trim().toLowerCase(); const lob = inp.filters.lob?.trim().toLowerCase();
    return (!tl || (r.tl_name ?? "unassigned").toLowerCase() === tl) && (!lob || (r.lob ?? "unassigned").toLowerCase() === lob);
  });
  const hist = inScope.filter((r) => r.date >= winStart && r.date <= cutoff);
  const cal = buildCalendar({ cutoff, workedDates: new Set(hist.map((r) => r.date)), holidays: inp.holidays });
  const agentsOf = (rows: NormRow[]) => new Set(rows.map((r) => r.agent_code));
  const qaFor = (rows: NormRow[], from: string, to: string) => { const s = agentsOf(rows); return inp.qa.filter((q) => q.date >= from && q.date <= to && s.has(q.agentCode)); };
  const specs: KpiSpec[] = inp.kpiKeys.filter((k) => METRIC_BY_KEY.has(k)).map((k) => {
    const d = METRIC_BY_KEY.get(k)!;
    return { key: k, label: d.label, unit: d.unit, direction: d.direction, kind: kindOf(d.unit), target: inp.targets[k] ?? null };
  });
  const partialDate = partialToday ? inp.today : null;

  const forEach = (rows: NormRow[], byDayAll: Map<string, DayMetrics>, zeroFill: boolean, withPath: boolean, from: string): ForecastKpi[] => {
    const monthRows = rows.filter((r) => r.date >= mb.first && r.date <= cutoff);
    const mtdM = computeMetrics(totalAcc(monthRows, qaFor(monthRows, mb.first, cutoff)));
    return specs.map((spec) => {
      if (inp.available[spec.key] === false) {
        return { key: spec.key, label: spec.label, unit: spec.unit, direction: spec.direction, kind: spec.kind, mtd: null, projected: null, band: null, target: spec.target, pacingPct: null,
          status: "nodata" as const, requiredDailyRate: null, daysElapsed: 0, daysRemaining: 0, method: "none", reason: "Source field not mapped", expectedDaily: null, partial: null };
      }
      let partial: { date: string; value: number | null } | null = null;
      if (partialDate) {
        const pr = rows.filter((r) => r.date === partialDate);
        partial = { date: partialDate, value: pr.length ? ((computeMetrics(totalAcc(pr, qaFor(pr, partialDate, partialDate)))[spec.key] as number | null) ?? null) : null };
      }
      return forecastKpi({ month: inp.month, monthFirst: mb.first, monthLast: mb.last, cutoff, calendar: cal, spec, daily: dailySeries(spec, byDayAll, cal, from, cutoff, zeroFill),
        mtdValue: (mtdM[spec.key] as number | null) ?? null, partial, withPath });
    });
  };

  const scopeByDay = dayMetrics(hist, qaFor(hist, winStart, cutoff));
  const kpis = forEach(inScope, scopeByDay, false, true, winStart);

  // Per team leader: same calendar (days the whole scope worked), a TL absent on such a day counts as 0 for additive KPIs (from the TL's first day on).
  const byTlRows = new Map<string, NormRow[]>();
  for (const r of hist) { const k = r.tl_name ?? "Unassigned"; let a = byTlRows.get(k); if (!a) { a = []; byTlRows.set(k, a); } a.push(r); }
  const tlRows = [...byTlRows.entries()].map(([tl, rows]) => {
    const first = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
    const fk = forEach(rows, dayMetrics(rows, qaFor(rows, winStart, cutoff)), true, false, first > winStart ? first : winStart);
    return { tl, agents: agentsOf(rows).size, kpis: fk };
  });
  const rankOf = (t: { kpis: ForecastKpi[] }) => t.kpis.find((k) => k.key === inp.rankMetric)?.mtd ?? -Infinity;
  tlRows.sort((a, b) => rankOf(b) - rankOf(a) || a.tl.localeCompare(b.tl));

  const { elapsed: elapsedDays, remaining: remainingDays } = monthDays({ monthFirst: mb.first, monthLast: mb.last, cutoff, calendar: cal });
  // Stale: a working day between the newest complete data day and yesterday has no rows (feed lag) -- forecast treats those days as still to come.
  const stale = inp.month === todayMonth && cutoff < yesterday && datesBetween(addDaysIso(cutoff, 1), yesterday).some((d) => cal.isWorking(d));
  const monthHolidays = inp.holidays.filter((d) => d >= mb.first && d <= mb.last).sort();
  const warnings: string[] = [];
  if (!hist.length) warnings.push("No source rows in the 8 weeks before the cutoff; nothing to project from.");
  if (cal.basis === "weekday-only") warnings.push("No history to infer a working calendar from; Monday-Friday assumed.");
  if (stale) warnings.push("The source has no rows for one or more recent working days; those days are projected as if still to come.");
  if (partialToday) warnings.push("Today's data is still arriving: it is excluded from month-to-date and from the history that drives the projection.");
  return {
    month: inp.month, range: { from: mb.first, to: mb.last }, asOf: cutoff < mb.first ? null : cutoff, today: inp.today, partialDay: partialDate, stale,
    filters: inp.filters, rankMetric: inp.rankMetric,
    calendar: {
      basis: cal.basis, workingWeekdays: cal.workingWeekdays, holidaysHonoured: cal.holidaysHonoured, holidays: monthHolidays,
      workingDays: { elapsed: elapsedDays.length, remaining: remainingDays.length, total: elapsedDays.length + remainingDays.length },
      note: cal.basis === "observed"
        ? `Working days are inferred from the source: a day counts if it has rows; future days follow each weekday's 8-week pattern${cal.holidaysHonoured ? " and skip company holidays" : " (company holidays ignored: this process works on them)"}.`
        : "No history: Monday-Friday assumed.",
    },
    method: {
      bandLevel: 0.8, lookbackDays: LOOKBACK_DAYS,
      additive: "month-to-date + same-weekday average (last <= 8 weeks) for each remaining working day; 80% band from a seeded bootstrap of day residuals.",
      rate: "month-to-date blended with a linear trend of the last <= 14 days over the remaining days (every working day weighs the same); 80% band from a seeded bootstrap.",
      targets: "Targets are read from KPI configuration only. A KPI without a target shows its projection with status no_target.",
    },
    kpis, byTl: tlRows.slice(0, inp.tlLimit ?? 60), warnings,
  };
}
export type ForecastPayload = ReturnType<typeof assembleForecast>;
