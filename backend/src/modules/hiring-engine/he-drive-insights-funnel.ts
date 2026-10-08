/**
 * Funnel-depth insights ("how to pull the most out of each drive"): stalled qualified leads, contact to confirm against the other drives,
 * the no-show leak with the best reply / arrival hours, screening that rejects most fills, the campaign to push budget toward, branch
 * concentration against open seats, and cost per join. Pure: no I/O, no clock. Facts come from fields /drive-analytics already reads
 * (the persons journey, per-campaign rows with their blockers, open seats, timing grids, cost); only the top disqualify reasons are read
 * for the campaigns this module flags (he-drive-insight-facts.service.ts). A rate is only shown when its denominator reaches
 * insight.min_sample, and the evidence states the sample. Types only from he-drive-insights.ts, so there is no runtime import cycle.
 */
import type { DriveInsight, EffectUnit, InsightFacts, InsightThresholds } from "./he-drive-insights.js";
import type { Grid } from "./he-drive-analytics.js";
import type { SourceType } from "./qualified-followup.types.js";

export interface FunnelJourney { leads: number; fills: number; screened: number; qualified: number; contacted: number; invited: number; replied: number; confirmed: number; arrived: number }
export interface FunnelCampaignFact {
  key: string; name: string; requisitionId: string; code: string; branch: string; sourceType: "meta_live" | "meta_old";
  leads: number; fills: number; screened: number; qualified: number; contacted: number; invited: number; confirmed: number; arrived: number;
  blockers: Array<{ code: string; text: string }>;
  /** Top disqualify reasons of the window's screened fills (rule text only), read for low-qualification campaigns only. */
  disqualify?: Array<{ reason: string; n: number }>;
}
export interface Peak { hour: number; n: number; total: number }
export interface FunnelFacts {
  journey: Record<SourceType, FunnelJourney> | null;
  campaigns: FunnelCampaignFact[];
  openSeats: Array<{ requisitionId: string; code: string; branch: string; open: number }>;
  replyPeak: Record<SourceType, Peak>;
  arrivalPeak: Record<SourceType, Peak>;
  /** Present only while cost per source is available. */
  cost: Record<SourceType, { perJoin: number | null; joined: number }> | null;
}

const TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const LABEL: Record<SourceType, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };
const SECTION: Record<SourceType, "live" | "old" | "he"> = { meta_live: "live", meta_old: "old", he: "he" };
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const pct = (r: number): string => `${Math.round(r * 100)}%`;
const str = (n: number): string => String(Math.round(n * 100) / 100);
const hourText = (h: number): string => `${String(h).padStart(2, "0")}:00`;
const effect = (value: number, unit: EffectUnit, text: (v: number) => string): DriveInsight["effect"] => {
  const v = !Number.isFinite(value) || value <= 0 ? 0 : value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return v > 0 ? { value: v, unit, text: text(v) } : null;
};
const people = (v: number): string => `about ${v} ${v === 1 ? "person" : "people"}`;
type Make = Omit<DriveInsight, "id"> & { key?: string };
const mk = (m: Make): DriveInsight => {
  const { key, ...rest } = m;
  return { id: `${m.rule}:${m.sourceType ?? "all"}:${m.requisitionId ?? "all"}:${key ?? ""}`, ...rest };
};

export const emptyFunnelFacts = (): FunnelFacts => ({
  journey: null, campaigns: [], openSeats: [], cost: null,
  replyPeak: { meta_live: { hour: 0, n: 0, total: 0 }, meta_old: { hour: 0, n: 0, total: 0 }, he: { hour: 0, n: 0, total: 0 } },
  arrivalPeak: { meta_live: { hour: 0, n: 0, total: 0 }, meta_old: { hour: 0, n: 0, total: 0 }, he: { hour: 0, n: 0, total: 0 } },
});

/** Busiest hour of a weekday x hour grid (weekdays summed), with the grid total. */
export function peakHour(g: Grid | undefined): Peak {
  const byHour = new Array<number>(24).fill(0);
  for (const row of Array.isArray(g) ? g : []) for (let h = 0; h < 24; h++) byHour[h] += num(row?.[h]);
  const total = byHour.reduce((a, b) => a + b, 0);
  let hour = 0;
  for (let h = 1; h < 24; h++) if (byHour[h] > byHour[hour]) hour = h;
  return { hour, n: byHour[hour], total };
}

