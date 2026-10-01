import type { AtsInsights, DrillData, DrillFilters } from "@/hooks/useAtsDashboards";
import type { Leakage } from "@/hooks/useAtsCommandCenter";
import type { InsightTone } from "./cc-viz";

/** Pure logic for the Quality & Outcomes tab. Kept free of React so it can be unit tested. */

export interface OutcomeFinding { tone: InsightTone; title: string; body?: string; drill?: { crumb: string; extra: DrillFilters } }

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const monthLabel = (m: string) => new Date(`${m}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
export const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`; };
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rows with at least `min` candidates and a stated value. A rate on 4 people is noise. */
export const rateRows = (rows: AtsInsights["experience"], min = 10) => rows.filter((r) => r.total >= min && r.name !== "Not stated");

/** Share of measured decisions made in the first two buckets (the "within 3 hours" buckets). */
export function fastDecisionShare(speed: AtsInsights["decisionSpeed"]): { pct: number; measured: number } {
  const measured = speed.reduce((a, x) => a + x.n, 0), fast = speed.slice(0, 2).reduce((a, x) => a + x.n, 0);
  return { pct: measured ? Math.round((fast / measured) * 100) : 0, measured };
}

/** Offer-count weighted average of the per-process average offered salary. */
export function avgOfferedSalary(salary: AtsInsights["salary"]): number {
  const n = salary.reduce((a, s) => a + s.n, 0);
  return n ? salary.reduce((a, s) => a + s.avg * s.n, 0) / n : 0;
}

/* ───────── Reason x process matrix ───────── */
export interface ReasonRow { name: string; total: number; cells: Record<string, number> }
export interface ReasonMatrix { processes: string[]; rows: ReasonRow[] }

/**
 * Builds the reason x process grid from one drill result per reason (the drill was called with the voc filter, so its
 * `splits.process` counts rejected-for-that-reason candidates per process). Processes are ranked by total and capped.
 * `results` aligns by index with `reasons`; missing (still loading / failed) results are skipped.
 */
export function buildReasonProcessMatrix(reasons: string[], results: (DrillData | undefined | null)[], maxProcesses = 6): ReasonMatrix {
  const totals = new Map<string, number>();
  const rows: ReasonRow[] = [];
  reasons.forEach((reason, i) => {
    const d = results[i];
    if (!d) return;
    const cells: Record<string, number> = {};
    for (const s of d.splits?.process ?? []) {
      if (!s.total) continue;
      cells[s.name] = (cells[s.name] ?? 0) + s.total;
      totals.set(s.name, (totals.get(s.name) ?? 0) + s.total);
    }
    rows.push({ name: reason, total: Object.values(cells).reduce((a, b) => a + b, 0), cells });
  });
  const processes = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxProcesses).map(([p]) => p);
  return { processes, rows };
}

/* ───────── Interviewer calibration ───────── */
export interface InterviewerPoint { name: string; interviews: number; selected: number; rejected: number; passRate: number; z: number; delta: number; outlier: "high" | "low" | null }
export interface Calibration { peerAvg: number; sd: number; points: InterviewerPoint[] }

/**
 * Peer average is weighted by interviews (so it equals the pooled pass rate). An interviewer is an outlier when they have
 * at least `minN` interviews and sit more than `zCut` standard deviations from the peer average AND at least `minGap` points away.
 */
export function calibrateInterviewers(rows: AtsInsights["interviewers"], minN = 20, zCut = 1.5, minGap = 10): Calibration {
  const valid = rows.filter((r) => r.interviews > 0);
  const n = valid.reduce((a, r) => a + r.interviews, 0);
  const peerAvg = n ? valid.reduce((a, r) => a + r.passRate * r.interviews, 0) / n : 0;
  const variance = n ? valid.reduce((a, r) => a + r.interviews * (r.passRate - peerAvg) ** 2, 0) / n : 0;
  const sd = Math.sqrt(variance);
  const points = valid.map((r) => {
    const delta = round1(r.passRate - peerAvg), z = sd > 0 ? (r.passRate - peerAvg) / sd : 0;
    const flagged = r.interviews >= minN && Math.abs(z) >= zCut && Math.abs(delta) >= minGap;
    return { ...r, delta, z: round1(z), outlier: flagged ? (delta > 0 ? "high" : "low") : null } as InterviewerPoint;
  });
  return { peerAvg: round1(peerAvg), sd: round1(sd), points };
}

