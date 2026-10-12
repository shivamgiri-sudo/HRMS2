/**
 * Branch hiring plan (pure). For each branch: joins still needed, walk-ins needed at the branch's own conversion rates, how many of
 * those are already booked, how many days the rest takes at the branch's walk-in pace, and what that costs at the branch's
 * cost per walk-in. Answers the CEO commitment: volume (walk-ins needed), timeline (days) and cost (rupees), at any time.
 *
 * Rates are the same smoothed rates the single-requisition planner uses (small samples pulled toward the all-branch rate), so the
 * two screens do not disagree. Any of the three rates and the daily pace can be overridden to ask "what if conversion improves".
 */
import { smooth } from "./he-planner.js";
import { SHOW_DEFAULTS } from "./he-showup.js";

export interface BranchHistory { branch: string; uniqueLeads: number; walkins: number; selected: number; joined: number }
export interface BranchSeats { branch: string; requisitions: number; requested: number; target: number; joined: number; pendingSelected: number; joinsLeft: number }
export interface BranchPace { branch: string; walkinsInWindow: number; joinedInWindow: number; windowDays: number }
export interface BranchBooked { branch: string; invited: number; confirmed: number }
export interface BranchPlanOverrides { walkinToSelected?: number | null; selectedToJoined?: number | null; walkinsPerDay?: number | null }

export interface BranchPlanRow {
  branch: string; requisitions: number; requested: number; joinTarget: number; joined: number; joinsLeft: number;
  /** Selected and not yet joined, and how many of them are expected to join at the selected-to-joined rate. */
  pendingSelected: number; expectedFromPending: number;
  rates: { walkinToSelected: number; selectedToJoined: number; source: "branch" | "all-branches" | "override" };
  selectionsNeeded: number; walkinsNeeded: number; bookedShows: number; walkinsToBring: number;
  walkinsPerDay: number | null; paceSource: "observed" | "override" | "none";
  daysToTarget: number | null; targetDate: string | null;
  cost: { perWalkin: number | null; perJoin: number | null; toTarget: number | null; spend: number };
  status: "covered" | "on_track" | "at_risk" | "no_history" | "no_pace";
  note: string | null;
}
export interface BranchPlan {
  rows: BranchPlanRow[];
  totals: { joinsLeft: number; walkinsNeeded: number; walkinsToBring: number; costToTarget: number | null; branchesAtRisk: number };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n?: number | null) => (n != null && Number.isFinite(n) ? clamp(n > 1 ? n / 100 : n, 0.01, 1) : null);

export function expectedShows(b: BranchBooked | undefined): number {
  if (!b) return 0;
  return Math.round(b.invited * SHOW_DEFAULTS["show.base.invited"] + b.confirmed * SHOW_DEFAULTS["show.base.confirmed"]);
}

