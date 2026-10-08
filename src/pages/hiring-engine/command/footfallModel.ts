/**
 * "Plan to raise footfall" per drive (read-only arithmetic, no I/O): the open seats in scope give the arrivals needed (seats / the
 * drive's measured join-per-arrival rate, or one arrival per seat while joins are not measured); people already confirmed are expected
 * to come at the drive's resolved show rate; the gap is what is left; and each earlier stage needs gap / (arrivals per person at that
 * stage), through planMath.invitesToClose, so the planner's 5% floor applies (the measured figure is stated too). A rate needs
 * MIN_SAMPLE people. Each drive is planned as if it alone filled the seats. No regex literals.
 */
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import { TYPE_LABEL, countText, pctText } from "./driveCommandModel";
import { invitesToClose } from "./planMath";
import { MIN_SAMPLE } from "./charts/journeyModel";
import type { TextTable } from "./driveChartModel";

export type FootfallStage = "leads" | "contacted" | "invited" | "confirmed";
const STAGE_LABEL: Record<FootfallStage, string> = { leads: "Leads", contacted: "Contacted", invited: "Slot given / invited", confirmed: "Confirmed" };
const PLANNER_FLOOR = 0.05;
export const SHARED_SEATS_NOTE = "Each drive is planned as if it alone filled the open seats; the drives share the same seats.";
export const PLAN_LINK_TEXT = "Open the Plan for day-by-day what-if sliders";

export interface FootfallNeed {
  stage: FootfallStage; label: string; base: number; rate: number | null; rateText: string;
  needed: number | null; neededText: string; raw: number | null; floored: boolean; note: string | null;
}
export interface FootfallPlan {
  type: SourceType; label: string; available: boolean; unavailableText?: string;
  openSeats: number; requisitions: number; closedRequisitions: number;
  joinRate: number | null; target: number; targetText: string;
  showRate: number | null; pending: number; expected: number; gap: number;
  needs: FootfallNeed[]; summary: string; table: TextTable;
}

const n0 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const EMPTY_TABLE = (label: string): TextTable => ({ caption: `${label}: people needed per stage to fill the open seats`, columns: ["Stage", "People in range", "Arrived per person", "Needed to close the gap"], rows: [] });

export function footfallPlan(a: DriveAnalytics, type: SourceType): FootfallPlan {
  const label = TYPE_LABEL[type];
  const s = a?.types?.[type]?.stages;
  const j = a?.journey ? a.journey[type] : undefined;
  const base: FootfallPlan = {
    type, label, available: false, openSeats: 0, requisitions: 0, closedRequisitions: 0, joinRate: null, target: 0, targetText: "",
    showRate: null, pending: 0, expected: 0, gap: 0, needs: [], summary: "", table: EMPTY_TABLE(label),
  };
  if (!Array.isArray(a?.openSeats)) return { ...base, unavailableText: "Open seats are not available from this server yet." };
  const seats = a.openSeats.reduce((t, r) => t + n0(r?.open), 0);
  const requisitions = a.openSeats.filter((r) => n0(r?.open) > 0).length;
  const closedRequisitions = a.openSeats.filter((r) => r?.closedReason).length;
  if (seats === 0) return { ...base, available: true, closedRequisitions, summary: "No open seats in the requisitions in scope, so there is nothing to plan." };

  const arrived = n0(s?.arrived), joined = n0(s?.joined), noShow = n0(a?.types?.[type]?.noShow), confirmed = n0(s?.confirmed);
  const joinRate = arrived >= MIN_SAMPLE && joined > 0 && joined <= arrived ? joined / arrived : null;
  const target = joinRate ? Math.ceil(seats / joinRate) : seats;
  const targetText = joinRate
    ? `${countText(seats)} open seats at ${pctText(joinRate)} of arrivals joining (${countText(joined)} of ${countText(arrived)}).`
    : `One arrival per open seat, the minimum: too few joins are measured yet (${countText(joined)} joined of ${countText(arrived)} arrived).`;
  const resolved = arrived + noShow;
  const showRate = resolved >= MIN_SAMPLE ? arrived / resolved : null;
  const pending = Math.max(0, confirmed - arrived - noShow);
  const expected = showRate === null ? 0 : round1(pending * showRate);
  const gap = Math.max(0, Math.ceil(target - expected));

  const bases: Record<FootfallStage, number | null> = { leads: n0(s?.leads), contacted: j ? n0(j.contacted) : null, invited: n0(s?.invited), confirmed };
  const needs = (Object.keys(STAGE_LABEL) as FootfallStage[]).filter((k) => bases[k] !== null).map((stage): FootfallNeed => {
    const b = bases[stage] as number;
    const row = { stage, label: STAGE_LABEL[stage], base: b, raw: null, floored: false, note: null };
    if (b < MIN_SAMPLE) return { ...row, rate: null, rateText: "–", needed: null, neededText: `Not enough data (${countText(b)} people)` };
    const rate = Math.min(1, arrived / b);
    if (rate === 0) return { ...row, rate: 0, rateText: "0%", needed: null, neededText: "No arrivals yet" };
    const needed = invitesToClose(gap, 0, rate);
    const raw = gap > 0 ? Math.ceil(gap / rate) : 0;
    const floored = rate < PLANNER_FLOOR && gap > 0;
    return { ...row, rate, rateText: pctText(rate), needed, neededText: countText(needed), raw, floored,
      note: floored ? `The planner never assumes less than 5%, so ${countText(needed)} is a floor; at the measured ${pctText(rate)} it is ${countText(raw)}.` : null };
  });
  const expectedText = showRate === null
    ? "The show rate is not measured yet, so people already confirmed are not counted"
    : `About ${expected} are expected from people already confirmed`;
  const summary = `To fill ${countText(seats)} open seats, ${label} needs about ${countText(target)} arrivals. ${expectedText}, ${gap > 0 ? `so the gap is ${countText(gap)} arrivals.` : "so no more are needed now."}`;
  const table: TextTable = { ...EMPTY_TABLE(label), rows: needs.map((n) => [n.label, countText(n.base), n.rateText, n.neededText]) };
  return { ...base, available: true, openSeats: seats, requisitions, closedRequisitions, joinRate, target, targetText, showRate, pending, expected, gap, needs, summary, table };
}
