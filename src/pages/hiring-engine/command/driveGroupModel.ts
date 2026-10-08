/**
 * Pure view-model of the grouped drive rows (one row per requisition, branch and drive type): window text, collapsed totals,
 * the day-wise table across the whole window, trend chart series with their text tables (one adapter, so chart and table agree),
 * section filtering/sorting/paging and the extension history lines. No I/O, no React, no regex literals.
 */
import type { DriveGroup, SourceType, StreamAction, StreamEvent, TrendPoint } from "./driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL, pctText, countText } from "./driveCommandModel";
import { dayLabel } from "./driveChartModel";
import type { ChartOpts, TextTable } from "./driveChartModel";
import { chartMotion } from "./chartTheme";

const DASH = "–";
export const PAGE_SIZE = 25;

const safe = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const rate = (arrived: number, confirmed: number): number | null => (confirmed > 0 ? arrived / confirmed : null);

// ---- window -----------------------------------------------------------------------------------------------------------------------------
export type WindowState = "upcoming" | "running" | "ended";
export function windowState(g: Pick<DriveGroup, "window">, today: string): WindowState {
  const w = g?.window;
  if (!w || !(w.days > 0)) return "ended";
  if (today < w.from) return "upcoming";
  return today > w.to ? "ended" : "running";
}

/** Same wording as the Plan 3 windowLabel. */
export function windowText(g: Pick<DriveGroup, "window">, today: string): string {
  const w = g?.window;
  if (!w || !(w.days > 0)) return "no drive days";
  const s = windowState(g, today);
  if (s === "running") return `day ${w.dayIndex} of ${w.days}, ends ${dayLabel(w.to)}`;
  if (s === "upcoming") return `starts ${dayLabel(w.from)}, ${w.days} ${w.days === 1 ? "day" : "days"}`;
  return `ended ${dayLabel(w.to)}`;
}

export const STATE_LABEL: Record<WindowState, string> = { upcoming: "Upcoming", running: "Running", ended: "Ended" };

// ---- collapsed row ----------------------------------------------------------------------------------------------------------------------
/** Window totals, except the show rate: arrived over confirmed on the days up to `today` only (later days have confirmations but no arrivals yet). */
export function collapsedCells(g: DriveGroup, today: string): Array<{ label: string; value: string }> {
  const t = g?.totals;
  let arrivedSoFar = 0;
  let confirmedSoFar = 0;
  for (const d of Array.isArray(g?.days) ? g.days : []) {
    if (d.date > today) continue;
    arrivedSoFar += safe(d.arrived);
    confirmedSoFar += safe(d.confirmed);
  }
  return [
    { label: "Wanted", value: countText(safe(t?.wanted)) },
    { label: "Lined up", value: countText(safe(t?.lined)) },
    { label: "Invited", value: countText(safe(t?.invited)) },
    { label: "Confirmed", value: countText(safe(t?.confirmed)) },
    { label: "Arrived", value: countText(safe(t?.arrived)) },
    { label: "Did not come", value: countText(safe(t?.noShow)) },
    { label: "Declined", value: countText(safe(t?.declined)) },
    { label: "Show rate so far", value: pctText(rate(arrivedSoFar, confirmedSoFar)) },
  ];
}

// ---- day table --------------------------------------------------------------------------------------------------------------------------
export const DAY_COLUMNS = ["Date", "Status", "Wanted", "Lined up", "Invited", "Confirmed", "Arrived", "Did not come", "Declined", "Show rate"] as const;

export interface DayRow { date: string; label: string; isToday: boolean; future: boolean; cells: string[] }
const statusText = (v: unknown): string => (typeof v === "string" && v ? v.split("_").join(" ") : DASH);
/** One line per drive date across the whole window. A future day shows wanted, lined up, invited and confirmed; arrived, did not come, declined and the show rate are en dashes. */
export function dayRows(points: TrendPoint[], today: string): DayRow[] {
  return (Array.isArray(points) ? points : []).map((p) => {
    const future = p.date > today;
    const past = (v: unknown): string => (future ? DASH : countText(safe(v)));
    return {
      date: p.date, label: dayLabel(p.date), isToday: p.date === today, future,
      cells: [
        statusText(p.status), countText(safe(p.wanted)), countText(safe(p.lined)), countText(safe(p.invited)), countText(safe(p.confirmed)),
        past(p.arrived), past(p.noShow), past(p.declined), future ? DASH : pctText(rate(safe(p.arrived), safe(p.confirmed))),
      ],
    };
  });
}

// ---- trend series -----------------------------------------------------------------------------------------------------------------------
export interface CountPoint { date: string; label: string; invited: number; confirmed: number; arrived: number | null; wanted: number }
export interface RatePoint { date: string; label: string; pct: number }
export interface RateChartPoint { date: string; label: string; pct: number | null }
/** One entry per point (zero-filled days included); pct is a whole percent, 0 when nobody confirmed. With `today`, arrived is null on days still to come. */
export function trendSeries(points: TrendPoint[], today?: string): { counts: CountPoint[]; showRate: RatePoint[] } {
  const list = Array.isArray(points) ? points : [];
  return {
    counts: list.map((p) => ({
      date: p.date, label: dayLabel(p.date), invited: safe(p.invited), confirmed: safe(p.confirmed),
      arrived: today !== undefined && p.date > today ? null : safe(p.arrived), wanted: safe(p.wanted),
    })),
    showRate: list.map((p) => ({ date: p.date, label: dayLabel(p.date), pct: Math.round((rate(safe(p.arrived), safe(p.confirmed)) ?? 0) * 100) })),
  };
}

