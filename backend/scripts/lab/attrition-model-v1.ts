// FROZEN COPY of the hand-tuned scorer as it was before the 2026-10-02 re-weighting, kept only so the model lab can compare old and new.
/**
 * Attrition risk model - the pure part (no I/O), so the same scorer runs on today's employees and
 * on historical snapshots when the model is tested against what really happened.
 *
 * Six signal groups, each capped, summed and clamped to 0-100:
 *   lifecycle     tenure band (the first 90 days and the 91-180 slump are the danger zones), walk-in joiners
 *   attendance    absence rate, a falling trend, a current absence streak, late marks, leave / regularisation churn
 *   performance   KPI score and its direction, call quality and its direction
 *   compensation  pay against designation peers, time since last increment, absolute pay floor
 *   conduct       active warnings, PIP, missing critical profile data (hygiene)
 *   team          the reporting manager's recent loss rate
 *
 * A missing signal scores ZERO, never a penalty: someone who is not on a dialler has no call
 * quality, and that is not a risk. Every factor says why it fired so a manager can act on it.
 *
 * The score ranks people; it is not a probability. Probabilities come from the backtest in
 * attrition-hub.service.ts, which measures how often each tier really left within 30 days.
 */

export type Tier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type FactorGroup = "lifecycle" | "attendance" | "performance" | "compensation" | "conduct" | "team";
export const FACTOR_GROUP_ORDER: FactorGroup[] = ["lifecycle", "attendance", "performance", "compensation", "conduct", "team"];
export const FACTOR_CAPS: Record<FactorGroup, number> = {
  lifecycle: 30, attendance: 28, performance: 20, compensation: 12, conduct: 10, team: 10,
};
export const FACTOR_LABELS: Record<FactorGroup, string> = {
  lifecycle: "Tenure & lifecycle", attendance: "Attendance behaviour", performance: "Performance",
  compensation: "Pay & growth", conduct: "Conduct & hygiene", team: "Manager & team",
};

/** Tier cut-offs on the 0-100 score. Re-checked by the live backtest; see HubModel.calibration. */
export const TIER_CUTOFFS = { CRITICAL: 55, HIGH: 40, MEDIUM: 25 } as const;
export const tierOf = (score: number): Tier =>
  score >= TIER_CUTOFFS.CRITICAL ? "CRITICAL" : score >= TIER_CUTOFFS.HIGH ? "HIGH" : score >= TIER_CUTOFFS.MEDIUM ? "MEDIUM" : "LOW";

/** Everything the scorer may look at. null / undefined = not known, scores nothing. */
export interface Features {
  aonDays: number;
  walkIn?: boolean | null;
  att60Pct?: number | null;          // present + half-day share of working days, last 60d
  attDeltaPts?: number | null;       // last 30d minus previous 30d, percentage points
  absentStreak?: number | null;      // consecutive absent days up to the latest record
  absent7?: number | null;           // absent days in the last 7
  late30?: number | null;
  leaveCount60?: number | null;      // approved leave applications, last 60d
  reg60?: number | null;             // attendance regularisation requests, last 60d
  kpiScore?: number | null;          // latest final KPI score 0-100
  kpiDelta?: number | null;          // latest minus previous period
  quality60?: number | null;         // average call quality %, last 60d
  qualityVelocity?: number | null;   // last 30d minus previous 30d, points
  ctc?: number | null;
  peerCtcRatio?: number | null;      // own CTC / average CTC of the same designation
  monthsSinceIncrement?: number | null;
  tenureMonths?: number | null;
  warningSeverity?: 0 | 1 | 2 | 3 | null; // highest active warning: verbal 1, written 2, final 3
  warningCount?: number | null;
  activePip?: boolean | null;
  hygieneMissing?: number | null;    // of PAN, UAN, mobile, bank record, personal email
  teamExitRate90?: number | null;    // manager's exits in 90d / (team size + exits), 0-1
}

export interface Reason { label: string; group: FactorGroup; points: number; detail: string }
export interface Scored {
  factors: Record<FactorGroup, number>;
  score: number;
  tier: Tier;
  reasons: Reason[];                 // every fired reason, biggest first
}

