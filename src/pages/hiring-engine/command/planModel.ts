/**
 * Pure view-model of the Plan section: what-if recomputation (no save, no network), fill levels of the calendar, the Plan now summary,
 * the requisition pick list and the row texts of every table. The maths is planMath.ts (a tested copy of the backend he-drive-plan.ts).
 * No React, no I/O, no regex literals (Tailwind scans source text).
 */
import { dayLabel } from "./driveChartModel";
import { TYPE_LABEL, pctText } from "./driveCommandModel";
import type { ChecklistItem, DriveGroup, DrivePlan, PlanDay, PlanStreamLine, StreamDayPlan, StreamLine, StreamRate } from "./driveCommandTypes";
import { planDay, type PlanDayInput } from "./planMath";

// ---- what-if -------------------------------------------------------------------------------------------------------------------------------
/** A user's edit of one stream: daily quota (people lined up, 0..500) and assumed show rate in percent (0..100). */
export interface WhatIf { quota?: number; showRate?: number }
export const QUOTA_MAX = 500;
export const NOT_OPEN = "Not open on this day"; // the backend's reasoning for a stream that does not cover the day

/** The server's covers flag (he-drive-plan.ts planDay). A line without a boolean flag counts as covering. */
export const coversDay = (s: Partial<Pick<PlanStreamLine, "covers">>): boolean => s.covers !== false;

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Quota as a whole number 0..500; null when not a number (the edit is ignored). */
export function clampQuota(v: unknown): number | null { const n = finite(v); return n === null ? null : Math.min(QUOTA_MAX, Math.max(0, Math.round(n))); }
/** Show rate in percent 0..100; null when not a number. */
export function clampShowRate(v: unknown): number | null { const n = finite(v); return n === null ? null : Math.min(100, Math.max(0, Math.round(n))); }

export interface Recomputed { expected: number; seatsUsed: number; gap: number; streams: Array<{ streamId: string; lined: number; rate: number; expected: number }> }

/**
 * The day with the user's edits, through the same planDay maths as the server: without edits it reproduces the server's numbers
 * (expected, gap and seats, including the seats and expected arrivals of people no stream owns). A stream's lined becomes its quota; its rate the show rate / 100.
 */
export function recomputeDay(d: PlanDay, overrides: Record<string, WhatIf>): Recomputed {
  const lines = Array.isArray(d?.streams) ? d.streams : [];
  const linedSum = lines.reduce((a, s) => a + (finite(s.lined) ?? 0), 0);
  // The response does not carry the unowned people separately: their seats and arrivals are what the day holds beyond its streams.
  const streamExpected = lines.reduce((a, s) => a + (coversDay(s) ? (finite(s.lined) ?? 0) * (finite(s.rate) ?? 0) : 0), 0);
  const input: PlanDayInput = {
    date: d.date, driveId: d.driveId, target: d.target, capacity: d.capacity,
    extraSeatsUsed: Math.max(0, (finite(d.seatsUsed) ?? 0) - linedSum),
    extraExpected: Math.max(0, (finite(d.expected) ?? 0) - streamExpected),
    streams: lines.map((s) => {
      const o = overrides?.[s.streamId] ?? {};
      const quota = clampQuota(o.quota), show = clampShowRate(o.showRate);
      return {
        streamId: s.streamId, sourceType: s.sourceType, label: s.label, cap: s.cap, lined: quota ?? s.lined, poolRemaining: null, covers: coversDay(s),
        rate: { streamId: s.streamId, sourceType: s.sourceType, invited: 0, arrived: 0, rate: show === null ? s.rate : show / 100, basis: s.basis },
      };
    }),
  };
  const out = planDay(input);
  const by = new Map(out.streams.map((s) => [s.streamId, s]));
  return {
    expected: out.expected, seatsUsed: out.seatsUsed, gap: out.gap,
    streams: lines.map((s) => { const r = by.get(s.streamId); return { streamId: s.streamId, lined: r?.lined ?? 0, rate: r?.rate ?? 0, expected: r?.expected ?? 0 }; }),
  };
}

