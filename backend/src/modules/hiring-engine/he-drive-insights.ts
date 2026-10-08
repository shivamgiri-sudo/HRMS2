/**
 * Deterministic drive insights for the Command Center. Pure: no I/O, no clock (facts carry `today`). Rates are n / d when d > 0 else 0;
 * a rule only reads a rate whose denominator is at least `insight.min_sample` (counts-based rules aside). Insights carry ids, counts and
 * labels only, never candidate data. Evidence lists the exact inputs of the estimated-effect formula.
 */
import { SOURCE_TYPES, type StageCounts } from "./he-drive-analytics.js";
import { OUTCOME_REASONS, OUTCOME_REASON_LABEL, type OutcomeReasonCode } from "./he-outcome-reason.js";
import type { SourceType } from "./qualified-followup.types.js";

export const INSIGHT_DEFAULTS = {
  "insight.min_sample": 20, "insight.under_target_margin": 0.1, "insight.under_target_critical": 0.5, "insight.weak_stage_margin": 0.1,
  "insight.timing_outside_share": 0.5, "insight.timing_hour_tolerance": 1, "insight.reminder_missing_share": 0.2, "insight.distance_band_km": 15,
  "insight.distance_gap": 0.3, "insight.channel_unreached_share": 0.2, "insight.wa_fail_min": 10, "insight.wa_unread_share": 0.5,
  "insight.language_gap": 0.1, "insight.overbook_margin": 0.1, "insight.empty_slot_share": 0.5, "insight.best_source_share": 0.5,
  "insight.best_source_lift": 0.25, "insight.weekday_lift": 0.1, "insight.fill_soon_positions": 2, "insight.plan_min_sample": 30,
  "insight.plan_trailing_days": 14,
} as const;
export type InsightKey = keyof typeof INSIGHT_DEFAULTS;
export type InsightThresholds = Record<InsightKey, number>;

export type InsightRule = "under_target" | "weak_stage" | "contact_timing" | "reminder_gap" | "distance" | "channel_gap" | "language" | "overbooking" | "stream_dry" | "best_source" | "weekday" | "outcome_reason";
export type InsightSeverity = "critical" | "warn" | "info";
export type EffectUnit = "arrivals_per_day" | "replies_per_day" | "joins_per_day" | "people" | "seats";
export type InsightAction =
  | { type: "open_plan"; requisitionId: string; date: string }
  | { type: "plan_now"; requisitionId: string; date: string }
  | { type: "extend_stream"; streamId: string; requisitionId: string }
  | { type: "create_stream"; requisitionId: string; sourceType: SourceType }
  | { type: "open_section"; section: "live" | "old" | "he" }
  | { type: "open_followup" }
  | { type: "none" };

export interface DriveInsight {
  id: string; rule: InsightRule; severity: InsightSeverity; sourceType: SourceType | null; requisitionId: string | null;
  title: string; evidence: Array<{ label: string; value: string }>; suggestion: string;
  effect: { value: number; unit: EffectUnit; text: string } | null; action: InsightAction;
}

export interface RateFact { n: number; hits: number }
type PerType<T> = Record<SourceType, T>;
export interface InsightFacts {
  today: string; windowDays: number;
  types: PerType<{ current: StageCounts; previous: StageCounts; /** Totals in range, for the reason insight evidence. */ noShow?: number; declined?: number }>;
  tomorrow: Array<{ requisitionId: string; code: string; date: string; target: number; projected: number; recommended: Array<{ streamId: string; sourceType: SourceType; invites: number }> }>;
  contact: PerType<{ inside: RateFact; outside: RateFact }>;
  reminders: PerType<{ confirmed: number; missing: number; withReminder: RateFact; withoutReminder: RateFact }>;
  distance: PerType<{ near: RateFact; far: RateFact }>;
  channel: PerType<{ qualified: number; unreached: number; reachedArrivalRate: number; waFailedByCode: Record<string, number>; waDelivered: number; waUnread: number }>;
  language: PerType<{ hi: RateFact; other: RateFact }>;
  slots: Array<{ driveId: string; requisitionId: string; code: string; date: string; capacity: number; expected: number; busyHourSeats: number; busyHourBooked: number }>;
  streams: Array<{ streamId: string; requisitionId: string; code: string; sourceType: SourceType; cap: number; remainingDays: number; poolRemaining: number | null }>;
  sources: Array<{ requisitionId: string; code: string; byType: Partial<Record<SourceType, { leads: number; joined: number; invited: number }>> }>;
  weekdays: Array<{ weekday: number; confirmed: number; arrived: number }>;
  /** Recorded no-show and decline reasons per type (HE_OUTCOME_REASONS); absent while the switch is off. */
  reasons?: PerType<{ no_show: Partial<Record<OutcomeReasonCode, number>>; declined: Partial<Record<OutcomeReasonCode, number>> }>;
}

