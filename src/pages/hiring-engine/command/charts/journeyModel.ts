/**
 * Pure view-models of the full-journey funnel: one drive (form fill or lead to joined) and the three drives side by side. Counts come
 * from `journey` (the events-based persons read) for the pre-drive and contact stages and from `types` for selected / joined (the drive
 * credit rule). A rate is shown only when the stage it starts from has MIN_SAMPLE people and the later stage is not larger (people who
 * did not pass through the earlier stage, e.g. Old Meta leads contacted from older form fills). The table and the CSV are built from the
 * same rows (parity). No DOM, no regex literals.
 */
import type { DriveAnalytics, JourneyCounts, SourceType } from "../driveCommandTypes";
import { SOURCE_TYPES, TYPE_LABEL, countText, pctText, toCsv } from "../driveCommandModel";
import type { TextTable } from "../driveChartModel";

/** Mirrors the backend insight.min_sample default: below it a rate is noise. */
export const MIN_SAMPLE = 20;
export const DASH = "–";
export type JourneyKey = "leads" | "fills" | "screened" | "qualified" | "contacted" | "invited" | "replied" | "confirmed" | "arrived" | "selected" | "joined";
export const JOURNEY_KEYS: readonly JourneyKey[] = ["leads", "fills", "screened", "qualified", "contacted", "invited", "replied", "confirmed", "arrived", "selected", "joined"];
export const JOURNEY_LABEL: Record<JourneyKey, string> = {
  leads: "Leads", fills: "Form fills", screened: "Screened", qualified: "Qualified", contacted: "Contacted", invited: "Slot given / invited",
  replied: "Replied", confirmed: "Confirmed", arrived: "Arrived", selected: "Selected", joined: "Joined",
};
export const JOURNEY_DEFINITIONS = "Leads: people with a form fill or any drive activity in range. Contacted: any email, WhatsApp or call sent. "
  + "Replied: invited people who replied or confirmed. Selected and joined count only people who arrived at a drive.";
export const SAMPLE_NOTE = `Percentages need at least ${MIN_SAMPLE} people at the stage they start from; smaller steps show counts only.`;
export const SUBSET_NOTE = "Some stages count people who did not all pass through the stage before (for example people contacted whose form fill is older than this range); those steps show no rate.";
const HE_START = "Hiring Engine has no form fill or screening, so its funnel starts at Leads: people lined up on a drive or messaged in this range.";
const NO_JOURNEY = "Form fills, screening, contact and replies are not available from this server yet, so only the main stages are shown.";
const FAILED_JOURNEY = "Form fills, screening, contact and replies could not be read this time (see the banner above), so only the main stages are shown.";

const fin = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const rateOf = (n: number, d: number): number | null => (d >= MIN_SAMPLE && n <= d ? n / d : null);

export interface JourneyRow {
  key: JourneyKey; label: string; count: number; countText: string;
  fromPrev: number | null; fromPrevText: string; fromStart: number | null; fromStartText: string;
  dropOff: number | null; dropOffText: string; notSubset: boolean;
}
export interface DriveJourney {
  type: SourceType; label: string; rows: JourneyRow[]; start: JourneyKey | null; notes: string[]; empty: boolean;
  biggestDrop: { from: JourneyKey; to: JourneyKey; lost: number } | null; table: TextTable; aria: string;
}

/** The stages that exist for a drive type, with their counts. */
function stagesOf(a: DriveAnalytics, type: SourceType): { list: Array<{ key: JourneyKey; label: string; count: number }>; notes: string[] } {
  const s = a?.types?.[type]?.stages;
  const j: JourneyCounts | undefined = a?.journey ? a.journey[type] : undefined;
  const tracked = a?.qualifiedTracked !== false;
  const notes: string[] = [];
  const list: Array<{ key: JourneyKey; label: string; count: number }> = [];
  const add = (key: JourneyKey, count: unknown, label = JOURNEY_LABEL[key]) => list.push({ key, label, count: fin(count) });
  const meta = type !== "he";
  if (j) {
    add("leads", j.leads);
    if (meta) { add("fills", j.fills); add("screened", j.screened); add("qualified", j.qualified, "Qualified (screening)"); }
    else {
      notes.push(HE_START);
      if (tracked) add("qualified", s?.qualified, "Qualified (follow-up)");
    }
    add("contacted", j.contacted); add("invited", j.invited); add("replied", j.replied); add("confirmed", j.confirmed); add("arrived", j.arrived);
  } else {
    notes.push(a?.journey === null ? FAILED_JOURNEY : NO_JOURNEY);
    add("leads", s?.leads);
    if (tracked) add("qualified", s?.qualified);
    add("invited", s?.invited); add("confirmed", s?.confirmed); add("arrived", s?.arrived);
  }
  add("selected", s?.selected); add("joined", s?.joined);
  return { list, notes };
}