/* ───────── Leakage ───────── */
/** Maps a leakage step key/label onto the drill outcome filter. Unknown steps return undefined (drill the whole slice). */
export function leakageOutcome(key: string, label = ""): string | undefined {
  const s = `${key} ${label}`.toLowerCase();
  if (s.includes("join")) return "joined";
  // BGV runs after the offer, so a "BGV clear" step is a subset of the offered candidates.
  if (s.includes("offer") || s.includes("bgv")) return "offered";
  if (s.includes("select")) return "selected";
  return undefined;
}

/** Biggest single loss in the offer-to-join chain. */
export function topLeak(l: Leakage | undefined): { from: string; to: string; reason: string; n: number } | null {
  const rows = [...(l?.losses ?? [])].sort((a, b) => b.n - a.n);
  return rows[0] ?? null;
}

/** Stage after which most rejections happen. */
export const topDropoff = (d: { stage: string; n: number }[]) => [...d].sort((a, b) => b.n - a.n)[0];

/* ───────── Findings ───────── */
interface FindingInput {
  insights: AtsInsights;
  dropoff?: { stage: string; n: number }[];
  leakage?: Leakage;
  matrix?: ReasonMatrix;
}

const spread = (rows: AtsInsights["experience"], min: number) => {
  const r = rateRows(rows, min).sort((a, b) => b.selRate - a.selRate);
  return r.length > 1 ? { best: r[0], worst: r[r.length - 1], gap: round1(r[0].selRate - r[r.length - 1].selRate) } : null;
};