export interface TrendView {
  empty: boolean;
  /** Drive days exist but none has happened yet. */
  noneYet: boolean;
  type: SourceType;
  counts: CountPoint[];
  /** Past days and today only; a day with nobody confirmed has pct null (a gap in the line, a dash in the table). */
  showRate: RateChartPoint[];
  motion: ReturnType<typeof chartMotion>;
  countsTable: TextTable;
  rateTable: TextTable;
}
/** Chart inputs and their text alternatives, all derived from trendSeries so the tables show exactly what the charts draw. */
export function trendView(points: TrendPoint[], type: SourceType, today: string, opts?: ChartOpts): TrendView {
  const s = trendSeries(points, today);
  const confirmedBy = new Map((Array.isArray(points) ? points : []).map((p) => [p.date, safe(p.confirmed)]));
  const showRate: RateChartPoint[] = s.showRate.filter((r) => r.date <= today).map((r) => ({ ...r, pct: (confirmedBy.get(r.date) ?? 0) > 0 ? r.pct : null }));
  const label = TYPE_LABEL[type] ?? "Drive";
  return {
    empty: s.counts.length === 0, noneYet: s.counts.length > 0 && showRate.length === 0, type, counts: s.counts, showRate, motion: chartMotion(opts?.prefersReducedMotion === true),
    countsTable: {
      caption: `${label}: invited, confirmed and arrived each drive day, with the wanted number`,
      columns: ["Date", "Invited", "Confirmed", "Arrived", "Wanted"],
      rows: s.counts.map((c) => [c.label, String(c.invited), String(c.confirmed), c.arrived === null ? DASH : String(c.arrived), String(c.wanted)]),
    },
    rateTable: {
      caption: `${label}: show rate (arrived of confirmed) each drive day so far`,
      columns: ["Date", "Show rate"],
      rows: showRate.map((r) => [r.label, r.pct === null ? DASH : `${r.pct}%`]),
    },
  };
}

// ---- sections ---------------------------------------------------------------------------------------------------------------------------
const typeRank = (t: SourceType): number => { const i = SOURCE_TYPES.indexOf(t); return i < 0 ? SOURCE_TYPES.length : i; };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Requisition code, then branch, then drive type. Does not mutate. */
export function sortGroups(groups: DriveGroup[]): DriveGroup[] {
  return [...(Array.isArray(groups) ? groups : [])].sort((a, b) =>
    cmp(String(a.requisition ?? ""), String(b.requisition ?? "")) || cmp(String(a.branch ?? ""), String(b.branch ?? "")) || typeRank(a.sourceType) - typeRank(b.sourceType));
}
export function groupsForSection(groups: DriveGroup[], t: SourceType): DriveGroup[] {
  return sortGroups((Array.isArray(groups) ? groups : []).filter((g) => g?.sourceType === t));
}

export function page<T>(rows: T[], pageIndex: number, size: number = PAGE_SIZE): { rows: T[]; pages: number } {
  const list = Array.isArray(rows) ? rows : [];
  const n = Number.isFinite(size) && size >= 1 ? Math.floor(size) : PAGE_SIZE;
  const i = Number.isFinite(pageIndex) && pageIndex > 0 ? Math.floor(pageIndex) : 0;
  return { rows: list.slice(i * n, (i + 1) * n), pages: Math.ceil(list.length / n) };
}

export const SECTION_EMPTY: Record<SourceType, string> = {
  meta_live: "No live Meta stream is running for this slice",
  meta_old: "No old-data re-run in this slice",
  he: "No pool drives in this slice",
};

// ---- paths and stable keys --------------------------------------------------------------------------------------------------------------
export function trendPath(g: Pick<DriveGroup, "requisitionId" | "branch" | "sourceType">): string {
  const p = new URLSearchParams();
  p.set("requisitionId", g.requisitionId);
  p.set("branch", g.branch);
  p.set("sourceType", g.sourceType);
  return `/api/he/drive-trend?${p.toString()}`;
}
export function eventsPath(streamId: string): string { return `/api/he/requisition-streams/${encodeURIComponent(streamId)}/events`; }
export function groupKey(g: Pick<DriveGroup, "requisitionId" | "branch" | "sourceType">): string { return `${g.requisitionId}|${g.branch}|${g.sourceType}`; }

// ---- extension history ------------------------------------------------------------------------------------------------------------------
const ACTION_WORDS: Record<StreamAction, string> = {
  create: "Created", open: "Opened", pause: "Paused", close: "Closed", reopen: "Reopened", extend: "Extended", extend_to: "Extended to a date",
  add_day: "Added a day", skip_day: "Skipped a day", shorten: "Shortened", auto_close: "Closed automatically",
};
export function actionWords(a: string): string { return ACTION_WORDS[a as StreamAction] ?? String(a ?? "").split("_").join(" "); }

/** "Wed 14 Oct · Extended · 5 to 7 days · reason"; missing parts are left out. */
export function eventLine(e: StreamEvent): string {
  const parts = [dayLabel(String(e.changedAt ?? "").slice(0, 10)), actionWords(e.action) + (e.day ? ` (${dayLabel(e.day)})` : "")];
  if (typeof e.oldOpenDays === "number" && typeof e.newOpenDays === "number" && e.oldOpenDays !== e.newOpenDays) parts.push(`${e.oldOpenDays} to ${e.newOpenDays} days`);
  if (typeof e.reason === "string" && e.reason.trim()) parts.push(e.reason.trim());
  return parts.join(" · ");
}
/** Events of all the group's streams, newest first (stable for equal times). */
export function mergeEvents(lists: StreamEvent[][]): StreamEvent[] {
  return lists.flat().map((e, i) => ({ e, i })).sort((a, b) => cmp(String(b.e.changedAt ?? ""), String(a.e.changedAt ?? "")) || a.i - b.i).map((x) => x.e);
}
