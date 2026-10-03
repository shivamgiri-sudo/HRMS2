import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRange } from "./sbi-card-dashboard.service.js";
import {
  computePayout, levers, revenueOf, TARGET_INPUTS, PAYOUT_TARGETS, PAYOUT_SEGMENT, PAYOUT_MATRIX, MATRIX_ROW_LABELS, MATRIX_COL_LABELS, NORM_KICKER, RES_KICKER,
  type PayoutInputs, type PayoutResult, type Lever,
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
  scenario: PayoutResult & { revenue: { ftd: number; mtd: number } };
  atTarget: PayoutResult & { revenue: { ftd: number; mtd: number } };
  levers: Lever[];
  reading: string[];
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** What the figures mean and where they come from, shown on the page so a wrong reading is caught by whoever knows the contract. */
export const PAYOUT_READING = [
  "Payout rate = matrix cell + Norm kicker + Resolution kicker, as a percentage of amount collected.",
  "Matrix row = Resolution% + Normalisation% + Rollback% (target 35 + 28 = 63). Matrix column = Normalisation% + Rollback% (target 28).",
  "Norm kicker is read on Normalisation% alone (starts above 18%). Resolution kicker is read on Resolution% alone (starts at 36%).",
  "Targets are from the client's planning sheet: Resolution 35%, NRB 28% (Resolution x 80%), PC 3.5 cr. The 18 / 10 split of NRB into Normalisation / Rollback is an assumption.",
  "Amount collected is the Agent MIS 'Amt collected'. FTD is the latest day with data in the range; MTD is the sum over the range.",
];

export async function getSbiCardPayout(q: { month?: string; from?: string; to?: string; res?: unknown; nm?: unknown; rb?: unknown }): Promise<SbiCardPayoutData> {
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
  const withData = daily.filter((d) => d.amount > 0);
  const last = withData[withData.length - 1] ?? null;
  const mtdAmount = Math.round(daily.reduce((n, d) => n + d.amount, 0));
  const ftdAmount = last ? Math.round(last.amount) : 0;

  const res = num(q.res); const nm = num(q.nm); const rb = num(q.rb);
  const entered = res !== null || nm !== null || rb !== null;
  const inputs: PayoutInputs = entered
    ? { resolutionPct: res ?? TARGET_INPUTS.resolutionPct, normalisationPct: nm ?? TARGET_INPUTS.normalisationPct, rollbackPct: rb ?? TARGET_INPUTS.rollbackPct }
    : TARGET_INPUTS;
  const withRevenue = (r: PayoutResult) => ({ ...r, revenue: { ftd: revenueOf(r.ratePct, ftdAmount), mtd: revenueOf(r.ratePct, mtdAmount) } });
  const scenario = withRevenue(computePayout(inputs));
  return {
    range: { from, to }, segment: PAYOUT_SEGMENT, targets: PAYOUT_TARGETS,
    collected: { ftd: { date: last?.date ?? null, amount: ftdAmount }, mtd: { amount: mtdAmount, days: withData.length }, daily, pcProgressPct: mtdAmount > 0 ? Math.round((mtdAmount / PAYOUT_TARGETS.pcAmount) * 1000) / 10 : null },
    slab: { rows: MATRIX_ROW_LABELS, cols: MATRIX_COL_LABELS, matrix: PAYOUT_MATRIX, norm: NORM_KICKER, res: RES_KICKER },
    inputsAreTargets: !entered, scenario, atTarget: withRevenue(computePayout(TARGET_INPUTS)), levers: levers(scenario.inputs, mtdAmount), reading: PAYOUT_READING,
  };
}