/** The rule part of a disqualify reason: text before the first quote or digit (candidate answers and numbers are dropped). */
export function reasonLabel(reason: string | null | undefined): string {
  const s = String(reason ?? "");
  let end = s.length;
  for (let i = 0; i < s.length; i++) if (s[i] === "\"" || (s[i] >= "0" && s[i] <= "9")) { end = i; break; }
  let out = s.slice(0, end).trim();
  while (out.endsWith(":") || out.endsWith(",")) out = out.slice(0, -1).trim();
  return out ? out.slice(0, 80) : "Not recorded";
}

/** Campaigns whose screening passes few fills (the facts service reads their top reasons). */
export const lowQualification = (c: FunnelCampaignFact, t: InsightThresholds, min: number): boolean =>
  num(c.screened) >= Math.max(1, min) && num(c.qualified) / num(c.screened) < t["insight.low_qual_share"];

const OWNER_FOR: Record<string, string> = {
  requisition_closed: "HR: on Meta Campaigns, relink this campaign to an open requisition of the same branch and role (or hand the campaign to the Hiring Engine on the Master tab), then re-point the existing leads.",
  no_requisition: "HR: on Meta Campaigns, link this campaign to the requisition it recruits for.",
  no_bmi_link: "HR: add the BookMyInterview link on the requisition so the WhatsApp invite can carry it.",
  no_form: "HR: link the Meta lead form on the campaign so new fills are imported.",
};

type Ctx = { f: InsightFacts; t: InsightThresholds; D: number; min: number; ok: (n: number) => boolean };

function stalled({ f, t }: Ctx): DriveInsight[] {
  return (f.funnel?.campaigns ?? []).filter((c) => num(c.qualified) > 0 && num(c.contacted) === 0).map((c) => {
    const q = num(c.qualified);
    const why = (c.blockers ?? []).filter((b) => b.code !== "campaign_not_active");
    const first = why.find((b) => OWNER_FOR[b.code]);
    return mk({
      rule: "stalled_leads", severity: q >= t["insight.stalled_critical"] ? "critical" : "warn", sourceType: c.sourceType, requisitionId: c.requisitionId, key: c.key,
      title: `${c.name || "No campaign"}: ${q} qualified ${LABEL[c.sourceType]} leads have had no contact`,
      evidence: [{ label: "Qualified at screening", value: str(q) }, { label: "Contacted", value: "0" }, { label: "Form fills in range", value: str(num(c.fills)) }, { label: "Requisition", value: c.code || "None" }],
      suggestion: why.length ? `Outreach is blocked: ${why.map((b) => b.text).join("; ")}.` : "No blocker is visible on the campaign or its requisition; these leads are waiting for the next outreach run.",
      ownerAction: first ? OWNER_FOR[first.code] : "Owner: hand the campaign to the Hiring Engine (Master tab) so the next engine tick invites them, or check the Meta outreach log.",
      // effect = qualified people waiting
      effect: effect(q, "people", people), action: { type: "open_section", section: SECTION[c.sourceType] },
    });
  });
}

function contactConfirm({ f, t, ok }: Ctx): DriveInsight[] {
  const j = f.funnel?.journey;
  if (!j) return [];
  const rates = TYPES.filter((x) => ok(num(j[x]?.contacted))).map((x) => ({ type: x, n: num(j[x].contacted), rate: Math.min(1, num(j[x].confirmed) / num(j[x].contacted)) }));
  const out: DriveInsight[] = [];
  for (const r of rates) {
    const best = rates.filter((o) => o.type !== r.type).sort((a, b) => b.rate - a.rate)[0];
    if (!best || !(r.rate < best.rate - t["insight.contact_confirm_gap"])) continue;
    out.push(mk({
      rule: "contact_confirm", severity: "warn", sourceType: r.type, requisitionId: null,
      title: `${LABEL[r.type]}: few contacted people confirm`,
      evidence: [{ label: "Contacted to confirmed now", value: pct(r.rate) }, { label: `${LABEL[best.type]} contacted to confirmed`, value: pct(best.rate) },
        { label: "People contacted", value: str(r.n) }, { label: `${LABEL[best.type]} people contacted`, value: str(best.n) }],
      suggestion: `Follow every ${LABEL[r.type]} invite with a call within a day, as the drive that confirms best gets a reply before the slot goes.`,
      ownerAction: "Recruiters: call contacted people who have not confirmed, newest first (Follow-up issues on the Summary).",
      // effect = (best rate - rate) * contacted, more confirmations in the range
      effect: effect((best.rate - r.rate) * r.n, "people", people), action: { type: "open_followup" },
    }));
  }
  return out;
}

