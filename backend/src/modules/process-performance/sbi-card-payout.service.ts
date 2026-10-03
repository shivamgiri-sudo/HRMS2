import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRange } from "./sbi-card-dashboard.service.js";
import {
  computePayout, levers, nextSteps, revenueOf, TARGET_INPUTS, PAYOUT_TARGETS, PAYOUT_SEGMENT, PAYOUT_MATRIX, MATRIX_ROW_LABELS, MATRIX_COL_LABELS, NORM_KICKER, RES_KICKER,
  outcomeToPercentages, pickOutcome, type OutcomeRow, type OutcomeBasis,
  type PayoutInputs, type PayoutResult, type Lever, type NextStep,
} from "./sbi-card-payout.calc.js";

/**
 * SBI Card Collections payout (100% variable, so revenue = rate x what was collected). Collected amounts come from the Agent MIS
 * ("Amt collected"); the Resolution / Normalisation / Rollback percentages are inputs until the client's outcome figures are loaded,
 * defaulting to the client's own targets. Nothing here writes.
 */
export interface SbiCardPayoutData {
  range: { from: string; to: string };
  segment: string;
  targets: typeof PAYOUT_TARGETS;
  collected: { ftd: { date: string | null; amount: number }; mtd: { amount: number; days: number }; daily: Array<{ date: string; amount: number }>; pcProgressPct: number | null };
  slab: { rows: readonly string[]; cols: readonly string[]; matrix: ReadonlyArray<readonly number[]>; norm: typeof NORM_KICKER; res: typeof RES_KICKER };
  /** True when the percentages are the client's targets rather than figures somebody entered. */
  inputsAreTargets: boolean;
  /** Where the percentages came from: typed in (any field), the uploaded outcome figures, or the client's targets. */
  inputsSource: "entered" | "outcome" | "targets";
  /** The uploaded cycle-outcome row used (null until an Outcome file is loaded). */
  outcome: null | {
    asOf: string; segment: string; segments: string[]; basis: OutcomeBasis | null; available: OutcomeBasis[]; complete: boolean;
    openingAccounts: number | null; openingAmount: number | null; resolutionPct: number | null; normalisationPct: number | null; rollbackPct: number | null;
  };
  scenario: PayoutResult & { revenue: { ftd: number; mtd: number } };
  atTarget: PayoutResult & { revenue: { ftd: number; mtd: number } };
  levers: Lever[];
  /** The smallest extra points of each outcome that raise the rate, in accounts of the opening book and in rupees. */
  nextSteps: NextStep[];
  reading: string[];
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** What the figures mean and where they come from, shown on the page so a wrong reading is caught by whoever knows the contract. */
export const PAYOUT_READING = [
  "Payout rate = matrix cell + Norm kicker + Resolution kicker, as a percentage of amount collected.",
  "Matrix row = Resolution% + Normalisation% + Rollback% (target 35 + 28 = 63). Matrix column = Normalisation% + Rollback% (target 28).",
  "Norm kicker is read on Normalisation% alone (starts above 18%). Resolution kicker is read on Resolution% alone (starts at 36%).",
  "Confirmed with the process owner: the row / column reading above, and amount collected as the base the rate is paid on.",
  "Targets are from the client's planning sheet: Resolution 35%, NRB 28% (Resolution x 80%), PC 3.5 cr. Until an Outcome file is loaded, NRB is split 18 Normalisation / 10 Rollback as an assumption.",
  "Resolution / Normalisation / Rollback come from the uploaded Outcome file (cycle-to-date, per segment) when there is one; anything typed overrides it field by field.",
  "Amount collected is the Agent MIS 'Amt collected'. FTD is the latest day with data in the range; MTD is the sum over the range.",
];

export async function getSbiCardPayout(q: { month?: string; from?: string; to?: string; res?: unknown; nm?: unknown; rb?: unknown; segment?: string; basis?: string }): Promise<SbiCardPayoutData> {
  const { from, to } = resolveRange(q.month, q.from, q.to);
  const [pr] = await db.execute<RowDataPacket[]>(`SELECT id FROM process_master WHERE process_code = 'SBI_CARD' AND active_status = 1 LIMIT 1`);
  const pid: string | null = pr[0]?.id ?? null;
  const daily: Array<{ date: string; amount: number }> = [];
  if (pid) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, SUM(COALESCE(amt_collected, 0)) AS amt
         FROM sbi_card_agent_mis WHERE process_id = ? AND report_date BETWEEN ? AND ? GROUP BY report_date ORDER BY report_date`, [pid, from, to]);
    for (const r of rows) daily.push({ date: String(r.d), amount: Math.round(Number(r.amt) * 100) / 100 });
  }
  const outcomeRows: OutcomeRow[] = [];
  if (pid) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') AS d, segment, opening_accounts, opening_amount, resolved_accounts, normalised_accounts, rollback_accounts,
              resolved_amount, normalised_amount, rollback_amount, resolution_pct, normalisation_pct, rollback_pct
         FROM sbi_card_outcome WHERE process_id = ? AND report_date BETWEEN ? AND ?`, [pid, from, to]);
    for (const r of rows) {
      outcomeRows.push({
        date: String(r.d), segment: String(r.segment), openingAccounts: num(r.opening_accounts), openingAmount: num(r.opening_amount),
        resolvedAccounts: num(r.resolved_accounts), normalisedAccounts: num(r.normalised_accounts), rollbackAccounts: num(r.rollback_accounts),
        resolvedAmount: num(r.resolved_amount), normalisedAmount: num(r.normalised_amount), rollbackAmount: num(r.rollback_amount),
        resolutionPct: num(r.resolution_pct), normalisationPct: num(r.normalisation_pct), rollbackPct: num(r.rollback_pct),
      });
    }
  }
  const withData = daily.filter((d) => d.amount > 0);
  const last = withData[withData.length - 1] ?? null;
  const mtdAmount = Math.round(daily.reduce((n, d) => n + d.amount, 0));
  const ftdAmount = last ? Math.round(last.amount) : 0;

  const res = num(q.res); const nm = num(q.nm); const rb = num(q.rb);
  const entered = res !== null || nm !== null || rb !== null;
  const prefer: OutcomeBasis | "auto" = q.basis === "accounts" || q.basis === "amount" || q.basis === "stated" ? q.basis : "auto";
  const picked = pickOutcome(outcomeRows, q.segment);
  const pcts = picked.row ? outcomeToPercentages(picked.row, prefer) : null;
  const fromOutcome = pcts && pcts.basis !== null;
  // Typed figures win field by field; then the uploaded outcome; then the client's targets (so an incomplete file never hides a field).
  const inputs: PayoutInputs = {
    resolutionPct: res ?? (fromOutcome ? pcts!.resolutionPct : null) ?? TARGET_INPUTS.resolutionPct,
    normalisationPct: nm ?? (fromOutcome ? pcts!.normalisationPct : null) ?? TARGET_INPUTS.normalisationPct,
    rollbackPct: rb ?? (fromOutcome ? pcts!.rollbackPct : null) ?? TARGET_INPUTS.rollbackPct,
  };
  const inputsSource: SbiCardPayoutData["inputsSource"] = entered ? "entered" : fromOutcome ? "outcome" : "targets";
  const withRevenue = (r: PayoutResult) => ({ ...r, revenue: { ftd: revenueOf(r.ratePct, ftdAmount), mtd: revenueOf(r.ratePct, mtdAmount) } });
  const scenario = withRevenue(computePayout(inputs));
  return {
    range: { from, to }, segment: PAYOUT_SEGMENT, targets: PAYOUT_TARGETS,
    collected: { ftd: { date: last?.date ?? null, amount: ftdAmount }, mtd: { amount: mtdAmount, days: withData.length }, daily, pcProgressPct: mtdAmount > 0 ? Math.round((mtdAmount / PAYOUT_TARGETS.pcAmount) * 1000) / 10 : null },
    slab: { rows: MATRIX_ROW_LABELS, cols: MATRIX_COL_LABELS, matrix: PAYOUT_MATRIX, norm: NORM_KICKER, res: RES_KICKER },
    inputsAreTargets: inputsSource === "targets", inputsSource,
    outcome: picked.row && pcts ? {
      asOf: picked.row.date, segment: picked.row.segment, segments: picked.segments, basis: pcts.basis, available: pcts.available, complete: pcts.complete,
      openingAccounts: picked.row.openingAccounts, openingAmount: picked.row.openingAmount,
      resolutionPct: pcts.resolutionPct, normalisationPct: pcts.normalisationPct, rollbackPct: pcts.rollbackPct,
    } : null,
    scenario, atTarget: withRevenue(computePayout(TARGET_INPUTS)), levers: levers(scenario.inputs, mtdAmount), nextSteps: nextSteps(scenario.inputs, mtdAmount, picked.row?.openingAccounts ?? null), reading: PAYOUT_READING,
  };
}