/** True when at least one usable edit is present (the Reset button is enabled). */
export function hasEdits(overrides: Record<string, WhatIf>): boolean {
  return Object.values(overrides ?? {}).some((o) => clampQuota(o?.quota) !== null || clampShowRate(o?.showRate) !== null);
}

const num1 = (v: number): string => String(Math.round((finite(v) ?? 0) * 10) / 10);

/** The live-region sentence after an edit. */
export function whatIfAnnouncement(d: PlanDay, r: Recomputed): string {
  return `${dayLabel(d.date)} with your changes: expected ${num1(r.expected)} arrivals for a target of ${num1(d.target)}, gap ${num1(r.gap)}, seats used ${r.seatsUsed} of ${d.capacity}`;
}

/** Slider values of one stream (edit or the server's value). */
export function sliderValues(s: PlanStreamLine, o: WhatIf | undefined): { quota: number; showRate: number } {
  return { quota: clampQuota(o?.quota) ?? clampQuota(s.lined) ?? 0, showRate: clampShowRate(o?.showRate) ?? clampShowRate((finite(s.rate) ?? 0) * 100) ?? 0 };
}

// ---- calendar ------------------------------------------------------------------------------------------------------------------------------
export type FillWord = "empty" | "low" | "good" | "full" | "over";
/** 0 empty, under 25% low, under 75% good, up to 100% full, above over. `step` (0..4) picks the sequential shade. */
export function fillLevel(fill: number): { step: number; word: FillWord } {
  const f = finite(fill) ?? 0;
  if (f <= 0) return { step: 0, word: "empty" };
  if (f < 0.25) return { step: 1, word: "low" };
  if (f < 0.75) return { step: 2, word: "good" };
  if (f <= 1) return { step: 3, word: "full" };
  return { step: 4, word: "over" };
}

export interface CalendarView {
  days: Array<{ date: string; label: string }>;
  rows: Array<{ streamId: string; label: string; cells: Array<{ date: string; text: string; word: FillWord; step: number; open: boolean }> }>;
}

/** Rows = streams, columns = days. Cell text "<planned> / <capacity>" plus the day's fill word; a day the stream is closed says so. */
export function calendarView(plan: Pick<DrivePlan, "days" | "calendar">): CalendarView {
  const days = (plan?.days ?? []).map((d) => ({ date: d.date, label: dayLabel(d.date) }));
  const labels = new Map<string, string>();
  const open = new Set<string>();
  for (const d of plan?.days ?? []) for (const s of d.streams ?? []) {
    if (!labels.has(s.streamId)) labels.set(s.streamId, s.label || TYPE_LABEL[s.sourceType] || "Stream");
    if (coversDay(s)) open.add(`${d.date}|${s.streamId}`);
  }
  const cellBy = new Map((plan?.calendar ?? []).map((c) => [`${c.date}|${c.streamId}`, c]));
  const rows = [...labels].map(([streamId, label]) => ({
    streamId, label,
    cells: days.map(({ date }) => {
      const c = cellBy.get(`${date}|${streamId}`);
      const planned = finite(c?.planned) ?? 0, capacity = finite(c?.capacity) ?? 0;
      const lv = fillLevel(c?.fill ?? 0);
      return { date, text: `${planned} / ${capacity}`, word: lv.word, step: lv.step, open: open.has(`${date}|${streamId}`) };
    }),
  }));
  return { days, rows };
}

// ---- tables --------------------------------------------------------------------------------------------------------------------------------
export interface DayRow { date: string; label: string; target: string; expected: string; gap: string; seats: string; drive: string }
export function dayRows(plan: Pick<DrivePlan, "days">): DayRow[] {
  return (plan?.days ?? []).map((d) => ({
    date: d.date, label: dayLabel(d.date), target: num1(d.target), expected: num1(d.expected), gap: num1(d.gap),
    seats: `${finite(d.seatsUsed) ?? 0} / ${finite(d.capacity) ?? 0}`, drive: d.driveId ? "Drive exists" : "No drive yet",
  }));
}