const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function scoreFeatures(f: Features): Scored {
  const reasons: Reason[] = [];
  const add = (group: FactorGroup, points: number, label: string, detail: string) => {
    if (points > 0) reasons.push({ group, points, label, detail });
  };

  // ── lifecycle ──
  const aon = f.aonDays;
  if (aon <= 30) add("lifecycle", 22, "First 30 days", `Day ${Math.max(0, aon)} - the highest-loss window`);
  else if (aon <= 60) add("lifecycle", 16, "Days 31-60", `Day ${aon} of joining`);
  else if (aon <= 90) add("lifecycle", 11, "Days 61-90", `Day ${aon} of joining`);
  else if (aon <= 180) add("lifecycle", 6, "Months 4-6", `Day ${aon} - the post-probation slump`);
  else if (aon <= 365) add("lifecycle", 2, "First year", `Day ${aon} of joining`);
  if (f.walkIn && aon <= 45) add("lifecycle", 4, "Walk-in joiner", "Walk-in hires leave early more often");

  // ── attendance ──
  if (has(f.att60Pct)) {
    const a = f.att60Pct;
    const p = a < 70 ? 14 : a < 80 ? 10 : a < 88 ? 5 : a < 93 ? 2 : 0;
    add("attendance", p, "Low attendance", `${r1(a)}% of working days present in the last 60 days`);
  }
  if (has(f.attDeltaPts)) {
    const d = f.attDeltaPts;
    const p = d <= -15 ? 6 : d <= -8 ? 3 : 0;
    add("attendance", p, "Attendance falling", `${r1(Math.abs(d))} points lower than the 30 days before`);
  }
  const streak = f.absentStreak ?? 0;
  const absent7 = f.absent7 ?? 0;
  if (streak >= 3) add("attendance", 8, "Absent streak", `${streak} absent days in a row - check before it becomes absconding`);
  else if (streak === 2) add("attendance", 4, "Absent two days running", "Two absent days in a row");
  else if (absent7 >= 3) add("attendance", 3, "Frequent absence this week", `${absent7} absent days in the last 7`);
  if (has(f.late30)) add("attendance", f.late30 > 10 ? 4 : f.late30 > 6 ? 2 : 0, "Repeated late marks", `${f.late30} late marks in 30 days`);
  if (has(f.leaveCount60) && f.leaveCount60 >= 4) add("attendance", 3, "Frequent leave", `${f.leaveCount60} leave applications in 60 days`);
  if (has(f.reg60) && f.reg60 >= 5) add("attendance", 3, "Many regularisations", `${f.reg60} attendance corrections requested in 60 days`);

  // ── performance ──
  if (has(f.kpiScore)) {
    const k = f.kpiScore;
    add("performance", k < 60 ? 10 : k < 75 ? 6 : k < 85 ? 2 : 0, "Low KPI score", `Latest KPI score ${r1(k)}`);
  }
  if (has(f.kpiDelta) && f.kpiDelta <= -10) add("performance", 5, "KPI score dropping", `${r1(Math.abs(f.kpiDelta))} points down on the previous period`);
  if (has(f.quality60)) {
    const q = f.quality60;
    add("performance", q < 65 ? 8 : q < 75 ? 4 : 0, "Low call quality", `Average quality ${r1(q)}% over 60 days`);
  }
  if (has(f.qualityVelocity)) {
    const v = f.qualityVelocity;
    add("performance", v < -15 ? 6 : v < -8 ? 3 : 0, "Quality declining", `${r1(Math.abs(v))} points lower than the 30 days before`);
  }

  // ── compensation ──
  if (has(f.peerCtcRatio)) {
    const x = f.peerCtcRatio;
    add("compensation", x < 0.85 ? 6 : x < 0.93 ? 3 : 0, "Paid below peers", `${Math.round(x * 100)}% of the average pay for the same designation`);
  }
  if (has(f.monthsSinceIncrement) && has(f.tenureMonths)) {
    const m = f.monthsSinceIncrement;
    if (f.tenureMonths >= 18 && m >= 18) add("compensation", 4, "No increment in 18+ months", `Last increment ${Math.round(m)} months ago`);
    else if (f.tenureMonths >= 12 && m >= 12) add("compensation", 2, "No increment in a year", `Last increment ${Math.round(m)} months ago`);
  } else if (has(f.tenureMonths) && f.tenureMonths >= 18 && f.monthsSinceIncrement == null) {
    add("compensation", 4, "No increment on record", `${Math.round(f.tenureMonths)} months of service, no increment recorded`);
  }
  if (has(f.ctc) && f.ctc > 0) add("compensation", f.ctc < 12000 ? 4 : f.ctc < 15000 ? 2 : 0, "Entry-level pay", "CTC is at the low end of the pay scale");

  // ── conduct & hygiene ──
  const ws = f.warningSeverity ?? 0;
  if (ws > 0) add("conduct", ws >= 3 ? 8 : ws === 2 ? 5 : 3, "Active warning", ws >= 3 ? "Final warning on file" : ws === 2 ? "Written warning on file" : "Verbal warning on file");
  if ((f.warningCount ?? 0) >= 2) add("conduct", 2, "Repeat warnings", `${f.warningCount} active warnings`);
  if (f.activePip) add("conduct", 5, "On a PIP", "Active performance improvement plan");
  if (has(f.hygieneMissing)) add("conduct", f.hygieneMissing >= 3 ? 4 : f.hygieneMissing === 2 ? 2 : 0, "Profile gaps", `${f.hygieneMissing} key profile items missing (PAN, UAN, mobile, bank, personal email)`);

  // ── team ──
  if (has(f.teamExitRate90)) {
    const t = f.teamExitRate90;
    add("team", t >= 0.25 ? 10 : t >= 0.15 ? 6 : t >= 0.08 ? 3 : 0, "Team is losing people", `${Math.round(t * 100)}% of this manager's team left in 90 days`);
  }

  const factors = { lifecycle: 0, attendance: 0, performance: 0, compensation: 0, conduct: 0, team: 0 } as Record<FactorGroup, number>;
  for (const r of reasons) factors[r.group] += r.points;
  for (const g of FACTOR_GROUP_ORDER) factors[g] = Math.min(factors[g], FACTOR_CAPS[g]);
  const score = Math.min(100, FACTOR_GROUP_ORDER.reduce((s, g) => s + factors[g], 0));
  reasons.sort((a, b) => b.points - a.points);
  return { factors, score, tier: tierOf(score), reasons };
}

