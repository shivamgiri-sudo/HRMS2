/**
 * Pure page model of the Drive Command Center: sections, filters, the hash (#drives:<section>?from=&to=&req=&branch=), API paths,
 * KPI tiles, compare rows and the CSV builder. No I/O, no browser zone: dates are IST by arithmetic. Every formatter returns an en dash
 * instead of NaN / Infinity. No regex literals (Tailwind scans source text).
 */
import { STAGES, type CostBlock, type DriveAnalytics, type SourceType, type Stage, type TypeCost } from "./driveCommandTypes";

export type SectionId = "summary" | "criteria" | "live" | "old" | "he" | "plan";
export const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; sourceType: SourceType | null }> = [
  { id: "summary", label: "Summary", sourceType: null },
  { id: "live", label: "Live Meta", sourceType: "meta_live" },
  { id: "old", label: "Old Meta data", sourceType: "meta_old" },
  { id: "he", label: "Hiring Engine", sourceType: "he" },
  { id: "plan", label: "Plan", sourceType: null },
];
/** The Selection criteria section (plan 2026-10-09, S20) sits after Summary, only for roles that may read criteria. */
export const CRITERIA_SECTION = { id: "criteria" as SectionId, label: "Selection criteria", sourceType: null };
export const ALL_SECTIONS: ReadonlyArray<{ id: SectionId; label: string; sourceType: SourceType | null }> = [SECTIONS[0], CRITERIA_SECTION, ...SECTIONS.slice(1)];
export const sectionsFor = (showCriteria: boolean) => (showCriteria ? ALL_SECTIONS : SECTIONS);
export const TYPE_LABEL: Record<SourceType, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };
export const SOURCE_TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
export const STAGE_LABEL: Record<Stage, string> = {
  leads: "Leads", qualified: "Qualified", invited: "Invited", confirmed: "Confirmed", arrived: "Arrived", selected: "Selected", joined: "Joined",
};

export interface Filters { from: string; to: string; requisitionId: string | null; branch: string | null }

const DASH = "–";
const DEFAULT_BACK = 13;
const MAX_SPAN_DAYS = 92;
const MAX_AHEAD_DAYS = 14;
const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;
const MAX_BRANCH_LENGTH = 150;

// ---- IST dates ---------------------------------------------------------------------------------------------------------------------------
const isDigits = (s: string): boolean => s.length > 0 && s.split("").every((c) => c >= "0" && c <= "9");
/** A real calendar day "YYYY-MM-DD" (2026-02-30 is rejected by the round trip). */
export function isIsoDay(x: unknown): x is string {
  if (typeof x !== "string" || x.length !== 10 || x[4] !== "-" || x[7] !== "-") return false;
  if (!isDigits(x.slice(0, 4)) || !isDigits(x.slice(5, 7)) || !isDigits(x.slice(8))) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
}
export function addDaysIso(day: string, n: number): string { return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10); }
function daysBetween(a: string, b: string): number { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS); }