/** One reason must be at least this share of the recorded reasons (and the total at least insight.min_sample) to be named. A code constant this release. */
export const REASON_SHARE = 0.4;

export const MAX_INSIGHTS = 20;
export const TYPE_LABEL: Record<SourceType, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };
const SECTION: Record<SourceType, "live" | "old" | "he"> = { meta_live: "live", meta_old: "old", he: "he" };
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const RANK: Record<InsightSeverity, number> = { critical: 0, warn: 1, info: 2 };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const rate = (r: RateFact | undefined): number => (r && num(r.n) > 0 ? num(r.hits) / num(r.n) : 0);
const pct = (r: number): string => `${Math.round(r * 100)}%`;
const str = (n: number): string => String(Math.round(n * 100) / 100);

/** Rounded effect value: one decimal below 10, whole number from 10; 0 when not a positive finite number. */
const roundEffect = (v: number): number => (!Number.isFinite(v) || v <= 0 ? 0 : v < 10 ? Math.round(v * 10) / 10 : Math.round(v));

export function effectText(value: number, unit: EffectUnit): string {
  const v = roundEffect(value);
  switch (unit) {
    case "arrivals_per_day": return `about +${v} arrivals a day`;
    case "replies_per_day": return `about +${v} replies a day`;
    case "joins_per_day": return `about +${v} joins a day`;
    case "people": return `about ${v} ${v === 1 ? "person" : "people"}`;
    case "seats": return `about ${v} ${v === 1 ? "seat" : "seats"}`;
  }
}
function effectOf(value: number, unit: EffectUnit): DriveInsight["effect"] {
  const v = roundEffect(value);
  return v > 0 ? { value: v, unit, text: effectText(v, unit) } : null;
}

const tomorrowOf = (today: string): string => {
  const d = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return today;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
/** The day the evening pass lines up after `today` (Sundays skipped, as nextWorkingDay). */
const nextWorkingDayOf = (today: string): string => {
  const d = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return today;
  d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 6 ? 2 : 1));
  return d.toISOString().slice(0, 10);
};

type Ctx = { f: InsightFacts; t: InsightThresholds; D: number; min: number; ok: (n: number) => boolean };
type Make = Omit<DriveInsight, "id"> & { key?: string };
const mk = (m: Make): DriveInsight => {
  const { key, ...rest } = m;
  return { id: `${m.rule}:${m.sourceType ?? "all"}:${m.requisitionId ?? "all"}:${key ?? ""}`, ...rest };
};