export function addCalendarDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildBranchPlan(i: {
  today: string; seats: BranchSeats[]; history: BranchHistory[]; pace: BranchPace[]; booked: BranchBooked[];
  spendByBranch: Record<string, number>; overrides?: BranchPlanOverrides; deadlineDays?: number | null;
}): BranchPlan {
  const ov = i.overrides ?? {};
  const all = i.history.reduce((a, h) => ({ uniqueLeads: a.uniqueLeads + h.uniqueLeads, walkins: a.walkins + h.walkins, selected: a.selected + h.selected, joined: a.joined + h.joined }),
    { uniqueLeads: 0, walkins: 0, selected: 0, joined: 0 });
  const baseW2S = all.walkins ? all.selected / all.walkins : 0.3;
  const baseS2J = all.selected ? all.joined / all.selected : 0.6;
  const hist = new Map(i.history.map((h) => [h.branch, h]));
  const pace = new Map(i.pace.map((p) => [p.branch, p]));
  const booked = new Map(i.booked.map((b) => [b.branch, b]));
  const ovW2S = pct(ov.walkinToSelected), ovS2J = pct(ov.selectedToJoined);
  const ovPace = ov.walkinsPerDay != null && ov.walkinsPerDay > 0 ? ov.walkinsPerDay : null;

  const rows: BranchPlanRow[] = i.seats.filter((s) => s.joinsLeft > 0 || s.requisitions > 0).map((s) => {
    const h = hist.get(s.branch);
    const prior = h && h.walkins >= 50 ? 25 : 60;
    const w2s = ovW2S ?? smooth(h?.selected ?? 0, h?.walkins ?? 0, baseW2S, prior, 0.1, 0.7);
    const s2j = ovS2J ?? smooth(h?.joined ?? 0, h?.selected ?? 0, baseS2J, prior, 0.2, 0.85);
    const source: BranchPlanRow["rates"]["source"] = ovW2S || ovS2J ? "override" : h && h.walkins >= 20 ? "branch" : "all-branches";

    const expectedFromPending = Math.round(s.pendingSelected * s2j);
    const newJoinsNeeded = Math.max(0, s.joinsLeft - expectedFromPending);
    const selectionsNeeded = newJoinsNeeded > 0 ? Math.ceil(newJoinsNeeded / s2j) : 0;
    const walkinsNeeded = selectionsNeeded > 0 ? Math.ceil(selectionsNeeded / w2s) : 0;
    const bookedShows = Math.min(walkinsNeeded, expectedShows(booked.get(s.branch)));
    const walkinsToBring = walkinsNeeded - bookedShows;

    const p = pace.get(s.branch);
    const observed = p && p.windowDays > 0 && p.walkinsInWindow > 0 ? p.walkinsInWindow / p.windowDays : null;
    const walkinsPerDay = ovPace ?? (observed != null ? Math.round(observed * 10) / 10 : null);
    const paceSource: BranchPlanRow["paceSource"] = ovPace ? "override" : observed != null ? "observed" : "none";
    const daysToTarget = walkinsToBring === 0 ? 0 : walkinsPerDay ? Math.ceil(walkinsToBring / walkinsPerDay) : null;

    const spend = r2(i.spendByBranch[s.branch] ?? 0);
    const perWalkin = p && p.walkinsInWindow > 0 && spend > 0 ? r2(spend / p.walkinsInWindow) : null;
    const perJoin = p && p.joinedInWindow > 0 && spend > 0 ? r2(spend / p.joinedInWindow) : null;
    const toTarget = perWalkin != null ? r2(perWalkin * walkinsToBring) : walkinsToBring === 0 ? 0 : null;

    let status: BranchPlanRow["status"];
    let note: string | null = null;
    if (s.joinsLeft === 0) status = "covered";
    else if (walkinsToBring === 0) { status = "covered"; note = "Pending selections and booked walk-ins already cover the target."; }
    else if (daysToTarget == null) { status = "no_pace"; note = "No walk-in pace observed in the last 30 days: enter a daily walk-in figure to get a timeline."; }
    else if (i.deadlineDays != null && daysToTarget > i.deadlineDays) { status = "at_risk"; note = `Needs ${daysToTarget} days at ${walkinsPerDay} walk-ins a day; the deadline allows ${i.deadlineDays}.`; }
    else status = "on_track";
    if (!h || h.walkins < 20) note = (note ? note + " " : "") + "Few walk-ins on record at this branch: rates are the all-branch average.";
    if (status !== "covered" && toTarget == null) note = (note ? note + " " : "") + "No spend recorded for this branch in the window, so cost is not available.";
    return {
      branch: s.branch, requisitions: s.requisitions, requested: s.requested, joinTarget: s.target, joined: s.joined, joinsLeft: s.joinsLeft,
      pendingSelected: s.pendingSelected, expectedFromPending,
      rates: { walkinToSelected: r2(w2s), selectedToJoined: r2(s2j), source },
      selectionsNeeded, walkinsNeeded, bookedShows, walkinsToBring, walkinsPerDay, paceSource,
      daysToTarget, targetDate: daysToTarget == null ? null : addCalendarDays(i.today, daysToTarget),
      cost: { perWalkin, perJoin, toTarget, spend }, status, note,
    };
  });
  rows.sort((a, b) => b.joinsLeft - a.joinsLeft || a.branch.localeCompare(b.branch));
  const costs = rows.filter((r) => r.walkinsToBring > 0).map((r) => r.cost.toTarget);
  return {
    rows,
    totals: {
      joinsLeft: rows.reduce((a, r) => a + r.joinsLeft, 0), walkinsNeeded: rows.reduce((a, r) => a + r.walkinsNeeded, 0),
      walkinsToBring: rows.reduce((a, r) => a + r.walkinsToBring, 0),
      costToTarget: costs.length && costs.every((c) => c != null) ? r2(costs.reduce((a, c) => a + (c as number), 0)) : null,
      branchesAtRisk: rows.filter((r) => r.status === "at_risk" || r.status === "no_pace").length,
    },
  };
}
