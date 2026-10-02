import type { DrillData, DrillFilters, DrillSplit } from "@/hooks/useAtsDashboards";
import type { Cohorts, Leakage } from "@/hooks/useAtsCommandCenter";
import type { InsightTone } from "./cc-viz";
import { leakageOutcome } from "./outcomes-helpers";

/** Pure logic for the scoped (branch head / process manager) Quality & Outcomes tab. Built only on row-scoped data: drill, leakage, cohorts. */

export interface ScopedFinding { tone: InsightTone; title: string; body?: string; drill?: { crumb: string; extra: DrillFilters } }
export const MIN_SAMPLE = 10;
const DOW = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const r1 = (n: number) => Math.round(n * 10) / 10;
const pctOf = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : 0);
const n0 = (n: number) => n.toLocaleString("en-IN");

/** Split row with every rate filled in (older backends omit some). */
export interface OutcomeRow { name: string; total: number; selected: number; rejected: number; noShow: number; joined: number; selRate: number; rejRate: number; noShowRate: number; joinRate: number }
export const normalizeSplit = (s: DrillSplit): OutcomeRow => ({
  name: s.name, total: s.total, selected: s.selected, rejected: s.rejected, noShow: s.noShow ?? 0, joined: s.joined ?? 0,
  selRate: s.selRate ?? pctOf(s.selected, s.total), rejRate: s.rejRate ?? pctOf(s.rejected, s.total),
  noShowRate: s.noShowRate ?? pctOf(s.noShow ?? 0, s.total), joinRate: s.joinRate ?? pctOf(s.joined ?? 0, s.total),
});
export const outcomeRows = (rows: DrillSplit[] | undefined): OutcomeRow[] => (rows ?? []).filter((r) => r.total > 0).map(normalizeSplit).sort((a, b) => b.total - a.total);

/** Best and weakest row by selection rate among rows with at least `min` candidates. Null when fewer than two qualify. */
export function bestWorst(rows: OutcomeRow[], min = MIN_SAMPLE): { best: OutcomeRow; worst: OutcomeRow; gap: number } | null {
  const r = rows.filter((x) => x.total >= min && x.name && x.name !== "Unspecified" && x.name !== "Not stated").sort((a, b) => b.selRate - a.selRate);
  return r.length > 1 ? { best: r[0], worst: r[r.length - 1], gap: r1(r[0].selRate - r[r.length - 1].selRate) } : null;
}

/** Row with the worst no-show rate (min sample), only when it is clearly above the overall rate. */
export function noShowHotspot(rows: OutcomeRow[], overall: number, min = MIN_SAMPLE, margin = 5): OutcomeRow | null {
  const top = rows.filter((x) => x.total >= min && x.noShow > 0).sort((a, b) => b.noShowRate - a.noShowRate)[0];
  return top && top.noShowRate - overall >= margin ? top : null;
}

export interface StageRejection { name: string; rejected: number; total: number; rate: number; share: number }
/** Stages ranked by rejected count, with the rate (rejected of everyone seen there) and share of all rejections. */
export function rankStageRejections(stages: DrillSplit[] | undefined): StageRejection[] {
  const rows = (stages ?? []).filter((s) => s.rejected > 0);
  const all = rows.reduce((a, s) => a + s.rejected, 0);
  return rows.map((s) => ({ name: s.name, rejected: s.rejected, total: s.total, rate: s.rejRate ?? pctOf(s.rejected, s.total), share: pctOf(s.rejected, all) })).sort((a, b) => b.rejected - a.rejected);
}

/* ───────── Leakage ───────── */
/** The offer-to-join chain: starts at Selected (Registered is the whole pool, not part of it). */
export function leakageChain(l: Leakage | undefined) {
  const all = l?.stages ?? [];
  const i = all.findIndex((x) => x.key === "selected" || /select/i.test(x.label));
  return i > 0 ? all.slice(i) : all;
}
const stageIdx = (chain: { key: string; label: string }[], re: RegExp) => chain.findIndex((s) => re.test(`${s.key} ${s.label}`));

/** Share of the previous step that reached a step matching `re` (approved offers, BGV clear). Null when the step is absent or has no base. */
export function stepSurvival(l: Leakage | undefined, re: RegExp): { pct: number; n: number; of: number; key: string; label: string } | null {
  const chain = leakageChain(l), i = stageIdx(chain, re);
  if (i < 1 || chain[i - 1].n <= 0) return null;
  return { pct: pctOf(chain[i].n, chain[i - 1].n), n: chain[i].n, of: chain[i - 1].n, key: chain[i].key, label: chain[i].label };
}
export const offersApproved = (l?: Leakage) => stepSurvival(l, /approv/i);
export const bgvSurvival = (l?: Leakage) => stepSurvival(l, /bgv|background/i);