export function driveJourney(a: DriveAnalytics, type: SourceType): DriveJourney {
  const { list, notes } = stagesOf(a, type);
  const start = list[0]?.count ?? 0;
  let small = false, odd = false;
  const rows: JourneyRow[] = list.map((st, i) => {
    const prev = i > 0 ? list[i - 1].count : null;
    const notSubset = prev !== null && st.count > prev;
    const fromPrev = prev === null ? null : rateOf(st.count, prev);
    const fromStart = i === 0 ? null : rateOf(st.count, start);
    if (prev !== null && prev > 0 && prev < MIN_SAMPLE && !notSubset) small = true;
    if (notSubset) odd = true;
    const dropOff = prev === null || notSubset ? null : prev - st.count;
    return {
      key: st.key, label: st.label, count: st.count, countText: countText(st.count),
      fromPrev, fromPrevText: i === 0 ? DASH : pctText(fromPrev), fromStart, fromStartText: i === 0 ? DASH : pctText(fromStart),
      dropOff, dropOffText: dropOff === null ? DASH : countText(dropOff), notSubset,
    };
  });
  if (small) notes.push(SAMPLE_NOTE);
  if (odd) notes.push(SUBSET_NOTE);
  let biggestDrop: DriveJourney["biggestDrop"] = null;
  rows.forEach((r, i) => { if (i > 0 && r.dropOff !== null && r.dropOff > 0 && (!biggestDrop || r.dropOff > biggestDrop.lost)) biggestDrop = { from: rows[i - 1].key, to: r.key, lost: r.dropOff }; });
  const empty = rows.every((r) => r.count === 0);
  const label = TYPE_LABEL[type];
  const table: TextTable = {
    caption: `${label} journey: people at each stage, conversion from the stage before and from the start, and people lost at each step`,
    columns: ["Stage", "People", "From previous stage", "From start", "Drop-off"],
    rows: rows.map((r) => [r.label, r.countText, r.fromPrevText, r.fromStartText, r.dropOffText]),
  };
  const bd = biggestDrop as DriveJourney["biggestDrop"];
  const aria = empty ? `${label} journey: no people in this range` : `${label} journey from ${rows[0].label} (${rows[0].countText}) to ${rows[rows.length - 1].label} (${rows[rows.length - 1].countText}).`
    + (bd ? ` Largest loss: ${JOURNEY_LABEL[bd.from]} to ${JOURNEY_LABEL[bd.to]}, ${countText(bd.lost)} people.` : "");
  return { type, label, rows, start: list[0]?.key ?? null, notes, empty, biggestDrop: bd, table, aria };
}

// ---- comparison --------------------------------------------------------------------------------------------------------------------------
export type Level = "high" | "low";
export interface CompareCell {
  count: number | null; countText: string; rate: number | null; rateText: string; startText: string; dropText: string;
  level: Level | null; levelText: "" | "Highest" | "Lowest";
}
export interface CompareRowView { key: JourneyKey; label: string; cells: Record<SourceType, CompareCell> }
export interface JourneyCompareView { rows: CompareRowView[]; journeys: Record<SourceType, DriveJourney>; empty: boolean; aria: string }
const NA: CompareCell = { count: null, countText: "n/a", rate: null, rateText: "", startText: "", dropText: "", level: null, levelText: "" };

