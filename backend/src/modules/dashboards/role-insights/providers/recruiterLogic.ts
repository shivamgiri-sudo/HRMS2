import { canonicalBranch, canonicalSource, preferredRecruiterName, recruiterKey, sourceLabel } from "../../../ats/ats-vocabulary.js";

/**
 * Pure calculations behind the recruiter dashboard. Kept free of I/O so each rule is unit-tested.
 *
 * Funnel semantics: ats_candidate.current_stage is a CURRENT-stage snapshot (disjoint buckets), so
 * counting rows per stage is not a funnel. A candidate's depth is the furthest step they have ever
 * reached — max over current stage, status, the stage-transition log and the employee link — and a
 * step's width is the number of candidates with depth >= that step. That is monotone by construction.
 */
export const FUNNEL_STEPS = [
  { key: "registered", label: "Registered" },
  { key: "hr", label: "HR screening" },
  { key: "ops", label: "Ops / skill round" },
  { key: "client", label: "Client / final" },
  { key: "selected", label: "Selected" },
  { key: "link", label: "Onboarding link sent" },
  { key: "profile", label: "Profile submitted" },
  { key: "offer", label: "Offer approved" },
  { key: "joined", label: "Joined" },
] as const;
export const JOINED_DEPTH = FUNNEL_STEPS.length - 1;
const SELECTED_DEPTH = 4;
const LINK_DEPTH = 5;
const PROFILE_DEPTH = 6;
const OFFER_DEPTH = 7;

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const STAGE_DEPTH: Record<string, number> = {
  applied: 0, new: 0, registered: 0, arrived: 0, arrival: 0, waiting: 0,
  "round 1- hr screening": 1, "round 1 - hr screening": 1, screening: 1,
  "interview - skill test": 2, interview: 2, assessment: 2, "round 2- op's": 2, "round 2 - op's": 2, "ops round": 2,
  "round 3- client": 3, "round 3 - client": 3, "client round": 3, "selection discussion": 3,
  selected: SELECTED_DEPTH,
  "onboarding link sent": LINK_DEPTH,
  "profile submitted": PROFILE_DEPTH, "bgv in progress": PROFILE_DEPTH, "offer submitted": PROFILE_DEPTH, "offer rejected": PROFILE_DEPTH,
  offer_approved: OFFER_DEPTH, offered: OFFER_DEPTH, payroll_validated: OFFER_DEPTH,
  converted: JOINED_DEPTH, onboarded: JOINED_DEPTH, joined: JOINED_DEPTH,
};
const STATUS_DEPTH: Record<string, number> = {
  "client round - pending": 3, selected: SELECTED_DEPTH, profile_submitted: PROFILE_DEPTH, hr_approved: PROFILE_DEPTH, hr_pushback: PROFILE_DEPTH,
};

/** Depth implied by a stage or status string; -1 when unrecognised (never forced into a bucket). */
export function stageDepth(stage: unknown): number { return STAGE_DEPTH[norm(stage)] ?? -1; }
export function statusDepth(status: unknown): number { return STATUS_DEPTH[norm(status)] ?? -1; }

export interface CohortCandidate {
  id: string;
  stage: string | null;
  status: string | null;
  source: string | null;
  recruiter: string | null;
  branch: string | null;
  process: string | null;
  createdDate: string;           // YYYY-MM-DD
  /** Last status change date; for a Selected candidate this is when they were selected. */
  updatedDate: string;
  walkInDate: string | null;     // YYYY-MM-DD
  /** Stage names this candidate has ever transitioned into (from ats_candidate_stage_log). */
  loggedStages: string[];
  joined: boolean;
}

export function candidateDepth(c: Pick<CohortCandidate, "stage" | "status" | "loggedStages" | "joined">): number {
  if (c.joined) return JOINED_DEPTH;
  return Math.max(0, stageDepth(c.stage), statusDepth(c.status), ...c.loggedStages.map(stageDepth));
}

export const CLOSED_STATUSES = new Set(["rejected", "no show", "inactive"]);
export const isClosed = (status: unknown) => CLOSED_STATUSES.has(norm(status));

export interface FunnelStep { key: string; label: string; reached: number; fromPrevPct: number | null; fromTopPct: number | null }

export function buildFunnel(depths: number[]): FunnelStep[] {
  const total = depths.length;
  return FUNNEL_STEPS.map((step, i) => {
    const reached = depths.filter((d) => d >= i).length;
    const prev = i === 0 ? null : depths.filter((d) => d >= i - 1).length;
    return {
      key: step.key,
      label: step.label,
      reached,
      fromPrevPct: prev === null || prev === 0 ? null : Math.round((reached / prev) * 1000) / 10,
      fromTopPct: total === 0 ? null : Math.round((reached / total) * 1000) / 10,
    };
  });
}

export const pctOf = (part: number, whole: number, digits = 1): number | null =>
  whole > 0 ? Math.round((part / whole) * 100 * 10 ** digits) / 10 ** digits : null;

/** Whole days from `from` (YYYY-MM-DD or ISO datetime) to `today` (YYYY-MM-DD); never negative. */
export function ageDays(from: string | null | undefined, today: string): number | null {
  if (!from) return null;
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(a) ? Math.max(0, Math.round((b - a) / 86_400_000)) : null;
}

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Source-wise yield: share of registered candidates that reached Selected / Joined. */
export interface SourceYield { source: string; registered: number; selected: number; joined: number; selectedPct: number | null; joinedPct: number | null }
export function sourceYield(cands: CohortCandidate[]): SourceYield[] {
  const map = new Map<string, { registered: number; selected: number; joined: number }>();
  for (const c of cands) {
    const key = sourceLabel(c.source);
    const row = map.get(key) ?? { registered: 0, selected: 0, joined: 0 };
    const d = candidateDepth(c);
    row.registered += 1;
    if (d >= SELECTED_DEPTH) row.selected += 1;
    if (d >= JOINED_DEPTH) row.joined += 1;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([source, r]) => ({ source, ...r, selectedPct: pctOf(r.selected, r.registered), joinedPct: pctOf(r.joined, r.registered) }))
    .sort((a, b) => b.registered - a.registered);
}

