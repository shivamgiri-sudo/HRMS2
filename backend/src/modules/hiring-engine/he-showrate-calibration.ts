import { dailyPlanNumbers, type DailyPlan } from "./he-slots.js";

export const SHOWRATE_FLOOR = 0.05;
export const SHOWRATE_CEIL = 0.95;
/** Calibrated invites stay between 1/this and this times today's numbers. */
export const CALIBRATION_MAX_FACTOR = 2;

export interface RateSample { invited: number; arrived: number }
export type CalibrationBasis = "actual_weekday" | "actual" | "plan_default";
export interface CalibratedRate { rate: number; basis: CalibrationBasis; invited: number; arrived: number; weekday: number | null }

const whole = (n: unknown): number => { const v = Number(n); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; };
const clampRate = (r: number): number => {
  const v = Number.isFinite(r) ? r : SHOWRATE_FLOOR;
  return Math.round(Math.min(SHOWRATE_CEIL, Math.max(SHOWRATE_FLOOR, v)) * 10000) / 10000;
};
function clean(s: RateSample | undefined): RateSample {
  const invited = whole(s?.invited);
  return { invited, arrived: Math.min(invited, whole(s?.arrived)) };
}

/** 0 = Monday ... 6 = Sunday for a YYYY-MM-DD date; string maths, so the host timezone cannot shift it. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Chain: same weekday, then the whole window, then the plan default; each needs minSample invited. Always within [5%, 95%]. */
export function calibrateShowRate(o: {
  weekday: number; byWeekday: Partial<Record<number, RateSample>>; overall: RateSample; planDefault: number; minSample: number;
}): CalibratedRate {
  const wd = clean(o.byWeekday[o.weekday]);
  const all = clean(o.overall);
  if (wd.invited >= o.minSample && wd.invited > 0) return { rate: clampRate(wd.arrived / wd.invited), basis: "actual_weekday", ...wd, weekday: o.weekday };
  if (all.invited >= o.minSample && all.invited > 0) return { rate: clampRate(all.arrived / all.invited), basis: "actual", ...all, weekday: null };
  return { rate: clampRate(o.planDefault), basis: "plan_default", ...all, weekday: null };
}

/** Today's plan numbers re-derived for a measured rate, bounded to half..twice today's invites. */
export function calibratedPlanNumbers(plan: DailyPlan, rate: number): ReturnType<typeof dailyPlanNumbers> {
  const legacy = dailyPlanNumbers(plan);
  const r = clampRate(rate);
  const raw = dailyPlanNumbers({ ...plan, showRatePct: Math.round(r * 1e6) / 1e4 }).invites;
  const invites = Math.min(legacy.invites * CALIBRATION_MAX_FACTOR, Math.max(Math.ceil(legacy.invites / CALIBRATION_MAX_FACTOR), raw));
  const perSlot = Math.min(50, Math.max(1, Math.ceil(invites / legacy.slots)));
  return { invites, targetShows: Math.max(1, Math.round(invites * r)), slots: legacy.slots, perSlot, capacity: legacy.slots * perSlot };
}

/** Like streamCaps, but the shared share comes from each stream's own measured rate; HR-set daily_invites are kept. */
export function calibratedCaps(
  streams: Array<{ id: string; dailyInvites: number | null }>, plan: DailyPlan, rateOf: (streamId: string) => number,
): Map<string, number> {
  const shared = streams.filter((s) => s.dailyInvites == null).length;
  return new Map(streams.map((s) => [
    s.id,
    s.dailyInvites ?? Math.max(1, Math.ceil(calibratedPlanNumbers(plan, rateOf(s.id)).invites / shared)),
  ]));
}
