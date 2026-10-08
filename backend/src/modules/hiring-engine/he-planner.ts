/**
 * Hiring planner (pure): "to get N selected by a date, what must happen per source per day, and how many recruiters?"
 * Port of the Source-of-Truth sheet's reverse funnel: smoothed historical rates (small samples pulled toward the
 * baseline), 90% of the target from the top sources by volume, a buffer, and recruiter capacity per day.
 */
export interface SourceHistory { source: string; attempts: number; uniqueLeads: number; walkins: number; selected: number; joined: number }
export interface PlannerInput {
  targetSelected: number;
  days: number;
  bufferPct?: number;
  history: SourceHistory[];
  callsPerRecruiterDay?: number;
  walkinsPerRecruiterDay?: number;
  selectionsPerRecruiterDay?: number;
}
export interface SourcePlan {
  source: string; expectedSelected: number; uniqueLeads: number; walkins: number; callAttempts: number;
  dailyCalls: number; dailyLeads: number; dailyWalkins: number;
  rates: { leadToWalkin: number; walkinToSelected: number; callToLead: number; selectedToJoined: number };
  sample: "high" | "usable" | "low";
}
export interface Plan {
  targetSelected: number; withBuffer: number; days: number;
  totals: { uniqueLeads: number; walkins: number; callAttempts: number; expectedJoined: number };
  daily: { calls: number; leads: number; walkins: number; selected: number };
  recruiters: { forCalling: number; forWalkins: number; forClosures: number; needed: number };
  risk: "normal" | "medium" | "high";
  sources: SourcePlan[];
  notes: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Bayesian smoothing: (success + base*prior) / (total + prior), clamped. */
export function smooth(success: number, total: number, base: number, prior: number, lo: number, hi: number): number {
  base = clamp(base, lo, hi);
  if (!total) return base;
  return clamp((success + base * prior) / (total + prior), lo, hi);
}

export function buildPlan(i: PlannerInput): Plan {
  const days = Math.max(1, Math.floor(i.days));
  const target = Math.max(1, Math.floor(i.targetSelected));
  const withBuffer = Math.ceil(target * (1 + Math.max(0, i.bufferPct ?? 15) / 100));
  const callCap = i.callsPerRecruiterDay ?? 80, walkCap = i.walkinsPerRecruiterDay ?? 20, selCap = i.selectionsPerRecruiterDay ?? 8;
  const hist = i.history.filter((h) => h.uniqueLeads > 0);
  const all = hist.reduce((a, h) => ({ attempts: a.attempts + h.attempts, uniqueLeads: a.uniqueLeads + h.uniqueLeads, walkins: a.walkins + h.walkins, selected: a.selected + h.selected, joined: a.joined + h.joined }), { attempts: 0, uniqueLeads: 0, walkins: 0, selected: 0, joined: 0 });
  const base = {
    leadToWalkin: all.uniqueLeads ? all.walkins / all.uniqueLeads : 0.2,
    walkinToSelected: all.walkins ? all.selected / all.walkins : 0.3,
    callToLead: all.attempts ? all.uniqueLeads / all.attempts : 0.55,
    selectedToJoined: all.selected ? all.joined / all.selected : 0.6,
  };
  const notes: string[] = [];
  const rows = (hist.length ? hist : [{ source: "General sourcing", attempts: 0, uniqueLeads: 0, walkins: 0, selected: 0, joined: 0 }])
    .slice().sort((a, b) => b.uniqueLeads - a.uniqueLeads);
  if (!hist.length) notes.push("No history for this branch/process: conservative default rates used.");
  const top = rows.slice(0, 4), backup = rows.slice(4, 8);
  const primaryTarget = backup.length ? Math.ceil(withBuffer * 0.9) : withBuffer;
  const alloc = (bucket: SourceHistory[], tgt: number, primary: boolean): Array<[SourceHistory, number]> => {
    const vol = bucket.reduce((a, r) => a + Math.max(1, r.uniqueLeads), 0);
    let left = tgt; const out: Array<[SourceHistory, number]> = [];
    bucket.forEach((r, idx) => {
      const share = Math.min(primary ? 0.45 : 0.12, Math.max(0.1, Math.max(1, r.uniqueLeads) / vol));
      let n = idx === bucket.length - 1 ? left : Math.max(1, Math.round(tgt * share));
      n = Math.min(n, left); left -= n;
      if (n > 0) out.push([r, n]);
    });
    return out;
  };
  const picks = [...alloc(top, primaryTarget, true), ...alloc(backup, withBuffer - primaryTarget, false)];
  const sources: SourcePlan[] = picks.map(([r, sel]) => {
    const exact: SourcePlan["sample"] = r.uniqueLeads >= 120 && r.selected >= 12 ? "high" : r.uniqueLeads >= 50 && r.selected >= 5 ? "usable" : "low";
    const prior = exact === "high" ? 25 : exact === "usable" ? 45 : 90;
    const rates = {
      leadToWalkin: smooth(r.walkins, r.uniqueLeads, base.leadToWalkin, prior, 0.08, 0.75),
      walkinToSelected: smooth(r.selected, r.walkins, base.walkinToSelected, prior, 0.1, 0.7),
      callToLead: smooth(r.uniqueLeads, r.attempts || r.uniqueLeads, base.callToLead, prior, 0.25, 0.8),
      selectedToJoined: smooth(r.joined, r.selected, base.selectedToJoined, prior, 0.2, 0.85),
    };
    const walkins = Math.ceil(sel / rates.walkinToSelected);
    const uniqueLeads = Math.ceil(walkins / rates.leadToWalkin);
    const callAttempts = Math.ceil(uniqueLeads / rates.callToLead);
    return { source: r.source, expectedSelected: sel, uniqueLeads, walkins, callAttempts, dailyCalls: Math.ceil(callAttempts / days), dailyLeads: Math.ceil(uniqueLeads / days), dailyWalkins: Math.ceil(walkins / days), rates, sample: exact };
  }).sort((a, b) => b.expectedSelected - a.expectedSelected);
  const totals = sources.reduce((a, s) => ({ uniqueLeads: a.uniqueLeads + s.uniqueLeads, walkins: a.walkins + s.walkins, callAttempts: a.callAttempts + s.callAttempts, expectedJoined: a.expectedJoined + Math.round(s.expectedSelected * s.rates.selectedToJoined) }), { uniqueLeads: 0, walkins: 0, callAttempts: 0, expectedJoined: 0 });
  const daily = { calls: Math.ceil(totals.callAttempts / days), leads: Math.ceil(totals.uniqueLeads / days), walkins: Math.ceil(totals.walkins / days), selected: Math.round((withBuffer / days) * 10) / 10 };
  const recruiters = { forCalling: Math.ceil(daily.calls / callCap), forWalkins: Math.ceil(daily.walkins / walkCap), forClosures: Math.ceil(withBuffer / days / selCap), needed: 0 };
  recruiters.needed = Math.max(recruiters.forCalling, recruiters.forWalkins, recruiters.forClosures);
  const risk = days <= 3 || daily.calls > 350 || target / days > 8 ? "high" : daily.calls > 180 || target / days > 4 ? "medium" : "normal";
  if (sources.some((s) => s.sample === "low")) notes.push("Some sources have little history; their rates are pulled toward the overall average, not taken at face value.");
  if (days <= 3) notes.push("Very tight timeline: run every recommended source in parallel and keep same-day interview slots open.");
  if (totals.expectedJoined < target) notes.push(`Expected joiners (${totals.expectedJoined}) are below the target; selections drop off before joining, so plan above ${target}.`);
  return { targetSelected: target, withBuffer, days, totals, daily, recruiters, risk, sources, notes };
}