function underTarget({ f, t }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const r of f.tomorrow ?? []) {
    if (typeof r.projected !== "number" || !Number.isFinite(r.projected)) continue; // unknown projection is not "zero arrivals"
    const target = num(r.target), projected = num(r.projected);
    if (!(target > 0) || !(projected < target * (1 - t["insight.under_target_margin"]))) continue;
    const rec = (r.recommended ?? []).filter((x) => num(x.invites) > 0).map((x) => `${Math.round(num(x.invites))} more invites from ${TYPE_LABEL[x.sourceType] ?? "a source"}`);
    out.push(mk({
      rule: "under_target", severity: projected < target * t["insight.under_target_critical"] ? "critical" : "warn", sourceType: null, requisitionId: r.requisitionId,
      title: `${r.code} is projected below its target for ${r.date}`,
      evidence: [{ label: "Target arrivals", value: str(target) }, { label: "Projected arrivals", value: str(projected) }],
      suggestion: rec.length ? `Send ${rec.join(", ")}.` : "No stream can add more invites; review the plan.",
      // effect = target - projected
      effect: effectOf(target - projected, "arrivals_per_day"), action: { type: "open_plan", requisitionId: r.requisitionId, date: r.date },
    }));
  }
  return out;
}

const PAIRS = [
  { key: "invited_confirmed", from: "invited", to: "confirmed", label: "invited to confirmed", unit: "replies_per_day" },
  { key: "confirmed_arrived", from: "confirmed", to: "arrived", label: "confirmed to arrived", unit: "arrivals_per_day" },
] as const;
function weakStage({ f, t, D, ok }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of SOURCE_TYPES) {
    const cur = f.types?.[type]?.current, prev = f.types?.[type]?.previous;
    if (!cur) continue;
    for (const p of PAIRS) {
      const fromN = num(cur[p.from]);
      if (!ok(fromN)) continue;
      const r = num(cur[p.to]) / fromN;
      const refs: Array<{ rate: number; name: string }> = [];
      if (prev && ok(num(prev[p.from]))) refs.push({ rate: num(prev[p.to]) / num(prev[p.from]), name: "Previous period" });
      for (const o of SOURCE_TYPES) {
        const c = o === type ? undefined : f.types?.[o]?.current;
        if (c && ok(num(c[p.from]))) refs.push({ rate: num(c[p.to]) / num(c[p.from]), name: `Best other source` });
      }
      const ref = refs.reduce<{ rate: number; name: string } | null>((b, x) => (b === null || x.rate > b.rate ? x : b), null);
      if (!ref || !(r < ref.rate - t["insight.weak_stage_margin"])) continue;
      out.push(mk({
        rule: "weak_stage", severity: "warn", sourceType: type, requisitionId: null, key: p.key,
        title: `${TYPE_LABEL[type]}: ${p.label} is weak`,
        evidence: [{ label: `${p.label} now`, value: pct(r) }, { label: ref.name, value: pct(ref.rate) }, { label: `People ${p.from}`, value: str(fromN) }],
        suggestion: `Compare how ${TYPE_LABEL[type]} candidates are followed up between ${p.from} and ${p.to}.`,
        // effect = (ref - rate) * fromCount / D
        effect: effectOf(((ref.rate - r) * fromN) / D, p.unit), action: { type: "open_section", section: SECTION[type] },
      }));
    }
  }
  return out;
}

function contactTiming({ f, t, D, ok }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of SOURCE_TYPES) {
    const c = f.contact?.[type];
    if (!c) continue;
    const inN = num(c.inside?.n), outN = num(c.outside?.n);
    if (!ok(inN) || !ok(outN) || !(outN / (inN + outN) > t["insight.timing_outside_share"])) continue;
    const ri = rate(c.inside), ro = rate(c.outside);
    if (!(ri > ro)) continue;
    out.push(mk({
      rule: "contact_timing", severity: "warn", sourceType: type, requisitionId: null,
      title: `${TYPE_LABEL[type]}: most messages go out at hours when few people reply`,
      evidence: [{ label: "Messages outside the best hours", value: str(outN) }, { label: "Reply rate inside the best hours", value: pct(ri) }, { label: "Reply rate outside", value: pct(ro) }],
      suggestion: "Send messages during the hours with the best reply rate.",
      // effect = outside.n * (insideRate - outsideRate) / D
      effect: effectOf((outN * (ri - ro)) / D, "replies_per_day"), action: { type: "none" },
    }));
  }
  return out;
}

