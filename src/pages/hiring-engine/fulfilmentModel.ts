/** Pure view-model of the fulfilment card (mirrors backend he-fulfilment.service.ts). No DOM. */
export interface HourBucket { hour: string; booked: number; confirmed: number; expected: number }
export interface BranchDay { branch: string; booked: number; confirmed: number; expected: number; hours: HourBucket[] }
export interface ExpectedDay { date: string; booked: number; confirmed: number; expected: number; branches: BranchDay[] }
export type FillVerdict = "covered" | "on_track" | "at_risk" | "past_deadline" | "no_history";
export interface RequisitionFill {
  id: string; code: string; branch: string; process: string; role: string; seatsOpen: number; requested: number; fulfilled: number;
  deadline: string | null; daysLeft: number | null; neededLeads: number; covered: number; gap: number; perDayNeeded: number; capacityPerDay: number;
  invited: number; confirmed: number; expectedArrivals7d: number; expectedJoined: number; ratesFrom: "branch+process" | "process" | "all"; verdict: FillVerdict; reason: string;
}
export interface FulfilmentView { generatedAt: string; today: ExpectedDay; next: ExpectedDay | null; requisitions: RequisitionFill[]; totals: { seatsOpen: number; atRisk: number; expectedToday: number } }

export const VERDICT_LABEL: Record<FillVerdict, string> = { covered: "Covered", on_track: "On track", at_risk: "At risk", past_deadline: "Past end date", no_history: "Not enough history" };
export const VERDICT_TONE: Record<FillVerdict, string> = {
  covered: "bg-emerald-50 text-emerald-800 ring-emerald-200", on_track: "bg-blue-50 text-blue-800 ring-blue-200", at_risk: "bg-rose-50 text-rose-800 ring-rose-200",
  past_deadline: "bg-amber-50 text-amber-900 ring-amber-200", no_history: "bg-slate-100 text-slate-700 ring-slate-200",
};

/** "Mon 12 Oct" for an ISO day. */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}
/** Share of the lead requirement already covered, capped to 0-100. */
export const coveragePct = (r: Pick<RequisitionFill, "neededLeads" | "covered">): number => (r.neededLeads > 0 ? Math.min(100, Math.round((r.covered / r.neededLeads) * 100)) : 100);
/** The headline sentence for the day block. */
export function dayHeadline(d: ExpectedDay | null, todayIso: string): string {
  if (!d) return "No interviews are booked.";
  const when = d.date === todayIso ? "Today" : dayLabel(d.date);
  return `${when}: about ${Math.round(d.expected)} expected from ${d.booked} booked (${d.confirmed} confirmed).`;
}