function noShowLeak({ f, t, D, ok, min }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of TYPES) {
    const ns = num(f.types?.[type]?.noShow), arr = num(f.types?.[type]?.current?.arrived);
    const n = ns + arr;
    if (!ok(n)) continue;
    const rate = ns / n;
    if (!(rate > t["insight.no_show_max"])) continue;
    const rp = f.funnel?.replyPeak?.[type], ap = f.funnel?.arrivalPeak?.[type];
    const peak = (p: Peak | undefined, label: string, few: string) => (p && num(p.total) >= Math.max(1, min)
      ? { label, value: `${hourText(p.hour)} IST (${str(p.n)} of ${str(p.total)})` } : { label: few, value: `${str(num(p?.total))}, too few to name a best hour` });
    const replyOk = !!rp && num(rp.total) >= Math.max(1, min), arriveOk = !!ap && num(ap.total) >= Math.max(1, min);
    out.push(mk({
      rule: "no_show_leak", severity: rate > (1 + t["insight.no_show_max"]) / 2 ? "critical" : "warn", sourceType: type, requisitionId: null,
      title: `${LABEL[type]}: most confirmed people do not come`,
      evidence: [{ label: "No-show rate", value: pct(rate) }, { label: "People with a result (arrived or no-show)", value: str(n) }, { label: "No-shows", value: str(ns) },
        peak(rp, "Most replies arrive at", "Replies recorded"), peak(ap, "Most people arrive at", "Arrival times recorded")],
      suggestion: `Send the day-before reminder${replyOk ? ` near ${hourText(rp!.hour)} IST, when most people reply,` : ""} and confirm again on the morning of the drive${arriveOk ? `; put most slots near ${hourText(ap!.hour)} IST, when most people arrive` : ""}.`,
      ownerAction: "Recruiters: call the next drive's confirmed list the evening before; drop people who do not answer from the seat count.",
      // effect = (rate - no_show_max) * resolved people / D, arrivals a day if the leak came down to the threshold
      effect: effect(((rate - t["insight.no_show_max"]) * n) / D, "arrivals_per_day", (v) => `about +${v} arrivals a day`), action: { type: "open_followup" },
    }));
  }
  return out;
}

function lowQual({ f, t, min }: Ctx): DriveInsight[] {
  return (f.funnel?.campaigns ?? []).filter((c) => lowQualification(c, t, min)).map((c) => {
    const reasons = (c.disqualify ?? []).filter((r) => num(r.n) > 0).slice(0, 3);
    const names = ["Top reason", "Second reason", "Third reason"];
    return mk({
      rule: "low_qualification", severity: "warn", sourceType: c.sourceType, requisitionId: c.requisitionId, key: c.key,
      title: `${c.name || "No campaign"}: most form fills fail screening`,
      evidence: [{ label: "Passed screening", value: pct(num(c.qualified) / num(c.screened)) }, { label: "Screened", value: str(num(c.screened)) }, { label: "Qualified", value: str(num(c.qualified)) },
        ...reasons.map((r, i) => ({ label: names[i], value: `${r.reason} (${str(num(r.n))})` }))],
      suggestion: reasons.length ? `Most fills fail on "${reasons[0].reason}". Either the rule is stricter than the role needs, or the ad reaches people who do not meet it.` : "Either the screening rule is stricter than the role needs, or the ad reaches the wrong people.",
      ownerAction: "Owner: review the campaign's screening questions on Meta Campaigns, or narrow the ad's audience to people who meet them.",
      effect: null, action: { type: "open_section", section: SECTION[c.sourceType] },
    });
  });
}

function bestCampaign({ f, t, ok }: Ctx): DriveInsight[] {
  const list = (f.funnel?.campaigns ?? []).filter((c) => ok(num(c.leads))).map((c) => ({ c, rate: num(c.confirmed) / num(c.leads) }));
  if (list.length < 2) return [];
  const [best, ...rest] = [...list].sort((a, b) => b.rate - a.rate || num(b.c.leads) - num(a.c.leads));
  const leads = rest.reduce((a, x) => a + num(x.c.leads), 0), conf = rest.reduce((a, x) => a + num(x.c.confirmed), 0);
  const others = leads > 0 ? conf / leads : 0;
  if (!(best.rate > 0) || !(best.rate >= others * (1 + t["insight.best_campaign_lift"]))) return [];
  const open = (f.funnel?.openSeats ?? []).filter((s) => s.requisitionId === best.c.requisitionId).reduce((a, s) => a + num(s.open), 0);
  const name = best.c.name || "No campaign";
  return [mk({
    rule: "best_campaign", severity: "info", sourceType: best.c.sourceType, requisitionId: best.c.requisitionId, key: best.c.key,
    title: `${name} confirms the most leads per lead of any campaign`,
    evidence: [{ label: `${name} leads to confirmed`, value: pct(best.rate) }, { label: "Other campaigns leads to confirmed", value: pct(others) },
      { label: `${name} leads`, value: str(num(best.c.leads)) }, { label: "Other campaigns leads", value: str(leads) }],
    suggestion: open > 0 ? `Move ad budget toward ${name}: ${best.c.code} has ${str(open)} open seats.` : `${name} converts best, but ${best.c.code || "its requisition"} has no open seat: point the campaign at an open requisition before adding budget.`,
    ownerAction: "Owner: raise this campaign's daily budget on Meta and lower the weakest campaign's.",
    effect: null, action: { type: "open_section", section: SECTION[best.c.sourceType] },
  })];
}