function reminderGap({ f, t, D, ok, min }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of SOURCE_TYPES) {
    const r = f.reminders?.[type];
    if (!r) continue;
    const confirmed = num(r.confirmed), missing = num(r.missing);
    if (!ok(confirmed) || !(missing / confirmed > t["insight.reminder_missing_share"])) continue;
    const rw = rate(r.withReminder), ro = rate(r.withoutReminder);
    const usable = num(r.withReminder?.n) >= min && num(r.withoutReminder?.n) >= min;
    out.push(mk({
      rule: "reminder_gap", severity: "warn", sourceType: type, requisitionId: null,
      title: `${TYPE_LABEL[type]}: many confirmed people got no reminder`,
      evidence: [{ label: "Confirmed", value: str(confirmed) }, { label: "Without a reminder", value: str(missing) }, { label: "Arrival rate with a reminder", value: pct(rw) }, { label: "Arrival rate without", value: pct(ro) }],
      suggestion: "Make sure every confirmed person gets the day-before reminder.",
      // effect = missing * (withRate - withoutRate) / D, only when both samples reach min_sample
      effect: usable ? effectOf((missing * (rw - ro)) / D, "arrivals_per_day") : null, action: { type: "open_followup" },
    }));
  }
  return out;
}

function distance({ f, t, D, ok }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of SOURCE_TYPES) {
    const d = f.distance?.[type];
    if (!d || !ok(num(d.near?.n)) || !ok(num(d.far?.n))) continue;
    const rn = rate(d.near), rf = rate(d.far);
    if (!(rf < rn * (1 - t["insight.distance_gap"]))) continue;
    out.push(mk({
      rule: "distance", severity: "warn", sourceType: type, requisitionId: null,
      title: `${TYPE_LABEL[type]}: people far from the venue arrive less`,
      evidence: [{ label: `Arrival rate within ${t["insight.distance_band_km"]} km`, value: pct(rn) }, { label: "Arrival rate farther away", value: pct(rf) }, { label: "People farther away", value: str(num(d.far.n)) }],
      suggestion: `Invite people within ${t["insight.distance_band_km"]} km first or offer a closer venue.`,
      // effect = far.n * (nearRate - farRate) / D
      effect: effectOf((num(d.far.n) * (rn - rf)) / D, "arrivals_per_day"), action: { type: "open_section", section: "he" },
    }));
  }
  return out;
}

function channelGap({ f, t, D, ok }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of SOURCE_TYPES) {
    const c = f.channel?.[type];
    if (!c) continue;
    const q = num(c.qualified), un = num(c.unreached), rr = num(c.reachedArrivalRate);
    if (ok(q) && un / q > t["insight.channel_unreached_share"]) {
      out.push(mk({
        rule: "channel_gap", severity: "warn", sourceType: type, requisitionId: null,
        title: `${TYPE_LABEL[type]}: many qualified people were never reached`,
        evidence: [{ label: "Qualified", value: str(q) }, { label: "Not reached on any channel", value: str(un) }, { label: "Arrival rate of reached people", value: pct(rr) }],
        suggestion: "Call or email the people WhatsApp could not reach.",
        // effect = unreached * reachedArrivalRate / D
        effect: effectOf((un * rr) / D, "arrivals_per_day"), action: { type: "open_followup" },
      }));
    }
    for (const [code, raw] of Object.entries(c.waFailedByCode ?? {})) {
      const n = num(raw);
      if (n < t["insight.wa_fail_min"] || n <= 0) continue;
      out.push(mk({
        rule: "channel_gap", severity: "warn", sourceType: type, requisitionId: null, key: code,
        title: `${TYPE_LABEL[type]}: WhatsApp messages keep failing with the same error`,
        evidence: [{ label: `Meta error ${code}`, value: str(n) }],
        suggestion: `Look up Meta error ${code} and fix the cause; those people need another channel.`,
        // effect = number of failed sends for this code
        effect: effectOf(n, "people"), action: { type: "open_followup" },
      }));
    }
    const dl = num(c.waDelivered), unread = num(c.waUnread);
    if (ok(dl) && unread / dl > t["insight.wa_unread_share"]) {
      out.push(mk({
        rule: "channel_gap", severity: "warn", sourceType: type, requisitionId: null, key: "unread",
        title: `${TYPE_LABEL[type]}: most delivered WhatsApp messages stay unread`,
        evidence: [{ label: "Delivered", value: str(dl) }, { label: "Unread", value: str(unread) }],
        suggestion: "Follow up unread messages by call or email.",
        effect: null, action: { type: "open_followup" },
      }));
    }
  }
  return out;
}

