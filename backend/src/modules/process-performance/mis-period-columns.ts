/**
 * Shared "MTD + Weekly + Daily" column builder for MIS KPI-matrix sheets: one column for the whole
 * requested range (labelled "MTD" when it is exactly the current month-to-date, "Selected Range"
 * otherwise), one column per calendar week inside the range, then one column per day (when the range
 * is short enough that per-day columns stay readable) -- so a KPI table built against these columns
 * reads "one row per metric, one column per period, all in the same sheet", the same layout every
 * Process Performance V2 screen in this app already uses for its own MTD/week/date tables
 * (housing-premium-dashboard.service.ts's buildOverviewColumns is the on-screen twin of this; this
 * module exists so the MIS export can build the identical shape for a process whose own dashboard
 * service does not already expose day/week/MTD columns, without duplicating the date math per file).
 *
 * Week convention: day-of-month 1-7 is Week-1, 8-14 is Week-2, and so on -- the same block convention
 * used everywhere else in this app (HousingOwnerDashboard.tsx, housing-premium-dashboard.service.ts).
 */

export interface PeriodColumn {
  key: string;
  label: string;
  kind: "mtd" | "week" | "day";
  from: string;
  to: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number): string => String(n).padStart(2, "0");

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function weekNoOfMonth(iso: string): number {
  return Math.min(5, Math.ceil(Number(iso.slice(8, 10)) / 7));
}
export function dayLabel(iso: string): string {
  return `${Number(iso.slice(8, 10))}-${MON[Number(iso.slice(5, 7)) - 1]}`;
}

/** Per-day fair share of a flat monthly target, summed over a column's own span -- the same
 * proration every MTD/week/day table in this app already applies (a full calendar month's worth of
 * per-day shares sums back to exactly the monthly figure). */
export function proratedTarget(monthlyTarget: number, from: string, to: string): number {
  let total = 0;
  for (const d of eachDay(from, to)) total += monthlyTarget / daysInMonth(d.slice(0, 7));
  return Math.round(total);
}

/**
 * MTD/Selected-range column + one column per calendar week + one column per day (only when the range
 * is 62 days or fewer, so the sheet stays a sane width -- a longer range still gets its MTD and week
 * columns, just no exploded daily columns).
 */
export function buildPeriodColumns(from: string, to: string): PeriodColumn[] {
  const days = eachDay(from, to);
  const months = new Set(days.map((d) => d.slice(0, 7)));
  const singleFromFirst = months.size === 1 && from.endsWith("-01");
  const cols: PeriodColumn[] = [{ key: "mtd", label: singleFromFirst ? "MTD" : "Selected Range", kind: "mtd", from, to }];

  const weeks = new Map<string, { from: string; to: string; label: string }>();
  for (const d of days) {
    const key = `${d.slice(0, 7)}-W${weekNoOfMonth(d)}`;
    const cur = weeks.get(key);
    if (!cur) weeks.set(key, { from: d, to: d, label: months.size > 1 ? `${MON[Number(d.slice(5, 7)) - 1]} W-${weekNoOfMonth(d)}` : `W-${weekNoOfMonth(d)}` });
    else cur.to = d;
  }
  for (const [key, w] of weeks) cols.push({ key, label: w.label, kind: "week", from: w.from, to: w.to });

  if (days.length <= 62) for (const d of days) cols.push({ key: d, label: dayLabel(d), kind: "day", from: d, to: d });
  return cols;
}