/** Basis wording of a show rate; the weekday is optional because the label never names it (the reasoning column does). */
export function basisLabel(b: StreamRate["basis"], _weekday?: number): string {
  return b === "actual_weekday" ? "Same weekday, 14-day actual" : b === "actual" ? "14-day actual" : "Plan default";
}
export const CALIBRATION_NOTE = "Show rates are calibrated from the last 14 days (kept between 5% and 95%)";
export const NOT_ENOUGH_HISTORY = "Plan default (not enough history)";

export interface StreamRowView { streamId: string; label: string; typeLabel: string; lined: number; rate: string; basis: string; /** Calibration is on but this stream has too little history: shown as "Plan default (not enough history)". */ notEnough: boolean; expected: string; recommended: number; reasoning: string; open: boolean }
export function streamRows(d: PlanDay | null | undefined, calibrated = false): StreamRowView[] {
  return (d?.streams ?? []).map((s) => ({
    streamId: s.streamId, label: s.label || TYPE_LABEL[s.sourceType] || "Stream", typeLabel: TYPE_LABEL[s.sourceType] ?? "", lined: finite(s.lined) ?? 0,
    rate: pctText(finite(s.rate)), basis: basisLabel(s.basis), notEnough: calibrated && s.basis === "plan_default", expected: num1(s.expected),
    recommended: finite(s.recommended) ?? 0, reasoning: typeof s.reasoning === "string" && s.reasoning ? s.reasoning : "–", open: coversDay(s),
  }));
}

// ---- state ---------------------------------------------------------------------------------------------------------------------------------
export type PlanState = "pick" | "loading" | "error" | "empty" | "ready";
export const EMPTY_PLAN_TEXT = "No open streams for this requisition: nothing to plan";
export const PICK_LABEL = "Pick a requisition to plan";

/** Which body the section shows. Previous data stays visible while a reload runs or after a failed refresh. */
export function planState(o: { requisitionId: string | null; plan: DrivePlan | null; loading: boolean; error: string | null }): PlanState {
  if (!o.requisitionId) return "pick";
  if (!o.plan) return o.error && !o.loading ? "error" : "loading";
  const anyOpen = (o.plan.days ?? []).some((d) => (d.streams ?? []).some(coversDay));
  return anyOpen ? "ready" : "empty";
}

