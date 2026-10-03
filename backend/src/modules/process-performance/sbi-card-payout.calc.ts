/**
 * SBI Card Collections -- payout engine for "CD 3 > 25k - North HB" (pure calculations, no DB).
 *
 * Source: the client's payout slab (mail of 7-Sep-2026, "payout structure details CD3 HB") and the planning targets on the Pen Estimation
 * sheet (Reso 35%, NRB = Reso x 80% = 28%, PC 3.5 cr). The process is 100% variable: the payout is a percentage of what is collected.
 *
 * The slab is three tables that ADD UP:
 *   rate = matrix[row][col] + normKicker + resolutionKicker
 *
 * How the slab is read against the targets (this is a reading, and it is stated on the page so it can be corrected in one place):
 *   row axis      "Res/NM+RB"  = Resolution% + Normalisation% + Rollback%      (target 35 + 28 = 63; the 62-63 / 63-64 rows)
 *   column axis   NRB          = Normalisation% + Rollback%                    (target 28; the 27-28 / >28 columns)
 *   "CD 3 Norm"   additional   = Normalisation% alone                          (kicker starts above 18)
 *   "CD3 Rsl"     additional   = Resolution% alone                             (kicker starts at 36; target 35)
 * Every percentage is of the opening (allocated) book. Amount collected is the base the rate is paid on.
 *
 * Band edges: a hyphen band ("53-55%") is inclusive at both ends and the FIRST band that matches wins, so a value exactly on an edge
 * belongs to the lower band -- the same answer the slab's explicit "<=18%", ">24%", ">49%" and ">64%" give.
 */

export const PAYOUT_SEGMENT = "CD 3 > 25k - North HB";

/** Targets from the client's planning sheet. NRB is Resolution x 80%. Amounts in rupees. */
export const PAYOUT_TARGETS = {
  resolutionPct: 35,
  nrbPct: 28,
  totalPct: 63,
  /** "PC 3.5cr" on the sheet; compared with amount collected on the page. */
  pcAmount: 35_000_000,
  /** Normalisation at which its kicker starts (the first band is "<=18%"); the rest of NRB is read as Rollback. */
  normKickerStartPct: 18,
} as const;

export const MATRIX_ROW_LABELS = ["<53%", "53-55%", "55-57%", "57%-59%", "59%-61%", "61%-62%", "62%-63%", "63%-64%", ">64%"] as const;
export const MATRIX_COL_LABELS = ["<22%", "22-24%", "24-26%", "26-27%", "27-28%", ">28%"] as const;
/** matrix[row][col], percent of collections. */
export const PAYOUT_MATRIX: ReadonlyArray<readonly number[]> = [
  [3.5, 3.75, 4.0, 4.25, 4.5, 4.75],
  [4.0, 4.25, 4.5, 4.75, 5.0, 5.25],
  [4.5, 4.75, 5.0, 5.25, 5.5, 5.75],
  [5.0, 5.25, 5.5, 5.75, 6.0, 6.25],
  [5.5, 5.75, 6.0, 6.25, 6.5, 6.75],
  [6.0, 6.25, 6.5, 6.75, 7.0, 7.25],
  [6.5, 6.75, 7.0, 7.25, 7.5, 7.75],
  [7.0, 7.25, 7.5, 7.75, 8.0, 8.25],
  [7.5, 7.75, 8.0, 8.25, 8.5, 8.75],
];
export const NORM_KICKER = {
  labels: ["<=18%", "18-19%", "19-20%", "20-21%", "21-22%", "22-23%", "23-24%", ">24%"],
  pays: [0, 0.5, 0.7, 0.9, 1.1, 1.1, 1.25, 1.4],
} as const;
export const RES_KICKER = {
  labels: ["<36%", "36-38%", "38-40%", "40-43%", "43-46%", "46-49%", ">49%"],
  pays: [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5],
} as const;

/** "<53%" / "<=18%" / ">64%" / "57%-59%" -> a test on a percentage. Hyphen bands are inclusive at both ends. */
export function bandTest(label: string): (v: number) => boolean {
  const s = label.replace(/\s+/g, "").replace(/%/g, "");
  let m = /^<=(\d+(?:\.\d+)?)$/.exec(s); if (m) { const x = Number(m[1]); return (v) => v <= x; }
  m = /^<(\d+(?:\.\d+)?)$/.exec(s); if (m) { const x = Number(m[1]); return (v) => v < x; }
  m = /^>(\d+(?:\.\d+)?)$/.exec(s); if (m) { const x = Number(m[1]); return (v) => v > x; }
  m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(s); if (m) { const [a, b] = [Number(m[1]), Number(m[2])]; return (v) => v >= a && v <= b; }
  throw new Error(`Unreadable payout band "${label}"`);
}
const compile = (labels: readonly string[]) => labels.map(bandTest);
const ROW_TESTS = compile(MATRIX_ROW_LABELS); const COL_TESTS = compile(MATRIX_COL_LABELS);
const NORM_TESTS = compile(NORM_KICKER.labels); const RES_TESTS = compile(RES_KICKER.labels);

