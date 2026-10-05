/**
 * ALT RX ticket MIS engine. Reproduces the business logic of "AltRx Dasboard Sep'26.xlsx"
 * from its Dump sheet, rule for rule:
 *
 *   Inflow        = tickets created on the day (Dump "Created time").
 *   Closure       = tickets with status Resolved or Closed, counted on their Resolved day.
 *   Within / Out TAT = first response (Dump "Initial response time") within 30 minutes of
 *                   creation, counted on the first-response day. No response -> neither.
 *   Closure %     = Closure / Inflow.      FRT % = Within TAT / Inflow.
 *   Week-N        = days 7(N-1)+1 .. 7N of the month. A week or MTD is the sum of its days.
 *   Brand         = text after the first "-" in "Source Info" (e.g. "Facebook - AltRx" -> "AltRx").
 *   Agent         = Dump "Agent"; blank -> "No Agent".
 *   Comment type  = Dump "Type"; blank -> "Unspecified".
 *
 * Dates are read as UTC wall-clock values (how SheetJS hands back Excel datetimes), so no
 * timezone shift happens between the upload and the day it is counted on.
 */

export const TAT_LIMIT_MS = 30 * 60_000;
export const WEEKS = ["Week-1", "Week-2", "Week-3", "Week-4", "Week-5"] as const;
export const REQUIRED_COLUMNS = ["Ticket ID", "Status", "Agent", "Type", "Source Info", "Created time", "Initial response time", "Resolved time"] as const;

/** Every column of the ticket Dump, as the uploader expects it. Only REQUIRED_COLUMNS block an upload; the rest are warnings. */
export const EXPECTED_COLUMNS = [
  "Ticket ID", "Subject", "Status", "Priority", "Source", "Type", "Agent", "Group", "Created time", "Due by Time",
  "Resolved time", "Closed time", "Last update time", "Initial response time", "Time tracked", "First response time (in hrs)",
  "Resolution time (in hrs)", "Agent interactions", "Customer interactions", "Resolution status", "First response status",
  "Tags", "Survey results", "Product", "Every response status", "Reference Number", "Summary", "Product Series",
  "Source Info", "Assigned Ticket Time", "Full name", "Contact ID",
] as const;

export type DumpRow = Record<string, unknown>;

export interface TicketFacts {
  ticketId: string;
  status: "open" | "closed";
  agent: string;
  type: string;
  brand: string;
  createdDay: string | null;
  responseDay: string | null;
  resolvedDay: string | null;
  tat: "within" | "out" | null;
}

export interface Counts { inflow: number; closure: number; within: number; out: number }

export interface Table<K extends string> {
  rows: Array<{ key: K; daily: Counts[]; weeks: Counts[]; mtd: Counts }>;
}

export interface MisModel {
  days: string[];
  headline: Counts & { closurePct: number | null; frtPct: number | null; agents: number; brands: number; tickets: number };
  agents: Table<string>;
  types: Table<string>;
  brands: Table<string>;
  daily: Counts[];
  skipped: { missingDate: number; duplicateTicketIds: number };
  tickets: TicketFacts[];
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Date from a SheetJS cell value: Date, Excel serial number, or a parseable string. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // SheetJS builds Excel datetimes as LOCAL Dates. Keep the wall-clock reading (what the user
    // typed in Excel) and re-anchor it in UTC, so the day does not move with the server timezone.
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds(), v.getMilliseconds()));
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(EXCEL_EPOCH_MS + Math.round(v * 86_400_000));
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
    if (hasZone) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // No timezone (e.g. "9/1/26 0:00" or "2026-09-01 00:00:21"): take the wall clock as written,
    // then anchor it in UTC, the same way Date objects from the spreadsheet reader are handled.
    const local = new Date(/^\d{4}-\d{2}-\d{2}/.test(s) ? s.replace(" ", "T") : s);
    if (Number.isNaN(local.getTime())) return null;
    return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds(), local.getMilliseconds()));
  }
  return null;
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** "Week-N" for a day-of-month (1-7 -> Week-1, ... 29-31 -> Week-5). */
export function weekOfDay(day: number): (typeof WEEKS)[number] {
  return WEEKS[Math.min(4, Math.ceil(day / 7) - 1)];
}

export function brandOf(sourceInfo: unknown): string {
  const s = String(sourceInfo ?? "");
  const i = s.indexOf("-");
  if (i < 0) return "Unknown brand";
  return s.slice(i + 1).trim() || "Unknown brand";
}

const text = (v: unknown, fallback: string) => {
  const s = String(v ?? "").trim();
  return s || fallback;
};