/** Requisitions worth planning: those with a Meta type or any stream, once each, by label. */
export function planPickList(groups: DriveGroup[]): Array<{ requisitionId: string; label: string }> {
  const seen = new Map<string, string>();
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g || typeof g.requisitionId !== "string" || !g.requisitionId || seen.has(g.requisitionId)) continue;
    const types = Array.isArray(g.types) && g.types.length ? g.types : [g.sourceType];
    if (!types.some((t) => t !== "he") && !(Array.isArray(g.streamIds) && g.streamIds.length > 0)) continue;
    const code = (g.requisition ?? "").trim() || g.requisitionId;
    const role = (g.role ?? "").trim();
    seen.set(g.requisitionId, role ? `${code} - ${role}` : code);
  }
  return [...seen].map(([requisitionId, label]) => ({ requisitionId, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ---- checklist and Plan now ------------------------------------------------------------------------------------------------------------------
export const CHECK_WORD: Record<ChecklistItem["kind"], string> = {
  will_plan: "Tonight", already_planned: "Planned", fill_soon: "Attention", stream_ends_tomorrow: "Attention", pool_below_quota: "Attention", readiness: "Attention",
};
/** Items grouped as the brief's three questions: what tonight's pass will do, what is already planned, what needs attention. */
export function checklistGroups(items: ChecklistItem[] | null | undefined): Array<{ id: "tonight" | "planned" | "attention"; title: string; items: ChecklistItem[] }> {
  const list = Array.isArray(items) ? items.filter((i) => i && typeof i.text === "string") : [];
  return [
    { id: "tonight" as const, title: "What tonight's pass will do", items: list.filter((i) => i.kind === "will_plan") },
    { id: "planned" as const, title: "Already planned", items: list.filter((i) => i.kind === "already_planned") },
    { id: "attention" as const, title: "Needs attention", items: list.filter((i) => i.kind !== "will_plan" && i.kind !== "already_planned") },
  ];
}

const sum = (lines: StreamLine[], f: (l: StreamLine) => number | undefined): number => lines.reduce((a, l) => a + (finite(f(l)) ?? 0), 0);
/** Dry run or real run: the caller's own flag when given (an all-failed dry run has no wouldLine), else read from the answer. */
const isDry = (p: StreamDayPlan, dryRun?: boolean): boolean => (typeof dryRun === "boolean" ? dryRun : (p.streams ?? []).some((l) => typeof l.wouldLine === "number") || p.drive === "would_create");

/** One line for a Plan now answer; pass `dryRun` (the request's flag) whenever it is known. */
export function planNowSummary(p: StreamDayPlan | null, dryRun?: boolean): string {
  if (!p) return "No open stream covers that day";
  const lines = Array.isArray(p.streams) ? p.streams : [];
  if (p.drive === "skipped") return `Skipped: ${p.reason || "no reason given"}`;
  if (p.drive === "would_create") return `Would create the drive for ${p.date} and line up ${sum(lines, (l) => l.wouldLine)} people`;
  if (p.drive === "exists") return isDry(p, dryRun) ? `Drive exists; would line up ${sum(lines, (l) => l.wouldLine)} more` : `Drive exists; lined up ${sum(lines, (l) => l.lined)} more`;
  const note = p.reason ? ` (${p.reason})` : "";
  return `Created the drive for ${p.date} and lined up ${sum(lines, (l) => l.lined)} people${note}`;
}

/** Per-stream result lines, with the skipped reason when a stream was skipped. */
export function planNowLines(p: StreamDayPlan | null, dryRun?: boolean): Array<{ streamId: string; label: string; text: string; skipped: boolean }> {
  if (!p) return [];
  const dry = isDry(p, dryRun);
  return (Array.isArray(p.streams) ? p.streams : []).map((l) => {
    const label = (l.originLabel || "").trim() || TYPE_LABEL[l.sourceType] || "Stream";
    if (l.skipped) return { streamId: l.streamId, label, text: `Skipped: ${l.skipped}`, skipped: true };
    const already = finite(l.alreadyLined) ?? 0, cap = finite(l.cap) ?? 0;
    const n = dry ? (finite(l.wouldLine) ?? 0) : (finite(l.lined) ?? 0);
    return { streamId: l.streamId, label, text: `${dry ? "would line up" : "lined up"} ${n} (already ${already}, quota ${cap})`, skipped: false };
  });
}

export const planNowPath = (requisitionId: string): string => `/api/he/requisitions/${encodeURIComponent(requisitionId)}/plan-now`;
export function planNowBody(date: string | null | undefined, dryRun: boolean): { dryRun: boolean; date?: string } {
  return date ? { dryRun, date } : { dryRun };
}

export function planNowConfirm(date: string, code: string): { title: string; body: string; confirm: string } {
  return {
    title: `Plan ${dayLabel(date)} now for ${code}?`,
    body: `This runs tonight's evening pass now for this requisition only: it creates or reuses the drive for ${dayLabel(date)} and lines up people from each open stream up to its quota. People already lined up are not added twice. Preview it first to see the numbers.`,
    confirm: "Plan now",
  };
}

export const PLAN_FORBIDDEN_TEXT = "You do not have permission to plan: it needs HR or admin access";
export const PLAN_GONE_TEXT = "This requisition is no longer visible to you; reload";
export const PLAN_GENERIC_TEXT = "Could not plan the day; try again";
/** 400 / 409 (e.g. "No open stream covers that day"): the server message verbatim; 403, 404 and anything else: fixed text. */
export function planNowErrorText(e: unknown): string {
  const err = (e && typeof e === "object" ? e : {}) as { status?: unknown; message?: unknown };
  const status = typeof err.status === "number" ? err.status : null;
  const message = typeof err.message === "string" ? err.message.trim() : "";
  if ((status === 400 || status === 409) && message) return message;
  if (status === 403) return PLAN_FORBIDDEN_TEXT;
  if (status === 404) return PLAN_GONE_TEXT;
  return PLAN_GENERIC_TEXT;
}