/** Index of the first band that contains the value (the last band is open-ended, so a finite value always lands somewhere). */
export function bandIndex(tests: Array<(v: number) => boolean>, value: number): number {
  const i = tests.findIndex((t) => t(value));
  return i >= 0 ? i : tests.length - 1;
}

const clampPct = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; };
const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface PayoutInputs { resolutionPct: number; normalisationPct: number; rollbackPct: number }
export interface PayoutResult {
  inputs: PayoutInputs;
  /** Resolution + Normalisation + Rollback (matrix row) and Normalisation + Rollback (matrix column). */
  totalPct: number; nrbPct: number;
  cells: { row: number; col: number; norm: number; res: number };
  matrixPct: number; normKickerPct: number; resKickerPct: number;
  /** Matrix + both kickers, percent of amount collected. */
  ratePct: number;
}

export function computePayout(raw: PayoutInputs): PayoutResult {
  const inputs = { resolutionPct: clampPct(raw.resolutionPct), normalisationPct: clampPct(raw.normalisationPct), rollbackPct: clampPct(raw.rollbackPct) };
  const nrbPct = r2(inputs.normalisationPct + inputs.rollbackPct);
  const totalPct = r2(inputs.resolutionPct + nrbPct);
  const cells = { row: bandIndex(ROW_TESTS, totalPct), col: bandIndex(COL_TESTS, nrbPct), norm: bandIndex(NORM_TESTS, inputs.normalisationPct), res: bandIndex(RES_TESTS, inputs.resolutionPct) };
  const matrixPct = PAYOUT_MATRIX[cells.row]![cells.col]!;
  const normKickerPct = NORM_KICKER.pays[cells.norm]!; const resKickerPct = RES_KICKER.pays[cells.res]!;
  return { inputs, totalPct, nrbPct, cells, matrixPct, normKickerPct, resKickerPct, ratePct: r2(matrixPct + normKickerPct + resKickerPct) };
}

/** The scenario the planning sheet describes: Resolution 35, NRB 28, read as Normalisation 18 + Rollback 10. */
export const TARGET_INPUTS: PayoutInputs = {
  resolutionPct: PAYOUT_TARGETS.resolutionPct,
  normalisationPct: PAYOUT_TARGETS.normKickerStartPct,
  rollbackPct: PAYOUT_TARGETS.nrbPct - PAYOUT_TARGETS.normKickerStartPct,
};

export interface Lever { lever: "resolution" | "normalisation" | "rollback"; label: string; addPoints: number; newRatePct: number; deltaPct: number; deltaAmount: number }
/** What the next points of each outcome are worth, in rate and in rupees on the amount collected so far. */
export function levers(inputs: PayoutInputs, collected: number, step = 1): Lever[] {
  const base = computePayout(inputs);
  const make = (lever: Lever["lever"], label: string, next: PayoutInputs): Lever => {
    const n = computePayout(next);
    return { lever, label, addPoints: step, newRatePct: n.ratePct, deltaPct: r2(n.ratePct - base.ratePct), deltaAmount: Math.round(((n.ratePct - base.ratePct) / 100) * collected) };
  };
  return [
    make("resolution", "Resolution +1 pt", { ...inputs, resolutionPct: inputs.resolutionPct + step }),
    make("normalisation", "Normalisation +1 pt", { ...inputs, normalisationPct: inputs.normalisationPct + step }),
    make("rollback", "Rollback +1 pt", { ...inputs, rollbackPct: inputs.rollbackPct + step }),
  ];
}

export interface NextStep {
  lever: "resolution" | "normalisation" | "rollback"; label: string; addPoints: number; newRatePct: number; deltaPct: number;
  /** Accounts that must move, from the opening book; null until an outcome file gives the opening accounts. */
  accountsNeeded: number | null; deltaAmount: number; unlocks: string;
}
/**
 * The smallest extra points of each outcome that actually raise the rate (the next step on the slab), what that is in accounts of the
 * opening book and in rupees on what has been collected, and which step of the slab it unlocks. This is the "what do we need to do" view.
 */