export interface RecruiterRow { recruiter: string; registered: number; screened: number; selected: number; joined: number; selectedPct: number | null; noShow: number }
/** League table. Identity is the case-folded, alias-resolved name (see recruiterKey), never a raw spelling. */
export function recruiterLeague(cands: CohortCandidate[]): RecruiterRow[] {
  const map = new Map<string, { names: string[]; registered: number; screened: number; selected: number; joined: number; noShow: number }>();
  for (const c of cands) {
    const key = recruiterKey(null, c.recruiter);
    const row = map.get(key) ?? { names: [], registered: 0, screened: 0, selected: 0, joined: 0, noShow: 0 };
    const d = candidateDepth(c);
    if (c.recruiter) row.names.push(c.recruiter);
    row.registered += 1;
    if (d >= 1) row.screened += 1;
    if (d >= SELECTED_DEPTH) row.selected += 1;
    if (d >= JOINED_DEPTH) row.joined += 1;
    if (norm(c.status) === "no show") row.noShow += 1;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([key, r]) => ({
      recruiter: key === "unassigned" ? "Unassigned" : preferredRecruiterName(r.names) || key,
      registered: r.registered, screened: r.screened, selected: r.selected, joined: r.joined, noShow: r.noShow,
      selectedPct: pctOf(r.selected, r.registered),
    }))
    .sort((a, b) => b.joined - a.joined || b.selected - a.selected || b.registered - a.registered);
}

/**
 * No-show rate: candidates marked No Show / candidates whose walk-in day has already passed.
 * Today's walk-ins are excluded from the denominator, they have not had the chance to no-show yet.
 */
export function noShowRate(cands: CohortCandidate[], today: string): { noShow: number; due: number; ratePct: number | null } {
  const due = cands.filter((c) => (c.walkInDate ?? c.createdDate) < today);
  const noShow = due.filter((c) => norm(c.status) === "no show").length;
  return { noShow, due: due.length, ratePct: pctOf(noShow, due.length) };
}

/** Per-day counts for the last `n` days ending `today`, oldest first. */
export function dailyCounts(dates: Array<string | null | undefined>, today: string, n: number): number[] {
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
  const by = new Map<string, number>();
  for (const d of dates) if (d) by.set(String(d).slice(0, 10), (by.get(String(d).slice(0, 10)) ?? 0) + 1);
  return days.map((d) => by.get(d) ?? 0);
}

export interface OfferRow { status: string; doj: string | null; approvedAt: string | null; submittedAt: string | null; joined: boolean }
/**
 * Offer outcomes. An approved offer is "due" once its joining date has passed; offer-to-join is
 * joined / due over the trailing window, so offers still waiting for their joining day never read
 * as drop-offs. Offers older than the window are excluded: the employee link (employees.candidate_id)
 * only exists for recent joiners, so counting them would invent no-shows.
 */
export function offerOutcomes<T extends OfferRow>(offers: T[], today: string, windowDays = 30) {
  const from = addDays(today, -windowDays);
  const approved = offers.filter((o) => o.status === "bh_approved");
  const due = approved.filter((o) => o.doj && o.doj >= from && o.doj < today);
  const joined = due.filter((o) => o.joined);
  const upcoming = approved.filter((o) => !o.joined && o.doj && o.doj >= today);
  const week = upcoming.filter((o) => (o.doj as string) <= addDays(today, 7));
  const ghosted = due.filter((o) => !o.joined && (o.doj as string) >= addDays(today, -14));
  const awaiting = offers.filter((o) => o.status === "submitted");
  const oldestAwaiting = awaiting.reduce<number | null>((m, o) => { const a = ageDays(o.submittedAt, today); return a === null ? m : Math.max(m ?? 0, a); }, null);
  return {
    dueCount: due.length, joinedCount: joined.length, offerToJoinPct: pctOf(joined.length, due.length),
    upcoming, week, ghosted,
    awaitingCount: awaiting.length, awaitingOver3d: awaiting.filter((o) => (ageDays(o.submittedAt, today) ?? 0) > 3).length, oldestAwaiting,
  };
}

export interface ReqRow { code: string; process: string | null; branch: string | null; requested: number; fulfilled: number; approvedAt: string | null; createdAt: string; target: string | null; priority: string | null }
export function requisitionAgeing(reqs: ReqRow[], today: string) {
  const open = reqs.map((r) => ({ ...r, open: Math.max(r.requested - r.fulfilled, 0), age: ageDays(r.approvedAt ?? r.createdAt, today) ?? 0 })).filter((r) => r.open > 0);
  const seats = open.reduce((s, r) => s + r.open, 0);
  const requested = reqs.reduce((s, r) => s + r.requested, 0);
  const fulfilled = reqs.reduce((s, r) => s + Math.min(r.fulfilled, r.requested), 0);
  const overdue = open.filter((r) => r.target && r.target < today);
  return {
    open, seats, fillPct: pctOf(fulfilled, requested), overdue,
    oldest: open.reduce<number | null>((m, r) => (m === null ? r.age : Math.max(m, r.age)), null),
    avgAge: open.length ? Math.round(open.reduce((s, r) => s + r.age, 0) / open.length) : null,
  };
}

export { canonicalBranch, canonicalSource };