export function biggestLoss(l: Leakage | undefined) {
  const chain = leakageChain(l);
  let worst: { from: (typeof chain)[number]; to: (typeof chain)[number]; lost: number; rate: number } | null = null;
  for (let i = 1; i < chain.length; i++) {
    const lost = chain[i - 1].n - chain[i].n;
    if (lost > (worst?.lost ?? 0)) worst = { from: chain[i - 1], to: chain[i], lost, rate: chain[i - 1].n ? lost / chain[i - 1].n : 0 };
  }
  return worst;
}

/* ───────── Findings ───────── */
export function buildScopedFindings({ drill: d, leakage, cohorts }: { drill?: DrillData | null; leakage?: Leakage | null; cohorts?: Cohorts | null }): ScopedFinding[] {
  const out: ScopedFinding[] = [];
  const k = d?.kpis;
  if (d && k && k.total > 0) {
    for (const [dim, label] of [["process", "process"], ["source", "source"]] as const) {
      const bw = bestWorst(outcomeRows(d.splits?.[dim]));
      if (bw && bw.gap >= 8) {
        out.push({ tone: "good", title: `Best ${label}: ${bw.best.name} selects ${bw.best.selRate}%`, body: `${r1(bw.best.selRate - k.selRate)} pts above the view (${n0(bw.best.total)} candidates).`, drill: { crumb: bw.best.name, extra: { [dim]: bw.best.name } as DrillFilters } });
        out.push({ tone: "warn", title: `Weakest ${label}: ${bw.worst.name} selects ${bw.worst.selRate}%`, body: `${r1(k.selRate - bw.worst.selRate)} pts below the view (${n0(bw.worst.total)} candidates).`, drill: { crumb: bw.worst.name, extra: { [dim]: bw.worst.name } as DrillFilters } });
      }
    }
    const wk = (d.weekday ?? []).filter((w) => w.total >= MIN_SAMPLE).sort((a, b) => b.selRate - a.selRate);
    if (wk.length >= 3 && wk[0].selRate - wk[wk.length - 1].selRate >= 12) {
      const b = wk[0], w = wk[wk.length - 1];
      out.push({ tone: "info", title: `${DOW[b.dow]} converts best (${b.selRate}%), ${DOW[w.dow]} worst (${w.selRate}%)`, body: `A ${r1(b.selRate - w.selRate)}-point weekday gap.`, drill: { crumb: `${DOW[w.dow]} arrivals`, extra: { dow: w.dow } } });
    }
    for (const dim of ["recruiter", "source"] as const) {
      const h = noShowHotspot(outcomeRows(d.splits?.[dim]), k.noShowRate);
      if (h) { out.push({ tone: "bad", title: `No-show hotspot: ${h.name} at ${h.noShowRate}%`, body: `${r1(h.noShowRate - k.noShowRate)} pts above the view's ${k.noShowRate}% (${n0(h.noShow)} of ${n0(h.total)} ${dim === "recruiter" ? "candidates handled" : "candidates"}).`, drill: { crumb: `No-show · ${h.name}`, extra: { [dim]: h.name, outcome: "noShow" } as DrillFilters } }); break; }
    }
    const st = rankStageRejections(d.splits?.stage), allRej = st.reduce((a, s) => a + s.rejected, 0);
    if (st[0] && allRej >= 20 && st[0].share >= 40) out.push({ tone: "warn", title: `${st[0].share}% of rejections happen at ${st[0].name}`, body: `${n0(st[0].rejected)} of ${n0(allRej)} rejected candidates.`, drill: { crumb: `Rejected at ${st[0].name}`, extra: { stage: st[0].name, outcome: "rejected" } } });
  }
  const loss = biggestLoss(leakage ?? undefined);
  if (loss && loss.lost > 0) out.push({ tone: loss.rate > 0.25 ? "bad" : "warn", title: `Biggest offer-to-join loss: ${loss.from.label} to ${loss.to.label}`, body: `${n0(loss.lost)} lost (${Math.round(loss.rate * 100)}% of ${n0(loss.from.n)}).`, drill: { crumb: `Lost before ${loss.to.label}`, extra: { outcome: leakageOutcome(loss.from.key, loss.from.label) } } });

  const cs = (cohorts?.cohorts ?? []).filter((c) => c.total > 0);
  // The newest week is still maturing, so compare the 4 weeks before it with the 8 before those.
  if (cs.length >= 8) {
    const done = cs.slice(0, -1), recent = done.slice(-4), prior = done.slice(-12, -4);
    const rate = (xs: typeof cs) => pctOf(xs.reduce((a, c) => a + c.selected, 0), xs.reduce((a, c) => a + c.total, 0));
    const rn = recent.reduce((a, c) => a + c.total, 0), pn = prior.reduce((a, c) => a + c.total, 0);
    if (rn >= 30 && pn >= 30) {
      const ch = r1(rate(recent) - rate(prior));
      if (Math.abs(ch) >= 4) out.push({ tone: ch > 0 ? "good" : "warn", title: `Recent cohorts select ${Math.abs(ch)} pts ${ch > 0 ? "more" : "less"} than earlier ones`, body: `${rate(recent)}% over the last 4 full weeks against ${rate(prior)}% before.` });
    }
  }
  return out.slice(0, 9);
}