/** Today in IST: the date of now + 5.5 h read in UTC, never the browser's zone. */
export function istTodayClient(now: Date = new Date()): string {
  const t = now instanceof Date ? now.getTime() : Number.NaN;
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(base + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function defaultFilters(now: Date = new Date()): Filters {
  const to = istTodayClient(now);
  return { from: addDaysIso(to, -DEFAULT_BACK), to, requisitionId: null, branch: null };
}

/** The API's window limits: from <= to, at most 92 days, to at most today + 14. */
function validWindow(from: string, to: string, now: Date): boolean {
  if (!isIsoDay(from) || !isIsoDay(to) || from > to) return false;
  if (daysBetween(from, to) + 1 > MAX_SPAN_DAYS) return false;
  return to <= addDaysIso(istTodayClient(now), MAX_AHEAD_DAYS);
}

// ---- hash --------------------------------------------------------------------------------------------------------------------------------
const sectionOf = (s: string): SectionId => ALL_SECTIONS.find((x) => x.id === s)?.id ?? "summary";
const isHex = (c: string): boolean => (c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
/** A 36-char UUID shape (8-4-4-4-12 hex); anything else is dropped so the API never answers 400 for a hand-edited hash. */
export function isUuidShape(x: string | null): x is string {
  if (!x || x.length !== 36) return false;
  return x.split("").every((c, i) => (i === 8 || i === 13 || i === 18 || i === 23 ? c === "-" : isHex(c)));
}
const cleanText = (v: string | null, max: number): string | null => (v && v.length <= max ? v : null);

/** Total: any input (garbage, wrong prefix, bad dates) gives the default section and default filters; never throws. */
export function parseCommandHash(hash: string, now: Date = new Date()): { section: SectionId; filters: Filters } {
  const filters = defaultFilters(now);
  try {
    if (typeof hash !== "string" || !hash.startsWith("#drives")) return { section: "summary", filters };
    const body = hash.slice(1);
    const q = body.indexOf("?");
    const head = q < 0 ? body : body.slice(0, q);
    const query = q < 0 ? "" : body.slice(q + 1);
    if (head !== "drives" && !head.startsWith("drives:")) return { section: "summary", filters };
    const section = sectionOf(head.slice("drives:".length));
    const params = new URLSearchParams(query);
    const f = params.get("from"), t = params.get("to");
    const to = t ?? filters.to;
    const from = f ?? (t ? addDaysIso(isIsoDay(t) ? t : filters.to, -DEFAULT_BACK) : filters.from);
    const dates = (f !== null || t !== null) && validWindow(from, to, now) ? { from, to } : { from: filters.from, to: filters.to };
    return {
      section,
      filters: { ...dates, requisitionId: ((r) => (isUuidShape(r) ? r : null))(params.get("req")), branch: cleanText(params.get("branch"), MAX_BRANCH_LENGTH) },
    };
  } catch {
    return { section: "summary", filters };
  }
}

/** Canonical hash; values equal to the default are omitted (dates travel as a pair when either differs). */
export function commandHash(section: SectionId, f: Filters, now: Date = new Date()): string {
  const d = defaultFilters(now);
  const p = new URLSearchParams();
  if (f.from !== d.from || f.to !== d.to) { p.set("from", f.from); p.set("to", f.to); }
  if (f.requisitionId) p.set("req", f.requisitionId);
  if (f.branch) p.set("branch", f.branch);
  const qs = p.toString();
  return `#drives:${sectionOf(section)}${qs ? `?${qs}` : ""}`;
}

/** Tablist keyboard: ArrowRight / ArrowLeft wrap, Home and End jump; any other key is null. */
export function nextSectionByKey(current: SectionId, key: string, list: ReadonlyArray<{ id: SectionId }> = SECTIONS): SectionId | null {
  const i = list.findIndex((s) => s.id === current);
  const n = list.length;
  const at = i < 0 ? 0 : i;
  if (key === "ArrowRight") return list[(at + 1) % n].id;
  if (key === "ArrowLeft") return list[(at - 1 + n) % n].id;
  if (key === "Home") return list[0].id;
  if (key === "End") return list[n - 1].id;
  return null;
}

// ---- API paths ---------------------------------------------------------------------------------------------------------------------------
// backend/src/modules/hiring-engine/he-command.routes.ts
export const FOLLOWUP_STATUS_PATH = "/api/he/qualified-followup/status";
export function analyticsPath(f: Filters): string {
  const p = new URLSearchParams();
  p.set("from", f.from);
  p.set("to", f.to);
  if (f.requisitionId) p.set("requisitionId", f.requisitionId);
  if (f.branch) p.set("branch", f.branch);
  return `/api/he/drive-analytics?${p.toString()}`;
}
export function drivePlanPath(requisitionId: string, from?: string | null, days?: number | null): string {
  const p = new URLSearchParams();
  p.set("requisitionId", requisitionId);
  if (from) p.set("from", from);
  if (days != null && Number.isFinite(days)) p.set("days", String(Math.trunc(days)));
  return `/api/he/drive-plan?${p.toString()}`;
}

// ---- formatting --------------------------------------------------------------------------------------------------------------------------
/** Whole percent of a fraction; null or a non-finite value gives an en dash. */
export function pctText(r: number | null): string {
  if (r === null || typeof r !== "number" || !Number.isFinite(r)) return DASH;
  return `${Math.round(r * 100) + 0}%`;
}
/** A count with thousands commas ("1,234"); a non-finite value gives an en dash. */
export function countText(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return DASH;
  const whole = String(Math.abs(Math.round(n)));
  const parts: string[] = [];
  for (let end = whole.length; end > 0; end -= 3) parts.unshift(whole.slice(Math.max(0, end - 3), end));
  return `${n < 0 && Math.round(n) !== 0 ? "-" : ""}${parts.join(",")}`;
}
const safe = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const dayWord = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;

// ---- KPI tiles ---------------------------------------------------------------------------------------------------------------------------
export interface ChangeArrow { delta: number; direction: "up" | "down" | "flat"; icon: "arrow-up" | "arrow-down" | "minus"; text: string }
export interface KpiTile {
  sourceType: SourceType; label: string;
  values: Array<{ stage: Stage; label: string; value: number; text: string }>;
  arrivalsChange: ChangeArrow; sparkline: number[];
}

/** Number + icon + words, never colour alone. Text uses the window's day count. */
export function changeArrow(current: number, previous: number, days: number): ChangeArrow {
  const delta = Math.round(safe(current) - safe(previous));
  const span = `previous ${dayWord(Math.max(0, Math.round(safe(days))))}`;
  if (delta > 0) return { delta, direction: "up", icon: "arrow-up", text: `+${delta} vs ${span}` };
  if (delta < 0) return { delta, direction: "down", icon: "arrow-down", text: `${delta} vs ${span}` };
  return { delta: 0, direction: "flat", icon: "minus", text: `no change vs ${span}` };
}

/** The previous period could not be read: no comparison (a change against zeros would read as a rise). */
const UNKNOWN_CHANGE: ChangeArrow = { delta: 0, direction: "flat", icon: "minus", text: DASH };

export function kpiTiles(a: DriveAnalytics): KpiTile[] {
  const noPrevious = Array.isArray(a?.failedSections) && a.failedSections.includes("previous");
  return SOURCE_TYPES.map((t) => {
    const ty = a.types?.[t];
    const cur = ty?.stages, prev = ty?.previous;
    return {
      sourceType: t, label: TYPE_LABEL[t],
      values: STAGES.map((stage) => { const value = safe(cur?.[stage]); return { stage, label: STAGE_LABEL[stage], value, text: countText(value) }; }),
      arrivalsChange: noPrevious ? { ...UNKNOWN_CHANGE } : changeArrow(safe(cur?.arrived), safe(prev?.arrived), safe(a.window?.days)),
      sparkline: (ty?.sparkline ?? []).map(safe),
    };
  });
}

// ---- compare table -----------------------------------------------------------------------------------------------------------------------
export const COMPARE_COLUMNS: ReadonlyArray<{ key: string; label: string; kind: "count" | "rate" | "money" }> = [
  { key: "leads", label: "Leads", kind: "count" },
  { key: "qualified", label: "Qualified", kind: "count" },
  { key: "invited", label: "Invited", kind: "count" },
  { key: "confirmed", label: "Confirmed", kind: "count" },
  { key: "arrived", label: "Arrived", kind: "count" },
  { key: "selected", label: "Selected", kind: "count" },
  { key: "joined", label: "Joined", kind: "count" },
  { key: "showRate", label: "Show rate", kind: "rate" },
  { key: "leadToJoin", label: "Lead to join", kind: "rate" },
];
export const COST_CELLS = [["cost_per_lead", "perLead"], ["cost_per_qualified", "perQualified"], ["cost_per_arrival", "perArrival"], ["cost_per_join", "perJoin"]] as const;
/** The per-type cost block, or null while cost is unavailable (placeholder, off, or no source). */
export function costOf(a: DriveAnalytics): Record<SourceType, TypeCost> | null {
  const c = a?.cost as Partial<CostBlock> | undefined;
  return c && c.available === true && c.byType && typeof c.byType === "object" ? c.byType : null;
}
export interface CompareRow { sourceType: SourceType; label: string; cells: Record<string, number | null> }

const rateOrNull = (n: number, d: number): number | null => (d > 0 && Number.isFinite(n / d) ? n / d : null);

/** Always three rows (Live Meta, Old Meta data, Hiring Engine), zeroed when a type has no data. */
export function compareRows(a: DriveAnalytics): CompareRow[] {
  return SOURCE_TYPES.map((t) => {
    const s = a.types?.[t]?.stages;
    const cells: Record<string, number | null> = {};
    for (const stage of STAGES) cells[stage] = safe(s?.[stage]);
    cells.showRate = rateOrNull(safe(s?.arrived), safe(s?.confirmed));
    cells.leadToJoin = rateOrNull(safe(s?.joined), safe(s?.leads));
    const c = costOf(a)?.[t]; // money cells exist only while cost is available, so today's cells are unchanged
    if (c) for (const [key, field] of COST_CELLS) cells[key] = typeof c[field] === "number" && Number.isFinite(c[field]) ? (c[field] as number) : null;
    return { sourceType: t, label: TYPE_LABEL[t], cells };
  });
}

/** Stable sort on one column; null cells go last in both directions. A copy is returned. */
export function sortCompareRows(rows: CompareRow[], key: string, dir: "asc" | "desc"): CompareRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = x.cells[key], b = y.cells[key];
    const an = typeof a !== "number" || !Number.isFinite(a), bn = typeof b !== "number" || !Number.isFinite(b);
    if (an || bn) return an === bn ? 0 : an ? 1 : -1;
    return (a - b) * sign;
  });
}

