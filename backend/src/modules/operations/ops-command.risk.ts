import { addDays, daysBetween, type OpsCtx, type OpsDimension } from "./ops-command.context.js";
import { groupKey, isActiveAt, type DimView } from "./ops-command.dim.js";
import * as F from "./ops-command.facts.js";
import type { MetricMap } from "./ops-command.domains.js";

export type RiskLevel = "high" | "medium" | "low";
export interface RiskScore {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

export const RISK_HIGH = 65;
export const RISK_MEDIUM = 45;

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Composite retention-risk score per active employee, from facts already cached for the page. Formula is documented on
 * the `risk_high` metric definition; this is its only implementation.
 */
export async function computeRiskScores(ctx: OpsCtx, view: DimView): Promise<Map<string, RiskScore>> {
  const { from, to } = ctx.f;
  const attTo = to < ctx.attThrough ? to : ctx.attThrough;
  const [adr, warnings, pips, reqs, ext, training] = await Promise.all([
    from <= attTo ? F.adrRows(from, attTo) : Promise.resolve([]),
    F.warningsFact(addDays(to, -89), to),
    F.activePips(),
    F.exitRequests(),
    F.externalQuality(from, to),
    F.trainingFact(),
  ]);

  const att = new Map<string, { sched: number; absent: number; late: number; worked: number }>();
  for (const r of adr) {
    if (!view.byId.has(r.eid)) continue;
    const a = att.get(r.eid) ?? { sched: 0, absent: 0, late: 0, worked: 0 };
    if (!["week_off", "holiday", "week_off_worked"].includes(r.st)) a.sched++;
    if (r.st === "absent") a.absent++;
    if (r.late) a.late++;
    if (r.st === "present" || r.st === "half_day") a.worked++;
    att.set(r.eid, a);
  }
  const warnBy = new Map(warnings.map((w) => [w.eid, w]));
  const pipSet = new Set(pips);
  const qaByCode = new Map(ext.rows.map((r) => [r.code, r]));
  const redSet = new Set(training.filter((t) => t.red).map((t) => t.eid));

  const out = new Map<string, RiskScore>();
  for (const e of view.emps) {
    if (e.active !== 1 || !isActiveAt(e, to)) continue;
    let score = 0;
    const reasons: string[] = [];
    const a = att.get(e.id);
    if (a && a.sched >= 5 && a.absent > 0) {
      const rate = a.absent / a.sched;
      score += Math.min(40, rate * 100 * 1.6);
      reasons.push(`Absent ${a.absent} of ${a.sched} scheduled days (${Math.round(rate * 100)}%)`);
    }
    if (a && a.worked >= 5 && a.late > 0) {
      const rate = a.late / a.worked;
      score += Math.min(15, rate * 100 * 0.4);
      if (rate >= 0.2) reasons.push(`Late on ${Math.round(rate * 100)}% of days worked`);
    }
    const w = warnBy.get(e.id);
    if (w) {
      score += w.final > 0 ? 15 : 8;
      reasons.push(w.final > 0 ? "Final warning (90d)" : "Warning (90d)");
    }
    if (pipSet.has(e.id)) {
      score += 15;
      reasons.push("Active PIP");
    }
    const list = reqs.get(e.id) ?? [];
    if (list.some((r) => F.isOpenNotice(r.status))) {
      score += 30;
      reasons.push("Serving notice");
    } else if (list.some((r) => F.isPendingExit(r.status))) {
      score += 22;
      reasons.push("Resignation pending review");
    }
    if (e.doj) {
      const tenure = daysBetween(e.doj, to) - 1;
      if (tenure <= 30) { score += 12; reasons.push(`New joiner (${tenure}d)`); }
      else if (tenure <= 90) { score += 6; reasons.push(`First 90 days (${tenure}d)`); }
    }
    const qa = qaByCode.get(e.code);
    if (qa && qa.n >= 3 && qa.sum / qa.n < 70) {
      score += 10;
      reasons.push(`Call quality ${round1(qa.sum / qa.n)}% (${qa.n} audits)`);
    }
    if (redSet.has(e.id)) {
      score += 10;
      reasons.push("Training risk (red)");
    }
    score = Math.min(100, Math.round(score));
    out.set(e.id, { score, level: score >= RISK_HIGH ? "high" : score >= RISK_MEDIUM ? "medium" : "low", reasons });
  }
  return out;
}

export async function riskDomain(ctx: OpsCtx, dim: OpsDimension, view: DimView): Promise<MetricMap> {
  const scores = await computeRiskScores(ctx, view);
  const out: MetricMap = new Map();
  const sums = new Map<string, { s: number; n: number }>();
  for (const [id, r] of scores) {
    const e = view.byId.get(id)!;
    const gid = groupKey(e, dim);
    const b = (out.get(gid) ?? {}) as Record<string, number>;
    b.risk_high = (b.risk_high ?? 0) + (r.level === "high" ? 1 : 0);
    b.risk_medium = (b.risk_medium ?? 0) + (r.level === "medium" ? 1 : 0);
    out.set(gid, b);
    const s = sums.get(gid) ?? { s: 0, n: 0 };
    s.s += r.score;
    s.n += 1;
    sums.set(gid, s);
  }
  for (const [gid, s] of sums) (out.get(gid) as Record<string, number | null>).risk_avg = s.n ? Math.round((s.s / s.n) * 10) / 10 : null;
  return out;
}
