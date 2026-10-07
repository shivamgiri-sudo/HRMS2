/**
 * Planning maths of the Drive Command Center "Plan" section. Pure: no I/O, so the same numbers can be recomputed for what-if edits.
 * The frontend cannot import backend modules (separate package; tsconfig.app.json includes only src/), so Task 15 keeps a copy of
 * planDay / whatIf in a src/ file; THIS file is the server's source of truth and the copy must be tested against the same table.
 *
 * Recommended invites are greedy: streams with the highest show rate first, each asking for invitesToClose(remaining gap, 0, rate),
 * capped by what is left of its audience (null = not measured, no cap) and by the seats left on the drive.
 * Every input is made finite and non-negative first, so NaN / Infinity never appear (a 0 show rate uses invitesToClose's 0.05 floor).
 */
import { invitesToClose } from "./he-showup.js";
import type { SourceType } from "./qualified-followup.types.js";

export interface StreamRate { streamId: string; sourceType: SourceType; invited: number; arrived: number; rate: number; basis: "actual" | "plan_default" }
export interface PlanStreamInput { streamId: string; sourceType: SourceType; label: string; cap: number; lined: number; rate: StreamRate; poolRemaining: number | null; covers: boolean }
export interface PlanStreamLine { streamId: string; sourceType: SourceType; label: string; cap: number; lined: number; expected: number; rate: number; basis: StreamRate["basis"]; recommended: number; reasoning: string; /** The stream is open on this day (reasoning "Not open on this day" otherwise). */ covers: boolean }
export interface PlanDay { date: string; driveId: string | null; target: number; capacity: number; seatsUsed: number; expected: number; gap: number; streams: PlanStreamLine[] }
export interface PlanDayInput { date: string; driveId: string | null; target: number; capacity: number; streams: PlanStreamInput[]; /** Seats held by people no stream owns (they are never assigned to a stream). */ extraSeatsUsed?: number }
export interface CalendarCell { date: string; streamId: string; planned: number; cap: number; capacity: number; fill: number }

/** A count: finite and not negative, else 0. */
const count = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const whole = (v: unknown): number => Math.floor(count(v));
const rateOf = (v: unknown, fallback = 0): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback; };
const round1 = (v: number): number => Math.round(v * 10) / 10;
/** "13", "8.2": one decimal, no trailing ".0". */
const text1 = (v: number): string => String(round1(v));

export function streamRate(o: { streamId: string; sourceType: SourceType; invited: number; arrived: number; planShowRate: number; minSample: number }): StreamRate {
  const invited = whole(o.invited), arrived = Math.min(whole(o.arrived), invited);
  const planDefault = rateOf(o.planShowRate);
  const enough = invited > 0 && invited >= Math.max(1, count(o.minSample));
  return {
    streamId: o.streamId, sourceType: o.sourceType, invited, arrived,
    rate: enough ? rateOf(arrived / invited) : planDefault, basis: enough ? "actual" : "plan_default",
  };
}

export function planDay(o: PlanDayInput): PlanDay {
  const target = count(o.target), capacity = whole(o.capacity);
  const ins = o.streams.map((s) => ({ ...s, cap: whole(s.cap), lined: whole(s.lined), rate: { ...s.rate, rate: rateOf(s.rate.rate) },
    poolRemaining: s.poolRemaining == null || !Number.isFinite(Number(s.poolRemaining)) ? null : whole(s.poolRemaining) }));
  const seatsUsed = ins.reduce((a, s) => a + s.lined, 0) + whole(o.extraSeatsUsed);
  const expectedOf = (s: (typeof ins)[number]): number => (s.covers ? s.lined * s.rate.rate : 0);
  const expected = round1(ins.reduce((a, s) => a + expectedOf(s), 0));
  const gap = round1(Math.max(0, target - expected));

  const order = [...ins].sort((a, b) => (a.covers === b.covers ? 0 : a.covers ? -1 : 1) || b.rate.rate - a.rate.rate || a.streamId.localeCompare(b.streamId));
  let remaining = gap;
  let seatsLeft = Math.max(0, capacity - seatsUsed);
  const streams = order.map((s): PlanStreamLine => {
    const base = { streamId: s.streamId, sourceType: s.sourceType, label: s.label, cap: s.cap, lined: s.lined, expected: round1(expectedOf(s)), rate: s.rate.rate, basis: s.rate.basis, covers: s.covers };
    if (!s.covers) return { ...base, recommended: 0, reasoning: "Not open on this day" };
    const need = invitesToClose(remaining, 0, s.rate.rate);
    const rec = Math.min(need, s.poolRemaining ?? need, seatsLeft);
    const basisText = s.rate.basis === "actual" ? `14-day actual, ${s.rate.invited} invited` : "plan default";
    let reasoning = `Gap ${text1(remaining)} shows / ${Math.round(s.rate.rate * 100)}% show rate (${basisText}) = ${need} invites`;
    if (need === 0) reasoning += "; no gap";
    else if (s.poolRemaining != null && s.poolRemaining < need && s.poolRemaining <= seatsLeft) reasoning += `; pool has ${s.poolRemaining} left, so ${rec}`;
    else if (seatsLeft < need) reasoning += `; ${seatsLeft} seats left, so ${rec}`;
    remaining = Math.max(0, remaining - rec * s.rate.rate);
    seatsLeft -= rec;
    return { ...base, recommended: rec, reasoning };
  });
  return { date: o.date, driveId: o.driveId, target: round1(target), capacity, seatsUsed, expected, gap, streams };
}

/** What-if: the same maths with the user's edits applied (any subset of target, capacity, per-stream lined / show rate / pool). */
export interface WhatIf { target?: number; capacity?: number; lined?: Record<string, number>; rate?: Record<string, number>; pool?: Record<string, number | null> }
export function whatIf(base: PlanDayInput, w: WhatIf): PlanDay {
  return planDay({
    ...base,
    target: w.target ?? base.target,
    capacity: w.capacity ?? base.capacity,
    streams: base.streams.map((s) => ({
      ...s,
      lined: w.lined?.[s.streamId] ?? s.lined,
      rate: w.rate?.[s.streamId] == null ? s.rate : { ...s.rate, rate: w.rate[s.streamId] },
      poolRemaining: w.pool && s.streamId in w.pool ? w.pool[s.streamId] : s.poolRemaining,
    })),
  });
}

/** One cell per day and stream; fill = seats used / capacity of that day (0 when the day has no capacity). */
export function calendarCells(days: PlanDay[]): CalendarCell[] {
  return days.flatMap((d) => d.streams.map((s): CalendarCell => ({
    date: d.date, streamId: s.streamId, planned: s.lined, cap: s.cap, capacity: d.capacity, fill: d.capacity > 0 ? d.seatsUsed / d.capacity : 0,
  })));
}
