/**
 * Response types (mirror backend satya-retail-report.service.ts) and the
 * pure helpers the Satya Retail report tabs share. Every counter is a plain
 * sum, so days roll up into weeks / MTD here without another API call.
 */

export interface SatyaCounts {
  allocation: number;
  pending: number;
  unique: number;
  repeat: number;
  connected: number;
  notConnected: number;
  dropped: number;
  orders: number;
  ordersUnique: number;
  revenue: number;
  morning: number;
  absentee: number;
  unmapped: number;
}

export interface SatyaCallsData {
  headline: {
    attempts: number; connected: number; connectedPct: number; dropped: number;
    orderCalls: number; shops: number; agents: number; avgAttempt: number;
  };
  daily: Array<{ date: string; attempts: number; connected: number; orderCalls: number }>;
  byAttempt: Array<{ bucket: string; attempts: number; connected: number }>;
  hourly: Array<{ hour: number; attempts: number; connected: number }>;
  byScenario: Array<{ scenario: string; count: number }>;
  bySubScenario: Array<{ subScenario: string; count: number }>;
  agents: Array<{ agentId: string; attempts: number; connected: number; orderCalls: number; avgAttempt: number }>;
}

export interface SatyaCheck {
  id: string;
  level: "info" | "warn";
  title: string;
  detail: string;
  count: number;
}

export interface SatyaFilters {
  from: string;
  to: string;
  warehouse: string | null;
  roster: string | null;
}

export interface SatyaAgentRow { agentId: string; agentName: string; daysWorked: number; counts: SatyaCounts }
export interface SatyaWarehouseRow { warehouse: string; beats: number; counts: SatyaCounts }
export interface SatyaBeatRow { beat: string; warehouse: string; shops: number; counts: SatyaCounts }

export interface SatyaReportData {
  filters: SatyaFilters;
  available: { minDate: string | null; maxDate: string | null; warehouses: string[] };
  headline: SatyaCounts & { agents: number; shops: number };
  byRoster: Array<{ roster: string; counts: SatyaCounts }>;
  daily: Array<{ date: string; roster: string; counts: SatyaCounts }>;
  subDispositionDaily: Array<{ date: string; disposition: string; subDisposition: string; count: number }>;
  agents: SatyaAgentRow[];
  warehouses: SatyaWarehouseRow[];
  beats: SatyaBeatRow[];
  calls: SatyaCallsData;
  checks: SatyaCheck[];
}

export type SatyaDetailType = "agent" | "beat" | "warehouse";

export interface SatyaDetail {
  type: SatyaDetailType;
  key: string;
  title: string;
  subtitle: string;
  firstDate: string | null;
  lastDate: string | null;
  counts: SatyaCounts;
  daily: Array<{ date: string; allocation: number; connected: number; orders: number; revenue: number }>;
  dispositions: Array<{ disposition: string; subDisposition: string; count: number }>;
  breakdownLabel: string;
  breakdown: Array<{ name: string; counts: SatyaCounts }>;
  orders: Array<{ date: string; shop: string; beat: string; agent: string; roster: string; amount: number }>;
  ordersTotal: number;
  calls: { attempts: number; connected: number; orderCalls: number; avgAttempt: number };
}

/** Query string shared by the report and drill-down endpoints. */
export function filtersQuery(f: SatyaFilters): string {
  const p = new URLSearchParams({ from: f.from, to: f.to });
  if (f.warehouse) p.set("warehouse", f.warehouse);
  if (f.roster) p.set("roster", f.roster);
  return p.toString();
}

export const emptyCounts = (): SatyaCounts => ({
  allocation: 0, pending: 0, unique: 0, repeat: 0, connected: 0, notConnected: 0, dropped: 0,
  orders: 0, ordersUnique: 0, revenue: 0, morning: 0, absentee: 0, unmapped: 0,
});