function language({ f, t, D, ok }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of SOURCE_TYPES) {
    const l = f.language?.[type];
    if (!l || !ok(num(l.hi?.n)) || !ok(num(l.other?.n))) continue;
    const rh = rate(l.hi), ro = rate(l.other);
    if (!(ro - rh > t["insight.language_gap"])) continue;
    out.push(mk({
      rule: "language", severity: "info", sourceType: type, requisitionId: null,
      title: `${TYPE_LABEL[type]}: Hindi speakers reply less`,
      evidence: [{ label: "Reply rate, Hindi speakers", value: pct(rh) }, { label: "Reply rate, others", value: pct(ro) }, { label: "Hindi speakers messaged", value: str(num(l.hi.n)) }],
      suggestion: "Only English templates are approved; ask Meta to approve Hindi versions",
      // effect = hi.n * (otherRate - hiRate) / D
      effect: effectOf((num(l.hi.n) * (ro - rh)) / D, "replies_per_day"), action: { type: "none" },
    }));
  }
  return out;
}

function overbooking({ f, t }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  const lineUpDay = nextWorkingDayOf(f.today);
  for (const s of f.slots ?? []) {
    const cap = num(s.capacity), exp = num(s.expected), seats = num(s.busyHourSeats), booked = num(s.busyHourBooked);
    const action: InsightAction = { type: "open_plan", requisitionId: s.requisitionId, date: s.date };
    if (exp > cap * (1 + t["insight.overbook_margin"])) {
      out.push(mk({
        rule: "overbooking", severity: "warn", sourceType: null, requisitionId: s.requisitionId, key: s.driveId,
        title: `${s.code} on ${s.date} is overbooked`,
        evidence: [{ label: "Seats", value: str(cap) }, { label: "Expected arrivals", value: str(exp) }],
        suggestion: "Spread arrivals over more slots or add capacity.",
        // effect = expected - capacity
        effect: effectOf(exp - cap, "seats"), action,
      }));
    }
    // People are lined up the evening before: a later drive's busy slots are empty by design, not a problem yet.
    if (seats > 0 && s.date <= lineUpDay && booked / seats < t["insight.empty_slot_share"]) {
      out.push(mk({
        rule: "overbooking", severity: "warn", sourceType: null, requisitionId: s.requisitionId, key: `${s.driveId}/empty`,
        title: `${s.code} on ${s.date} has empty busy slots`,
        evidence: [{ label: "Busy-hour seats", value: str(seats) }, { label: "Booked in busy hours", value: str(booked) }],
        suggestion: "Move bookings into the busy hours or shorten the slot window.",
        // effect = busyHourSeats - busyHourBooked
        effect: effectOf(seats - booked, "seats"), action,
      }));
    }
  }
  return out;
}

