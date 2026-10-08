// The rule funnel and the preview sample (plan 2026-10-09, S10). Pure.
// Steps: system exclusions, then one step per MUST rule in compiled order, then HR exclusions when there are any.
// A person leaves the funnel at their FIRST failing step; people whose unknown goes to review stay in and are counted in reviewHere.
// An HR include passes the person past every rule (never past a system block); an HR exclude fails them at the override step.
import type { CompiledCriteria, Evaluation, Verdict } from "./selection-types.js";

export interface FunnelStep {
  key: string; label: string; kind: "system" | "must" | "override";
  remaining: number; failedHere: number; reviewHere: number; onlyThisRuleFails: number; ifRemovedGain: number;
}
export interface FunnelResult {
  steps: FunnelStep[];
  outcome: { shortlist: number; review: number; rejected: number; systemExcluded: number };
  scoreBuckets: Array<{ from: number; to: number; n: number }>;
}
type Row = { e: Evaluation };

/** The verdict after HR overrides (system blocks are never lifted). */
export function finalVerdict(e: Evaluation): Verdict {
  if (e.systemBlock) return "fail";
  if (e.override?.kind === "include") return "pass";
  if (e.override?.kind === "exclude") return "fail";
  return e.verdict;
}

function shape(e: Evaluation) {
  const system = !!e.systemBlock;
  const include = !system && e.override?.kind === "include";
  const exclude = !system && !include && e.override?.kind === "exclude";
  const results = [...e.passed, ...e.failed, ...e.unknown].filter((r) => r.mode === "must" && r.index !== undefined);
  const fails = include ? [] : results.filter((r) => r.effect === "fail").map((r) => r.index!);
  const reviews = include ? [] : results.filter((r) => r.effect === "review").map((r) => r.index!);
  return { system, exclude, fails, reviews, firstFail: fails.length ? Math.min(...fails) : null };
}

export function buildFunnel(rows: Row[], c: CompiledCriteria): FunnelResult {
  const shaped = rows.map((r) => ({ ...shape(r.e), e: r.e }));
  const steps: FunnelStep[] = [];
  const systemN = shaped.filter((s) => s.system).length;
  let remaining = rows.length - systemN;
  steps.push({ key: "system", label: "System rules (never contacted)", kind: "system", remaining, failedHere: systemN, reviewHere: 0, onlyThisRuleFails: systemN, ifRemovedGain: 0 });
  const live = shaped.filter((s) => !s.system);
  c.rules.forEach((rule, k) => {
    if (rule.mode !== "must") return;
    const failedHere = live.filter((s) => s.firstFail === k).length;
    const reviewHere = live.filter((s) => (s.firstFail === null || s.firstFail > k) && s.reviews.includes(k)).length;
    const only = live.filter((s) => s.fails.length > 0 && s.fails.every((i) => i === k));
    remaining -= failedHere;
    steps.push({ key: rule.key, label: rule.requiredText ? `${rule.label}: ${rule.requiredText}` : rule.label, kind: "must", remaining, failedHere, reviewHere,
      onlyThisRuleFails: only.length, ifRemovedGain: only.filter((s) => s.reviews.length === 0).length });
  });
  const excluded = live.filter((s) => s.exclude && s.firstFail === null).length;
  if (live.some((s) => s.exclude)) {
    remaining -= excluded;
    steps.push({ key: "override", label: "Excluded by HR", kind: "override", remaining, failedHere: excluded, reviewHere: 0, onlyThisRuleFails: excluded, ifRemovedGain: 0 });
  }
  const outcome = { shortlist: 0, review: 0, rejected: 0, systemExcluded: systemN };
  const buckets = [0, 20, 40, 60, 80].map((from) => ({ from, to: from + 20, n: 0 }));
  for (const s of live) {
    const v = finalVerdict(s.e);
    if (v === "fail") { outcome.rejected++; continue; }
    if (v === "pass") outcome.shortlist++; else outcome.review++;
    buckets[Math.min(4, Math.floor(s.e.score / 20))].n++;
  }
  return { steps, outcome, scoreBuckets: buckets };
}

/** The preview sample: 20 shortlisted by score, 15 in review by score, 15 rejected by the step they failed at (system first). */
export function pickSample<T extends Row>(rows: T[], _c: CompiledCriteria, sizes = { shortlist: 20, review: 15, rejected: 15 }): T[] {
  const byScore = (a: T, b: T) => b.e.score - a.e.score;
  const failStep = (r: T) => (r.e.systemBlock ? -1 : shape(r.e).firstFail ?? Number.MAX_SAFE_INTEGER);
  const pass = rows.filter((r) => finalVerdict(r.e) === "pass").sort(byScore).slice(0, sizes.shortlist);
  const review = rows.filter((r) => finalVerdict(r.e) === "review").sort(byScore).slice(0, sizes.review);
  const rejected = rows.filter((r) => finalVerdict(r.e) === "fail").sort((a, b) => failStep(a) - failStep(b) || byScore(a, b)).slice(0, sizes.rejected);
  return [...pass, ...review, ...rejected];
}