export function nextSteps(inputs: PayoutInputs, collected: number, openingAccounts: number | null, maxPoints = 20): NextStep[] {
  const base = computePayout(inputs);
  const out: NextStep[] = [];
  const levs: Array<[NextStep["lever"], string, keyof PayoutInputs]> = [["resolution", "Resolution", "resolutionPct"], ["normalisation", "Normalisation", "normalisationPct"], ["rollback", "Rollback", "rollbackPct"]];
  for (const [lever, name, field] of levs) {
    for (let k = 1; k <= maxPoints * 10; k++) {
      const add = k / 10; const n = computePayout({ ...inputs, [field]: inputs[field] + add });
      if (n.ratePct > base.ratePct) {
        const unlocks: string[] = [];
        if (n.cells.row > base.cells.row) unlocks.push(`matrix row ${MATRIX_ROW_LABELS[n.cells.row]}`);
        if (n.cells.col > base.cells.col) unlocks.push(`NRB column ${MATRIX_COL_LABELS[n.cells.col]}`);
        if (n.cells.norm > base.cells.norm) unlocks.push(`Norm kicker ${NORM_KICKER.labels[n.cells.norm]}`);
        if (n.cells.res > base.cells.res) unlocks.push(`Resolution kicker ${RES_KICKER.labels[n.cells.res]}`);
        out.push({
          lever, label: `${name} +${add.toFixed(1)} pt`, addPoints: add, newRatePct: n.ratePct, deltaPct: r2(n.ratePct - base.ratePct),
          accountsNeeded: openingAccounts && openingAccounts > 0 ? Math.ceil((add / 100) * openingAccounts) : null,
          deltaAmount: Math.round(((n.ratePct - base.ratePct) / 100) * collected), unlocks: unlocks.join(" + ") || "next band",
        });
        break;
      }
    }
  }
  return out.sort((a, b) => a.addPoints - b.addPoints || b.deltaPct - a.deltaPct);
}

/** Revenue = the rate on what was collected. */
export const revenueOf = (ratePct: number, collected: number): number => Math.round((ratePct / 100) * collected);

/* ------------------------------------------------------------------------------------------------------------------------------
 * Outcome figures (sbi_card_outcome): one row per report date per segment, cumulative to that date.
 * ---------------------------------------------------------------------------------------------------------------------------- */
export interface OutcomeRow {
  date: string; segment: string;
  openingAccounts: number | null; openingAmount: number | null;
  resolvedAccounts: number | null; normalisedAccounts: number | null; rollbackAccounts: number | null;
  resolvedAmount: number | null; normalisedAmount: number | null; rollbackAmount: number | null;
  resolutionPct: number | null; normalisationPct: number | null; rollbackPct: number | null;
}
export type OutcomeBasis = "stated" | "accounts" | "amount";
export interface OutcomePercentages { resolutionPct: number | null; normalisationPct: number | null; rollbackPct: number | null; basis: OutcomeBasis | null; complete: boolean; available: OutcomeBasis[] }

const share = (n: number | null, d: number | null): number | null => (n !== null && d !== null && d > 0 ? r2((n / d) * 100) : null);

/**
 * Percentages of one outcome row. "stated" = the percentages SBI printed; "accounts" / "amount" = derived from counts / amounts over the
 * opening base. `prefer` picks a basis when it is available; otherwise stated beats accounts beats amount, because a figure the client
 * states is the one the client will pay on. A component missing on the chosen basis is null (the caller fills it, and says so).
 */
export function outcomeToPercentages(row: OutcomeRow, prefer: OutcomeBasis | "auto" = "auto"): OutcomePercentages {
  const stated = [row.resolutionPct, row.normalisationPct, row.rollbackPct];
  const byAccounts = [share(row.resolvedAccounts, row.openingAccounts), share(row.normalisedAccounts, row.openingAccounts), share(row.rollbackAccounts, row.openingAccounts)];
  const byAmount = [share(row.resolvedAmount, row.openingAmount), share(row.normalisedAmount, row.openingAmount), share(row.rollbackAmount, row.openingAmount)];
  const sets: Array<[OutcomeBasis, Array<number | null>]> = [["stated", stated], ["accounts", byAccounts], ["amount", byAmount]];
  const available = sets.filter(([, v]) => v.some((x) => x !== null)).map(([b]) => b);
  const order: OutcomeBasis[] = prefer !== "auto" && available.includes(prefer) ? [prefer] : ["stated", "accounts", "amount"];
  const basis = order.find((b) => available.includes(b)) ?? null;
  if (!basis) return { resolutionPct: null, normalisationPct: null, rollbackPct: null, basis: null, complete: false, available };
  const v = sets.find(([b]) => b === basis)![1];
  return { resolutionPct: v[0]!, normalisationPct: v[1]!, rollbackPct: v[2]!, basis, complete: v.every((x) => x !== null), available };
}

const flat = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** The payout is for CD 3 > 25k North HB. Prefer the asked-for segment, then one that names CD3 + HB, then the only one, then the freshest. */
export function pickOutcome(rows: OutcomeRow[], wanted?: string | null): { row: OutcomeRow | null; segments: string[] } {
  const segments = [...new Set(rows.map((r) => r.segment))].sort();
  if (rows.length === 0) return { row: null, segments };
  const latest = (seg: string) => rows.filter((r) => r.segment === seg).sort((a, b) => b.date.localeCompare(a.date))[0]!;
  const w = wanted ? segments.find((s) => flat(s) === flat(wanted)) : undefined;
  const cd3hb = segments.find((s) => { const f = flat(s); return f.includes("cd3") && f.includes("hb"); });
  const chosen = w ?? cd3hb ?? (segments.length === 1 ? segments[0] : [...segments].sort((a, b) => latest(b).date.localeCompare(latest(a).date))[0]);
  return { row: chosen ? latest(chosen) : null, segments };
}