function streamDry({ f }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const s of f.streams ?? []) {
    if (s.poolRemaining === null || s.poolRemaining === undefined || !Number.isFinite(s.poolRemaining)) continue;
    const cap = num(s.cap), days = num(s.remainingDays), pool = num(s.poolRemaining);
    const need = cap * days;
    if (!(pool < need)) continue;
    out.push(mk({
      rule: "stream_dry", severity: pool < cap ? "critical" : "warn", sourceType: s.sourceType, requisitionId: s.requisitionId, key: s.streamId,
      title: `${s.code}: the ${TYPE_LABEL[s.sourceType]} stream will run out of people`,
      evidence: [{ label: "People left", value: str(pool) }, { label: "Daily cap", value: str(cap) }, { label: "Days left", value: str(days) }],
      suggestion: s.sourceType === "meta_old" ? "Extend this stream to a larger audience." : "Add an Old Meta data stream to keep the drive filled.",
      // effect = cap * remainingDays - poolRemaining
      effect: effectOf(need - pool, "people"),
      action: s.sourceType === "meta_old" ? { type: "extend_stream", streamId: s.streamId, requisitionId: s.requisitionId } : { type: "create_stream", requisitionId: s.requisitionId, sourceType: "meta_old" },
    }));
  }
  return out;
}

function bestSource({ f, t, D, ok }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  const date = tomorrowOf(f.today);
  for (const r of f.sources ?? []) {
    const rows = SOURCE_TYPES.flatMap((type) => {
      const e = r.byType?.[type];
      return e && ok(num(e.leads)) ? [{ type, leads: num(e.leads), joined: num(e.joined), invited: num(e.invited), rate: num(e.joined) / num(e.leads) }] : [];
    });
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => b.rate - a.rate || SOURCE_TYPES.indexOf(a.type) - SOURCE_TYPES.indexOf(b.type));
    const best = sorted[0], next = sorted[1];
    if (!(best.rate > next.rate * (1 + t["insight.best_source_lift"]))) continue;
    const totalInvited = SOURCE_TYPES.reduce((a, type) => a + num(r.byType?.[type]?.invited), 0);
    if (!(totalInvited > 0)) continue;
    const share = best.invited / totalInvited;
    if (!(share < t["insight.best_source_share"])) continue;
    const others = sorted.slice(1);
    const othersLeads = others.reduce((a, x) => a + x.leads, 0);
    const othersRate = othersLeads > 0 ? others.reduce((a, x) => a + x.joined, 0) / othersLeads : 0;
    const shift = Math.min(0.2, t["insight.best_source_share"] - share);
    out.push(mk({
      rule: "best_source", severity: "info", sourceType: best.type, requisitionId: r.requisitionId,
      title: `${r.code}: ${TYPE_LABEL[best.type]} converts best to joins`,
      evidence: [
        { label: `${TYPE_LABEL[best.type]} lead-to-join rate`, value: pct(best.rate) }, { label: "Other sources lead-to-join rate", value: pct(othersRate) },
        { label: "Share of invites", value: pct(share) }, { label: "Invites in the window", value: str(totalInvited) }, { label: "Shift assumed", value: pct(shift) },
      ],
      suggestion: `Shift about ${pct(shift)} of invites to ${TYPE_LABEL[best.type]}.`,
      // effect = shift * (totalInvited / D) * (bestRate - othersRate), shift = min(0.2, best_source_share - share)
      effect: effectOf(shift * (totalInvited / D) * (best.rate - othersRate), "joins_per_day"), action: { type: "open_plan", requisitionId: r.requisitionId, date },
    }));
  }
  return out;
}