export function addCounts(a: SatyaCounts, b: SatyaCounts): SatyaCounts {
  return {
    allocation: a.allocation + b.allocation, pending: a.pending + b.pending, unique: a.unique + b.unique,
    repeat: a.repeat + b.repeat, connected: a.connected + b.connected, notConnected: a.notConnected + b.notConnected,
    dropped: a.dropped + b.dropped, orders: a.orders + b.orders, ordersUnique: a.ordersUnique + b.ordersUnique,
    revenue: a.revenue + b.revenue, morning: a.morning + b.morning, absentee: a.absentee + b.absentee,
    unmapped: a.unmapped + b.unmapped,
  };
}

/** Calls actually made = allocated shops that were dialled (everything except still-pending). */
export const callsMade = (c: SatyaCounts) => c.allocation - c.pending;

/** Percentage with one decimal, or null when the denominator is zero (renders as "—"). */
export const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
export const fmtRatio = (v: number | null) => (v === null ? "—" : `${v}%`);
export const fmtInt = (v: number) => v.toLocaleString("en-IN");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM-DD -> DD/MM/YYYY without going through Date (no timezone shifts). */
export function fmtDMY(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
/** YYYY-MM-DD -> "5-Sep-26" (the labelling the Excel report uses). */
export function fmtDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}-${m[1].slice(2)}` : iso;
}

/** Every calendar date in [from, to] (capped), so a day with no uploads still shows as a zero column. */
export function calendarDays(from: string, to: string, cap = 62): string[] {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`).getTime();
  while (d.getTime() <= end && out.length < cap) {
    out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Week bucket by day of month: 1-7 -> W-1, 8-14 -> W-2, 15-21 -> W-3, 22-28 -> W-4, 29+ -> W-5. */
export const weekOf = (iso: string) => Math.ceil(Number(iso.slice(8, 10)) / 7);

/** Outcome (sub-disposition) totals for one disposition, summed over the report range. */
export function subDispositionTotals(data: SatyaReportData, disposition: string): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of data.subDispositionDaily) {
    if (r.disposition !== disposition) continue;
    map.set(r.subDisposition, (map.get(r.subDisposition) ?? 0) + r.count);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** The source sheet stores "not tagged" as the literal 0 on not-connected rows. */
export const outcomeLabel = (s: string) => (s === "0" ? "Not tagged" : s);

/* ── Daily tracker grid ─────────────────────────────────────────────── */

export interface GridColData {
  all: SatyaCounts;
  morning: SatyaCounts;
  absentee: SatyaCounts;
  unmapped: SatyaCounts;
  subConnected: Record<string, number>;
}
export interface GridColumn { key: string; label: string; kind: "mtd" | "week" | "day"; data: GridColData }

const emptyCol = (): GridColData => ({
  all: emptyCounts(), morning: emptyCounts(), absentee: emptyCounts(), unmapped: emptyCounts(), subConnected: {},
});

function addToCol(col: GridColData, roster: string, counts: SatyaCounts) {
  col.all = addCounts(col.all, counts);
  if (roster === "Morning") col.morning = addCounts(col.morning, counts);
  else if (roster === "Absentee") col.absentee = addCounts(col.absentee, counts);
  else col.unmapped = addCounts(col.unmapped, counts);
}

export function buildGridColumns(data: SatyaReportData): GridColumn[] {
  const dataDays = [...new Set(data.daily.map((d) => d.date))].sort();
  const calendar = calendarDays(data.filters.from, data.filters.to);
  // A very long range falls back to only the days that have data.
  const days = calendar.length >= 62 && dataDays.length > 0 ? dataDays : calendar;

  const dayCols = new Map<string, GridColData>(days.map((d) => [d, emptyCol()]));
  const weekCols = new Map<number, GridColData>();
  const mtd = emptyCol();

  for (const row of data.daily) {
    const day = dayCols.get(row.date);
    if (!day) continue;
    const wk = weekOf(row.date);
    if (!weekCols.has(wk)) weekCols.set(wk, emptyCol());
    addToCol(day, row.roster, row.counts);
    addToCol(weekCols.get(wk)!, row.roster, row.counts);
    addToCol(mtd, row.roster, row.counts);
  }
  for (const s of data.subDispositionDaily) {
    if (s.disposition !== "Connected") continue;
    const day = dayCols.get(s.date);
    if (!day) continue;
    const wk = weekOf(s.date);
    if (!weekCols.has(wk)) weekCols.set(wk, emptyCol());
    for (const col of [day, weekCols.get(wk)!, mtd]) col.subConnected[s.subDisposition] = (col.subConnected[s.subDisposition] ?? 0) + s.count;
  }

  const weekKeys = [...new Set(days.map(weekOf))].sort((a, b) => a - b);
  return [
    { key: "mtd", label: "MTD", kind: "mtd", data: mtd },
    ...weekKeys.map((w) => ({ key: `w${w}`, label: `W-${w}`, kind: "week" as const, data: weekCols.get(w) ?? emptyCol() })),
    ...days.map((d) => ({ key: d, label: fmtDayLabel(d), kind: "day" as const, data: dayCols.get(d) ?? emptyCol() })),
  ];
}

export interface GridRow { label: string; kind: "num" | "pct" | "money"; get: (c: GridColData) => number | null; strong?: boolean }
export interface GridBlock { title: string; rows: GridRow[] }

export function buildGridBlocks(columns: GridColumn[]): GridBlock[] {
  const mtd = columns[0].data;
  const hasUnmapped = mtd.unmapped.allocation > 0;

  const outcomes = Object.entries(mtd.subConnected)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => ({ label: name, kind: "num" as const, get: (c: GridColData) => c.subConnected[name] ?? 0 }));

  return [
    {
      title: "Allocation & calls",
      rows: [
        { label: "Overall allocation", kind: "num", strong: true, get: (c) => c.all.allocation },
        { label: "Morning", kind: "num", get: (c) => c.morning.allocation },
        { label: "Absentee", kind: "num", get: (c) => c.absentee.allocation },
        ...(hasUnmapped ? [{ label: "Unmapped roster", kind: "num" as const, get: (c: GridColData) => c.unmapped.allocation }] : []),
        { label: "Pending (not yet called)", kind: "num", get: (c) => c.all.pending },
        { label: "Calls made", kind: "num", strong: true, get: (c) => callsMade(c.all) },
        { label: "Unique calls", kind: "num", get: (c) => c.all.unique },
        { label: "Repeat calls", kind: "num", get: (c) => c.all.repeat },
        { label: "Order placed", kind: "num", strong: true, get: (c) => c.all.orders },
        { label: "Conversion % on calls made", kind: "pct", get: (c) => ratio(c.all.orders, callsMade(c.all)) },
        { label: "Conversion % on Morning", kind: "pct", get: (c) => ratio(c.morning.orders, callsMade(c.morning)) },
        { label: "Conversion % on Absentee", kind: "pct", get: (c) => ratio(c.absentee.orders, callsMade(c.absentee)) },
      ],
    },
    {
      title: "Connect",
      rows: [
        { label: "Connected", kind: "num", strong: true, get: (c) => c.all.connected },
        { label: "Morning", kind: "num", get: (c) => c.morning.connected },
        { label: "Absentee", kind: "num", get: (c) => c.absentee.connected },
        { label: "Not connected", kind: "num", get: (c) => c.all.notConnected },
        { label: "Order placed (unique calls)", kind: "num", get: (c) => c.all.ordersUnique },
        { label: "Conversion % at connect", kind: "pct", get: (c) => ratio(c.all.ordersUnique, c.all.connected) },
      ],
    },
    {
      title: "Orders",
      rows: [
        { label: "Order placed", kind: "num", strong: true, get: (c) => c.all.orders },
        { label: "Morning", kind: "num", get: (c) => c.morning.orders },
        { label: "Absentee", kind: "num", get: (c) => c.absentee.orders },
        { label: "From unique calls", kind: "num", get: (c) => c.all.ordersUnique },
        { label: "From repeat calls", kind: "num", get: (c) => c.all.orders - c.all.ordersUnique },
        { label: "Order revenue", kind: "money", get: (c) => c.all.revenue },
      ],
    },
    {
      title: "Pending",
      rows: [
        { label: "Pending", kind: "num", strong: true, get: (c) => c.all.pending },
        { label: "Morning", kind: "num", get: (c) => c.morning.pending },
        { label: "Absentee", kind: "num", get: (c) => c.absentee.pending },
      ],
    },
    { title: "Outcomes on connected calls", rows: outcomes },
  ];
}