export function toFacts(row: DumpRow): TicketFacts | null {
  const created = toDate(row["Created time"]);
  const response = toDate(row["Initial response time"]);
  const resolved = toDate(row["Resolved time"]);
  const statusRaw = String(row["Status"] ?? "").trim().toLowerCase();
  const closed = statusRaw === "resolved" || statusRaw === "closed";
  // Source rule (AO): a response that is 0-30 min after creation is Within TAT. Anything else
  // is Out of TAT, including a ticket with no first response and a response dated before creation.
  let tat: TicketFacts["tat"] = "out";
  if (created && response) {
    const gap = response.getTime() - created.getTime();
    if (gap >= 0 && gap <= TAT_LIMIT_MS) tat = "within";
  }
  return {
    ticketId: text(row["Ticket ID"], ""),
    status: closed ? "closed" : "open",
    agent: text(row["Agent"], "No Agent"),
    type: text(row["Type"], "Unspecified"),
    brand: brandOf(row["Source Info"]),
    createdDay: created ? dayKey(created) : null,
    responseDay: response ? dayKey(response) : null,
    resolvedDay: resolved ? dayKey(resolved) : null,
    tat,
  };
}

const zero = (): Counts => ({ inflow: 0, closure: 0, within: 0, out: 0 });

/** Adds one ticket's counts to the day slots of a series. */
function countInto(arr: Counts[], f: TicketFacts, dayIndex: Map<string, number>) {
  if (f.createdDay && dayIndex.has(f.createdDay)) arr[dayIndex.get(f.createdDay)!].inflow += 1;
  if (f.status === "closed" && f.resolvedDay && dayIndex.has(f.resolvedDay)) arr[dayIndex.get(f.resolvedDay)!].closure += 1;
  if (f.tat && f.responseDay && dayIndex.has(f.responseDay)) {
    const i = dayIndex.get(f.responseDay)!;
    if (f.tat === "within") arr[i].within += 1; else arr[i].out += 1;
  }
}

/** Sum the day counts into weeks (by day-of-month) and an MTD total. */
/** Week columns: each day's counts go to the week of its day-of-month. */
function weekTotals(daily: Counts[], days: string[]): Counts[] {
  const weeks = WEEKS.map(zero);
  days.forEach((d, i) => {
    const w = WEEKS.indexOf(weekOfDay(Number(d.slice(8, 10))));
    for (const k of ["inflow", "closure", "within", "out"] as const) weeks[w][k] += daily[i][k];
  });
  return weeks;
}

/**
 * MTD = every ticket in the dump, the way the source's Sheet1 MTD column counts them
 * (COUNTIFS over the whole Dump). Not the sum of the day columns, because a response or
 * resolution can fall outside the created-date calendar.
 */
export function mtdOf(list: TicketFacts[]): Counts {
  const c = zero();
  for (const f of list) {
    c.inflow += 1;
    if (f.status === "closed") c.closure += 1;
    if (f.tat === "within") c.within += 1;
    if (f.tat === "out") c.out += 1;
  }
  return c;
}

function buildTable(
  tickets: TicketFacts[], keyOf: (f: TicketFacts) => string, days: string[], dayIndex: Map<string, number>,
): Table<string> {
  const groups = new Map<string, TicketFacts[]>();
  for (const f of tickets) {
    const k = keyOf(f);
    const g = groups.get(k);
    if (g) g.push(f); else groups.set(k, [f]);
  }
  const rows = [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((key) => {
    const list = groups.get(key) as TicketFacts[];
    const daily = Array.from({ length: days.length }, zero);
    for (const f of list) countInto(daily, f, dayIndex);
    return { key, daily, weeks: weekTotals(daily, days), mtd: mtdOf(list) };
  });
  return { rows };
}

export function buildMisModel(input: DumpRow[]): MisModel {
  const skipped = { missingDate: 0, duplicateTicketIds: 0 };
  const seen = new Set<string>();
  const tickets: TicketFacts[] = [];
  for (const row of input) {
    const f = toFacts(row);
    if (!f) continue;
    if (!f.createdDay) { skipped.missingDate += 1; continue; }
    if (f.ticketId) {
      if (seen.has(f.ticketId)) { skipped.duplicateTicketIds += 1; continue; }
      seen.add(f.ticketId);
    }
    tickets.push(f);
  }

  // Calendar of days from the first to the last created day, inclusive (source shows every day).
  const created = tickets.map((t) => t.createdDay as string).sort();
  const days: string[] = [];
  if (created.length) {
    const start = new Date(`${created[0]}T00:00:00Z`);
    const end = new Date(`${created[created.length - 1]}T00:00:00Z`);
    for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) days.push(dayKey(d));
  }
  const dayIndex = new Map(days.map((d, i) => [d, i] as const));

  const overall = Array.from({ length: days.length }, zero);
  for (const f of tickets) countInto(overall, f, dayIndex);

  const agents = buildTable(tickets, (f) => f.agent, days, dayIndex);
  const types = buildTable(tickets, (f) => f.type, days, dayIndex);
  const brands = buildTable(tickets, (f) => f.brand, days, dayIndex);

  const h = mtdOf(tickets);
  return {
    days,
    daily: overall,
    headline: {
      ...h,
      closurePct: h.inflow ? h.closure / h.inflow : null,
      frtPct: h.inflow ? h.within / h.inflow : null,
      agents: new Set(tickets.map((t) => t.agent)).size,
      brands: new Set(tickets.map((t) => t.brand)).size,
      tickets: tickets.length,
    },
    agents,
    types,
    brands,
    skipped,
    tickets,
  };
}