export function journeyCompare(a: DriveAnalytics): JourneyCompareView {
  const journeys = {} as Record<SourceType, DriveJourney>;
  for (const t of SOURCE_TYPES) journeys[t] = driveJourney(a, t);
  const keys = JOURNEY_KEYS.filter((k) => SOURCE_TYPES.some((t) => journeys[t].rows.some((r) => r.key === k)));
  const rows = keys.map((key): CompareRowView => {
    const cells = {} as Record<SourceType, CompareCell>;
    for (const t of SOURCE_TYPES) {
      const r = journeys[t].rows.find((x) => x.key === key);
      cells[t] = r ? { count: r.count, countText: r.countText, rate: r.fromPrev, rateText: r.fromPrevText, startText: r.fromStartText, dropText: r.dropOffText, level: null, levelText: "" } : { ...NA };
    }
    // Highest / lowest step conversion, compared on the whole percent shown (10% vs 10% is a tie, not a winner).
    const rated = SOURCE_TYPES.filter((t) => cells[t].rate !== null).map((t) => ({ t, p: Math.round((cells[t].rate as number) * 100) }));
    if (rated.length >= 2) {
      const hi = Math.max(...rated.map((x) => x.p)), lo = Math.min(...rated.map((x) => x.p));
      if (hi > lo) for (const x of rated) {
        if (x.p === hi) cells[x.t] = { ...cells[x.t], level: "high", levelText: "Highest" };
        else if (x.p === lo) cells[x.t] = { ...cells[x.t], level: "low", levelText: "Lowest" };
      }
    }
    const label = key === "qualified" ? "Qualified" : JOURNEY_LABEL[key];
    return { key, label, cells };
  });
  const empty = SOURCE_TYPES.every((t) => journeys[t].empty);
  const gaps = rows.flatMap((r) => {
    const hi = SOURCE_TYPES.find((t) => r.cells[t].level === "high"), lo = SOURCE_TYPES.find((t) => r.cells[t].level === "low");
    return hi && lo ? [`${r.label}: highest ${TYPE_LABEL[hi]} ${r.cells[hi].rateText}, lowest ${TYPE_LABEL[lo]} ${r.cells[lo].rateText}`] : [];
  });
  const aria = empty ? "Funnel comparison: no people in this range" : `Funnel comparison of ${SOURCE_TYPES.length} drives across ${rows.length} stages.${gaps.length ? ` ${gaps.join(". ")}.` : ""}`;
  return { rows, journeys, empty, aria };
}

// ---- CSV ---------------------------------------------------------------------------------------------------------------------------------
export function journeyCsvColumns(): Array<{ key: string; label: string }> {
  return [{ key: "stage", label: "Stage" }, ...SOURCE_TYPES.flatMap((t) => [
    { key: `${t}.people`, label: `${TYPE_LABEL[t]} people` }, { key: `${t}.prev`, label: `${TYPE_LABEL[t]} from previous` },
    { key: `${t}.start`, label: `${TYPE_LABEL[t]} from start` }, { key: `${t}.drop`, label: `${TYPE_LABEL[t]} drop-off` },
  ])];
}
const textOrNull = (s: string): string | null => (s === "" || s === DASH || s === "n/a" ? null : s);
export function journeyCsvRows(v: JourneyCompareView): Array<Record<string, string | number | null>> {
  return v.rows.map((r) => {
    const out: Record<string, string | number | null> = { stage: r.label };
    for (const t of SOURCE_TYPES) {
      const c = r.cells[t];
      out[`${t}.people`] = c.count; out[`${t}.prev`] = textOrNull(c.rateText); out[`${t}.start`] = textOrNull(c.startText);
      const drop = v.journeys[t].rows.find((x) => x.key === r.key)?.dropOff;
      out[`${t}.drop`] = drop === undefined ? null : drop;
    }
    return out;
  });
}
export function journeyCsv(a: DriveAnalytics): string { return toCsv(journeyCsvColumns(), journeyCsvRows(journeyCompare(a))); }
export function journeyCsvName(a: DriveAnalytics): string { return `drive-funnel-comparison-${a?.window?.from ?? "from"}-to-${a?.window?.to ?? "to"}.csv`; }

/** Heat tint step of a conversion (0 lowest .. 3 highest); null when there is no rate. The number is always printed as text too. */
export function heatBucket(rate: number | null): 0 | 1 | 2 | 3 | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  return rate >= 0.75 ? 3 : rate >= 0.5 ? 2 : rate >= 0.25 ? 1 : 0;
}