// ---- CSV ---------------------------------------------------------------------------------------------------------------------------------
const FORMULA_STARTS = ["=", "+", "-", "@", "\t", "\r"];
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (FORMULA_STARTS.some((c) => s.startsWith(c))) s = `'${s}`;
  const needsQuotes = s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r");
  return needsQuotes ? `"${s.replaceAll("\"", "\"\"")}"` : s;
}
/** UTF-8 BOM, CRLF line ends, quoted when needed, formula-looking text neutralised with a leading apostrophe; numbers stay numeric. */
export function toCsv(columns: ReadonlyArray<{ key: string; label: string }>, rows: Array<Record<string, string | number | null>>): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.key])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ---- failed sections --------------------------------------------------------------------------------------------------------------------
/** Short words for the section ids the Command Center endpoints flag as failed; an unknown id is shown as it is. */
const SECTION_LABEL: Record<string, string> = {
  requisitions: "requisition list", sources: "lead sources", drives: "drive numbers", outcomes: "selections and joins", stops: "follow-up stops",
  replies: "reply times", arrivals: "arrival times", previous: "previous period", insights: "suggestions", streams: "streams", groups: "drive rows",
  header: "requisition details", lined: "people lined up", rates: "show rates", pool: "remaining pool", plan: "daily plan", preview: "tonight's dry run",
  cost: "cost per source", "cost:rates": "cost rates", "cost:spend": "Meta ad spend", "cost:messages": "message counts", "cost:calls": "call counts",
  planned: "already planned days", calibration: "calibrated show rates", readiness: "readiness checks",
  "insight:contact": "contact timing", "insight:reminders": "reminders", "insight:distance": "travel distance", "insight:channel": "message delivery",
  "insight:language": "message language", "insight:slots": "slot bookings", "insight:sources": "source comparison", "insight:plan": "planning facts",
  "insight:tomorrow": "tomorrow's plan", "insight:streams": "stream pools", responses: "answers by channel",
};
export function sectionLabels(ids: readonly string[] | null | undefined): string[] {
  return [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x !== "").map((x) => SECTION_LABEL[x] ?? x))];
}