function branchConcentration({ f, t, ok }: Ctx): DriveInsight[] {
  const seats = f.funnel?.openSeats ?? [];
  if (!seats.length) return [];
  const branchOf = new Map(seats.map((s) => [s.requisitionId, s.branch]));
  const openBy = new Map<string, number>();
  for (const s of seats) openBy.set(s.branch, (openBy.get(s.branch) ?? 0) + num(s.open));
  const out: DriveInsight[] = [];
  for (const type of TYPES) {
    const by = new Map<string, number>();
    for (const r of f.sources ?? []) { const b = branchOf.get(r.requisitionId); const n = num(r.byType?.[type]?.leads); if (b && n) by.set(b, (by.get(b) ?? 0) + n); }
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    if (!ok(total)) continue;
    const [top, n] = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const elsewhere = [...openBy.entries()].filter(([b, o]) => b !== top && o > 0 && (by.get(b) ?? 0) / total < 1 - t["insight.branch_share"]).sort((a, b) => b[1] - a[1]);
    if (!(n / total >= t["insight.branch_share"]) || !elsewhere.length) continue;
    const otherOpen = elsewhere.reduce((a, [, o]) => a + o, 0);
    out.push(mk({
      rule: "branch_concentration", severity: "info", sourceType: type, requisitionId: null, key: top,
      title: `${LABEL[type]}: most leads go to ${top}`,
      evidence: [{ label: `${top} share of leads`, value: pct(n / total) }, { label: "Leads in range", value: str(total) }, { label: `${top} open seats`, value: str(openBy.get(top) ?? 0) }, { label: "Open seats elsewhere", value: str(otherOpen) }],
      suggestion: `Open seats in ${elsewhere.slice(0, 3).map(([b, o]) => `${b} (${str(o)})`).join(", ")} get few ${LABEL[type]} leads: point a campaign or a pool stream at them.`,
      ownerAction: `Owner: start a campaign or a pool stream for ${elsewhere[0][0]}.`,
      effect: null, action: { type: "none" },
    }));
  }
  return out;
}

function costPerJoin({ f, t }: Ctx): DriveInsight[] {
  const c = f.funnel?.cost;
  if (!c) return [];
  const minJoins = Math.max(1, num(t["insight.cost_min_joins"]));
  const rows = TYPES.filter((x) => num(c[x]?.joined) >= minJoins && num(c[x]?.perJoin) > 0).map((x) => ({ type: x, per: num(c[x].perJoin), joined: num(c[x].joined) }))
    .sort((a, b) => a.per - b.per);
  if (rows.length < 2) return [];
  const [cheap, next] = rows;
  if (!(cheap.per * (1 + t["insight.cost_join_lift"]) <= next.per)) return [];
  return [mk({
    rule: "cost_per_join", severity: "info", sourceType: cheap.type, requisitionId: null,
    title: `${LABEL[cheap.type]} has the lowest cost per join`,
    evidence: [...rows.map((r) => ({ label: `${LABEL[r.type]} cost per join`, value: `Rs ${Math.round(r.per)}` })), ...rows.map((r) => ({ label: `${LABEL[r.type]} joins`, value: str(r.joined) }))],
    suggestion: `Shift spend toward ${LABEL[cheap.type]} while its cost per join stays below ${LABEL[next.type]}.`,
    ownerAction: "Owner: move part of the next week's budget to the cheaper drive and re-check the cost per join after it.",
    effect: null, action: { type: "none" },
  })];
}

/** The funnel-depth rules; called by evaluateInsights with its context. */
export function funnelInsights(f: InsightFacts, t: InsightThresholds, D: number, min: number): DriveInsight[] {
  if (!f?.funnel) return [];
  const ctx: Ctx = { f, t, D, min, ok: (n) => n > 0 && n >= min };
  return [stalled, contactConfirm, noShowLeak, lowQual, bestCampaign, branchConcentration, costPerJoin].flatMap((r) => r(ctx));
}