function weekday({ f, t, D, ok }: Ctx): DriveInsight[] {
  const days = (f.weekdays ?? []).filter((w) => Number.isInteger(w.weekday) && w.weekday >= 0 && w.weekday <= 6);
  const totalC = days.reduce((a, w) => a + num(w.confirmed), 0), totalA = days.reduce((a, w) => a + num(w.arrived), 0);
  if (!ok(totalC)) return [];
  const overall = totalA / totalC;
  let best: { weekday: number; confirmed: number; rate: number } | null = null;
  for (const w of days) {
    const c = num(w.confirmed);
    if (!ok(c)) continue;
    const r = num(w.arrived) / c;
    if (best === null || r > best.rate || (r === best.rate && w.weekday < best.weekday)) best = { weekday: w.weekday, confirmed: c, rate: r };
  }
  if (!best || !(best.rate >= overall + t["insight.weekday_lift"])) return [];
  // average confirmed per drive day: confirmed spread over (weekdays with data) * (weeks in the window)
  const active = days.filter((w) => num(w.confirmed) > 0).length;
  const avg = totalC / Math.max(1, active * Math.max(1, Math.ceil(D / 7)));
  return [mk({
    rule: "weekday", severity: "info", sourceType: null, requisitionId: null, key: String(best.weekday),
    title: `${WEEKDAYS[best.weekday]} has the best show-up`,
    evidence: [{ label: `${WEEKDAYS[best.weekday]} arrival rate`, value: pct(best.rate) }, { label: "Overall arrival rate", value: pct(overall) }, { label: `Confirmed on ${WEEKDAYS[best.weekday]}`, value: str(best.confirmed) }, { label: "Average confirmed per drive day", value: str(avg) }],
    suggestion: `Schedule more drives on ${WEEKDAYS[best.weekday]}.`,
    // effect = (bestRate - overall) * avgConfirmedPerDriveDay
    effect: effectOf((best.rate - overall) * avg, "arrivals_per_day"), action: { type: "none" },
  })];
}

const REASON_SUGGESTION: Record<OutcomeReasonCode, string> = {
  distance: "Line up people nearer the branch, or offer the nearer branch",
  other_job: "Invite sooner after people qualify; they are taking other offers",
  salary: "Check the offer against what candidates expect",
  timing: "Offer later or Saturday slots",
  not_interested: "Tighten the screening questions for this source",
  other: "Read the notes on the walk-in board",
};
function outcomeReason({ f, ok }: Ctx): DriveInsight[] {
  const out: DriveInsight[] = [];
  for (const type of SOURCE_TYPES) for (const outcome of ["no_show", "declined"] as const) {
    const counts = f.reasons?.[type]?.[outcome];
    if (!counts) continue;
    const rows = OUTCOME_REASONS.map((code) => ({ code, n: Math.max(0, Math.floor(num(counts[code]))) }));
    const total = rows.reduce((a, r) => a + r.n, 0);
    if (!ok(total)) continue;
    const top = rows.reduce((b, r) => (r.n > b.n ? r : b), rows[0]);
    if (!(top.n / total >= REASON_SHARE)) continue;
    out.push(mk({
      rule: "outcome_reason", severity: "info", sourceType: type, requisitionId: null, key: `${outcome}.${top.code}`,
      title: `Most ${outcome === "no_show" ? "no-shows" : "declines"} from ${TYPE_LABEL[type]} say "${OUTCOME_REASON_LABEL[top.code]}" (${pct(top.n / total)})`,
      evidence: [{ label: outcome === "no_show" ? "No-show reasons recorded" : "Decline reasons recorded", value: str(total) }, { label: `Said "${OUTCOME_REASON_LABEL[top.code]}"`, value: str(top.n) },
        { label: outcome === "no_show" ? "No-shows in range" : "Declines in range", value: str(num(outcome === "no_show" ? f.types?.[type]?.noShow : f.types?.[type]?.declined)) }],
      suggestion: REASON_SUGGESTION[top.code], effect: null, action: { type: "none" },
    }));
  }
  return out;
}

export function evaluateInsights(f: InsightFacts, t: InsightThresholds): DriveInsight[] {
  const min = num(t["insight.min_sample"]);
  const ctx: Ctx = { f, t, D: Math.max(1, num(f.windowDays)), min, ok: (n) => n > 0 && n >= min };
  const all = [underTarget, weakStage, contactTiming, reminderGap, distance, channelGap, language, overbooking, streamDry, bestSource, weekday, outcomeReason].flatMap((r) => r(ctx));
  const seen = new Set<string>();
  // Every per-day effect divides by D, so the window length is part of its evidence (under_target is not per-day-scaled).
  for (const i of all) if (i.rule !== "under_target" && i.effect?.unit.endsWith("_per_day")) i.evidence.push({ label: "Days in the window", value: str(ctx.D) });
  return all
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.effect?.value ?? -1) - (a.effect?.value ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_INSIGHTS);
}