export function buildOutcomeFindings({ insights: d, dropoff = [], leakage, matrix }: FindingInput): OutcomeFinding[] {
  const out: OutcomeFinding[] = [];
  const top = d.rejectionReasons[0];
  if (top && top.share >= 15) out.push({ tone: "warn", title: `"${top.reason}" drives ${top.share}% of rejections`, body: d.rejectionReasons[1] ? `Next is "${d.rejectionReasons[1].reason}" at ${d.rejectionReasons[1].share}%.` : undefined, drill: { crumb: `Reason: ${top.reason}`, extra: { voc: top.reason } } });

  if (matrix && matrix.rows.length && matrix.processes.length) {
    let best: { reason: string; process: string; share: number; n: number } | null = null;
    for (const r of matrix.rows) for (const p of matrix.processes) {
      const n = r.cells[p] ?? 0;
      if (r.total >= 20 && n >= 10 && (!best || n / r.total > best.share)) best = { reason: r.name, process: p, share: n / r.total, n };
    }
    if (best && best.share >= 0.5) out.push({ tone: "info", title: `${Math.round(best.share * 100)}% of "${best.reason}" rejections sit in ${best.process}`, body: `${best.n.toLocaleString("en-IN")} candidates. Check the screening brief for that process.`, drill: { crumb: `${best.process} · ${best.reason}`, extra: { voc: best.reason, process: best.process } } });
  }

  const drop = topDropoff(dropoff);
  if (drop && drop.n > 0) out.push({ tone: "info", title: `Most rejections follow "${drop.stage}"`, body: `${drop.n.toLocaleString("en-IN")} candidates.`, drill: { crumb: `Rejected after ${drop.stage}`, extra: { stage: drop.stage, outcome: "rejected" } } });

  // Offer-to-join starts at Selected: the Registered step is the whole applicant pool, not part of this chain.
  const all = leakage?.stages ?? [];
  const sel = all.findIndex((x) => x.key === "selected");
  const stages = sel > 0 ? all.slice(sel) : all;
  if (stages.length > 1) {
    let worst = { i: 0, lost: 0, rate: 0 };
    for (let i = 1; i < stages.length; i++) {
      const lost = stages[i - 1].n - stages[i].n, rate = stages[i - 1].n ? lost / stages[i - 1].n : 0;
      if (lost > worst.lost) worst = { i, lost, rate };
    }
    const last = stages[stages.length - 1], first = stages[0];
    if (worst.lost > 0) out.push({ tone: worst.rate > 0.25 ? "bad" : "warn", title: `Biggest offer-to-join loss: ${stages[worst.i - 1].label} to ${stages[worst.i].label}`, body: `${worst.lost.toLocaleString("en-IN")} lost (${Math.round(worst.rate * 100)}%). ${first.n ? `${Math.round((last.n / first.n) * 100)}% make it end to end.` : ""}`, drill: { crumb: `Lost before ${stages[worst.i].label}`, extra: { outcome: leakageOutcome(stages[worst.i - 1].key, stages[worst.i - 1].label) } } });
  }

  const hard = [...d.rounds].filter((r) => r.sel + r.rej >= 30).sort((a, b) => a.passRate - b.passRate)[0];
  if (hard) out.push({ tone: hard.passRate < 40 ? "warn" : "info", title: `${hard.round} is the toughest gate at ${hard.passRate}% pass`, body: `${hard.rej.toLocaleString("en-IN")} rejected, ${hard.noShow.toLocaleString("en-IN")} no-shows.` });

  const cal = calibrateInterviewers(d.interviewers);
  const flagged = cal.points.filter((p) => p.outlier).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  if (flagged[0]) out.push({ tone: "warn", title: `${flagged[0].name} passes ${flagged[0].passRate}% against a ${cal.peerAvg}% peer average`, body: `${flagged.length} interviewer${flagged.length > 1 ? "s" : ""} sit outside the normal range. Worth a calibration review.`, drill: { crumb: `Interviewer: ${flagged[0].name}`, extra: { interviewer: flagged[0].name } } });

  const { pct, measured } = fastDecisionShare(d.decisionSpeed);
  const slow = d.decisionSpeed.slice(3).reduce((a, x) => a + x.n, 0);
  if (measured > 50 && slow / measured > 0.1) out.push({ tone: "warn", title: `${Math.round((slow / measured) * 100)}% of candidates wait over a day for a decision`, body: `${pct}% are decided within 3 hours.` });

  for (const [label, rows, key] of [["experience", d.experience, "experience"], ["education", d.education, "education"], ["night-shift stance", d.shift, "shift"]] as const) {
    const s = spread(rows, 30);
    if (s && s.gap >= 8) out.push({ tone: "info", title: `By ${label}, "${s.best.name}" converts ${s.best.selRate}% and "${s.worst.name}" ${s.worst.selRate}%`, body: `A ${s.gap}-point gap.`, drill: { crumb: `${label}: ${s.best.name}`, extra: { [key]: s.best.name } as DrillFilters } });
  }

  // The month still in progress has a few days of data; comparing it with a full month is misleading.
  const nowMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
  const m = d.monthly.filter((x) => String(x.month).slice(0, 7) !== nowMonth);
  if (m.length >= 2) {
    const a = m[m.length - 2], b = m[m.length - 1], ch = round1(b.selRate - a.selRate);
    if (Math.abs(ch) >= 2) out.push({ tone: ch > 0 ? "good" : "warn", title: `Selection rate ${ch > 0 ? "up" : "down"} ${Math.abs(ch)} pts month on month`, body: `${a.selRate}% in ${monthLabel(a.month)}, ${b.selRate}% in ${monthLabel(b.month)}.` });
  }
  return out.slice(0, 9);
}