/** Suggested next steps, driven by the reasons that fired (max 4, no duplicates). */
export function suggestActions(reasons: Reason[], tier: Tier): string[] {
  const out: string[] = [];
  const has_ = (label: string) => reasons.some((r) => r.label === label);
  const groups = new Set(reasons.map((r) => r.group));
  if (has_("Absent streak") || has_("Absent two days running")) out.push("Call the employee today and record the outcome; start the absconding notice process if unreachable.");
  if (groups.has("lifecycle") && reasons.some((r) => r.group === "lifecycle" && r.points >= 11)) out.push("Hold a 1:1 stay interview this week and pair with a buddy or floor mentor.");
  if (groups.has("compensation")) out.push("Review pay against the designation band and check increment eligibility with HR.");
  if (groups.has("performance")) out.push("Agree a short coaching plan with the manager and re-check the score in two weeks.");
  if (has_("Low attendance") || has_("Attendance falling") || has_("Repeated late marks")) out.push("Ask about shift fit and commute; consider a shift or roster change.");
  if (has_("Team is losing people")) out.push("Escalate to the process head: review this manager's team handling and workload.");
  if (has_("Profile gaps")) out.push("Get the missing profile documents completed - it also closes compliance gaps.");
  if (!out.length && (tier === "CRITICAL" || tier === "HIGH")) out.push("Manager to hold a 1:1 within 3 days and log what is driving the risk.");
  return out.slice(0, 4);
}

/** Area under the ROC curve by rank (Mann-Whitney); null when one class is empty. */
export function aucOf(rows: { score: number; leaver: boolean }[]): number | null {
  const pos = rows.filter((r) => r.leaver).length;
  const neg = rows.length - pos;
  if (!pos || !neg) return null;
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  let rankSum = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (sorted[k].leaver) rankSum += avgRank;
    i = j;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Cumulative gain: flag people highest score first; how much of the real leaving does that catch? */
export function gainCurve(rows: { score: number; leaver: boolean }[], points = 20): { popPct: number; leaverPct: number }[] {
  const total = rows.length;
  const leavers = rows.filter((r) => r.leaver).length;
  if (!total || !leavers) return [];
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const out = [{ popPct: 0, leaverPct: 0 }];
  let caught = 0;
  let next = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].leaver) caught++;
    const pop = ((i + 1) / total) * 100;
    if (pop >= (next * 100) / points - 1e-9 || i === sorted.length - 1) {
      out.push({ popPct: Math.round(pop * 10) / 10, leaverPct: Math.round((caught / leavers) * 1000) / 10 });
      next = Math.floor((pop * points) / 100) + 1;
    }
  }
  return out;
}
