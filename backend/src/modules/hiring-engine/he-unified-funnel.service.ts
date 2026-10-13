/**
 * One funnel from one person list, so the three drives add up. Population: every person in the live follow-up, typed once (Live Meta,
 * then Old Meta data, then Hiring Engine when a person sits in more than one) by the follow-up's own source type. Stages per person:
 * enrolled, emailed, WhatsApped, bot called, confirmed (a booking with a confirmation), walked in (an ATS registration on or after the day
 * of enrolment, booked or not), selected and joined (the ATS dashboard's own rules: isSelected and candidateBecameEmployee).
 * "ATS only" is every other ATS registration of the same window: candidates who came through other sources. Counts only; read-only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { candidateBecameEmployee, getEmployeeMobileJoinMap } from "../ats/analytics.unified.service.js";
import { isSelected } from "../ats/dashboard.overview.service.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import type { SourceType } from "./qualified-followup.types.js";

export interface FunnelCounts { enrolled: number; emailed: number; whatsapped: number; called: number; confirmed: number; walkedIn: number; selected: number; joined: number }
export interface FunnelInsight { level: "info" | "warn"; text: string }
export interface UnifiedFunnel {
  generatedAt: string; from: string; to: string;
  /** Per day: people first contacted, and branch registrations of people the engine contacted (cohort view). */
  daily: Array<{ date: string; enrolled: number; walkedIn: number }>;
  insights: FunnelInsight[];
  drives: Record<SourceType, FunnelCounts>;
  drivesTotal: FunnelCounts;
  /** Everyone registered at a branch in the window: the drives' walk-ins plus the rest. */
  ats: { registered: number; selected: number; joined: number; fromDrives: number; beforeEnrolment: number; otherSources: { registered: number; selected: number; joined: number } };
}

const RANK: SourceType[] = ["meta_live", "meta_old", "he"];
const zero = (): FunnelCounts => ({ enrolled: 0, emailed: 0, whatsapped: 0, called: 0, confirmed: 0, walkedIn: 0, selected: 0, joined: 0 });
const norm10 = (m: unknown): string => String(m ?? "").replace(/\D/g, "").slice(-10);
const day = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);
const cache = new Map<string, { at: number; value: UnifiedFunnel }>();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const istToday = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDay = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pc = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) : 0);

/** Written findings from the counts: where people drop, which drive converts best, how big the drives are against the whole ATS. */
export function funnelInsights(d: { drives: Record<SourceType, FunnelCounts>; total: FunnelCounts; ats: UnifiedFunnel["ats"] }): FunnelInsight[] {
  const out: FunnelInsight[] = [];
  const t = d.total;
  if (!t.enrolled) return [{ level: "info", text: "Nobody was first contacted in this period." }];
  const steps: Array<[string, number, number]> = [["contacted by email, WhatsApp or call", t.enrolled, Math.max(t.emailed, t.whatsapped)], ["confirmed a slot", t.enrolled, t.confirmed], ["walked in", t.confirmed, t.walkedIn], ["were selected", t.walkedIn, t.selected], ["joined", t.selected, t.joined]];
  out.push({ level: "info", text: `${t.enrolled.toLocaleString("en-IN")} people were first contacted; ${pc(t.confirmed, t.enrolled)}% confirmed, ${(t.walkedIn / t.enrolled * 100).toFixed(1)}% walked in, ${(t.joined / t.enrolled * 100).toFixed(1)}% joined.` });
  if (t.confirmed > 0) out.push({ level: pc(t.walkedIn, t.confirmed) < 50 ? "warn" : "info", text: `Of ${t.confirmed.toLocaleString("en-IN")} who confirmed a slot, ${t.walkedIn.toLocaleString("en-IN")} walked in (${pc(t.walkedIn, t.confirmed)}%). ${pc(t.walkedIn, t.confirmed) < 50 ? "Most confirmations do not turn into visits: reminders and the confirm step are the biggest lever." : ""}`.trim() });
  const rates = (Object.keys(d.drives) as SourceType[]).filter((k) => d.drives[k].enrolled >= 50).map((k) => ({ k, r: d.drives[k].walkedIn / d.drives[k].enrolled }));
  if (rates.length > 1) {
    rates.sort((a, b) => b.r - a.r);
    const name: Record<SourceType, string> = { meta_live: "Live Meta", meta_old: "Old Meta data", he: "Hiring Engine" };
    out.push({ level: "info", text: `${name[rates[0].k]} brings the most walk-ins per person contacted (${(rates[0].r * 100).toFixed(1)}%); ${name[rates[rates.length - 1].k]} the fewest (${(rates[rates.length - 1].r * 100).toFixed(1)}%).` });
  }
  if (d.ats.registered > 0) out.push({ level: pc(t.walkedIn, d.ats.registered) < 15 ? "warn" : "info", text: `The drives account for ${pc(t.walkedIn, d.ats.registered)}% of branch registrations (${t.walkedIn} of ${d.ats.registered}); the rest came from other sources, which produced ${d.ats.otherSources.joined} of the ${d.ats.joined} joiners.` });
  if (t.selected > 0 && t.joined === 0) out.push({ level: "warn", text: "People selected from the drives have not joined yet: check offers and joining dates." });
  void steps;
  return out;
}

export async function getUnifiedFunnel(fromIn?: string, toIn?: string): Promise<UnifiedFunnel> {
  const today = istToday();
  const to = toIn && ISO.test(toIn) && toIn <= today ? toIn : today;
  let fromD = fromIn && ISO.test(fromIn) ? fromIn : addDay(to, -29);
  if (fromD > to) fromD = to;
  if (fromD < addDay(to, -180)) fromD = addDay(to, -180);
  const key = `${fromD}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  // Stale-while-revalidate: an older answer is returned at once and refreshed in the background, so the dashboards never wait on the heavy read.
  if (hit && Date.now() - hit.at < 6 * 3600_000) { void refresh(fromD, to, key).catch(() => undefined); return hit.value; }
  return refresh(fromD, to, key);
}

const inflight = new Map<string, Promise<UnifiedFunnel>>();
function refresh(fromD: string, to: string, key: string): Promise<UnifiedFunnel> {
  const run = inflight.get(key) ?? compute(fromD, to, key).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/** Warms the three preset ranges (7, 30 and 90 days); called by the worker every 10 minutes. */
export async function warmUnifiedFunnels(): Promise<void> {
  const today = istToday();
  for (const days of [30, 7, 90]) { try { await refresh(addDay(today, -(days - 1)), today, `${addDay(today, -(days - 1))}|${today}`); } catch { /* next round */ } }
}

async function compute(fromD: string, to: string, key: string): Promise<UnifiedFunnel> {
  const [fu] = await db.execute<RowDataPacket[]>(
    `SELECT mobile10, source_type, MIN(created_at) AS enrolled_at, MAX(email_sent_at IS NOT NULL) AS em, MAX(wa_sent_at IS NOT NULL) AS wa, MAX(call_state = 'called') AS ca
       FROM qualified_followup WHERE mode_at_enqueue = 'live' GROUP BY mobile10, source_type`);
  const people = new Map<string, { type: SourceType; enrolledDay: string; em: boolean; wa: boolean; ca: boolean }>();
  for (const r of fu) {
    const m = String(r.mobile10); const type = String(r.source_type) as SourceType;
    const cur = people.get(m);
    const next = { type, enrolledDay: day(r.enrolled_at), em: Number(r.em) === 1, wa: Number(r.wa) === 1, ca: Number(r.ca) === 1 };
    if (!cur) { people.set(m, next); continue; }
    const better = RANK.indexOf(type) < RANK.indexOf(cur.type);
    people.set(m, { type: better ? type : cur.type, enrolledDay: next.enrolledDay < cur.enrolledDay ? next.enrolledDay : cur.enrolledDay, em: cur.em || next.em, wa: cur.wa || next.wa, ca: cur.ca || next.ca });
  }
  // Earlier history: the last 30 days of Meta form fills and of outbound messages and bot calls, for people the live follow-up does not hold.
  // Typed Live / Old Meta by the first form fill against the cutoff, everyone else Hiring Engine; enrolled = first contact (or the fill day).
  const since = addDay(fromD, -60);
  const liveFrom = String(await loadLiveFrom()).slice(0, 10);
  const add = (m: string, type: SourceType, d: string, f: { em?: boolean; wa?: boolean; ca?: boolean }, hasFollowup: boolean) => {
    const cur = people.get(m);
    if (!cur) { people.set(m, { type, enrolledDay: d, em: !!f.em, wa: !!f.wa, ca: !!f.ca }); return; }
    people.set(m, { type: hasFollowup ? cur.type : cur.type, enrolledDay: d < cur.enrolledDay ? d : cur.enrolledDay, em: cur.em || !!f.em, wa: cur.wa || !!f.wa, ca: cur.ca || !!f.ca });
  };
  const inFollowup = new Set(people.keys());
  const [fills] = await db.execute<RowDataPacket[]>(
    `SELECT RIGHT(REGEXP_REPLACE(parsed_phone,'[^0-9]',''),10) AS m, MIN(created_at) AS first_fill FROM meta_lead_raw
      WHERE created_at >= ? AND parsed_phone IS NOT NULL GROUP BY m`, [since]);
  for (const r of fills) { const m = String(r.m); if (m.length === 10) { const d = day(r.first_fill); add(m, d >= liveFrom ? "meta_live" : "meta_old", d, {}, false); } }
  const [msgs] = await db.execute<RowDataPacket[]>(
    `SELECT l.mobile10 AS m, h.channel, MIN(h.created_at) AS first_at FROM he_message h JOIN he_lead l ON l.id = h.lead_id
      WHERE h.direction = 'out' AND h.created_at >= ? AND h.channel IN ('email','whatsapp') AND (h.delivery_status IS NULL OR h.delivery_status <> 'failed') GROUP BY l.mobile10, h.channel`, [since]);
  for (const r of msgs) { const m = String(r.m); add(m, "he", day(r.first_at), { em: r.channel === "email", wa: r.channel === "whatsapp" }, false); }
  const [calls] = await db.execute<RowDataPacket[]>(
    `SELECT l.mobile10 AS m, MIN(c.created_at) AS first_at FROM he_call c JOIN he_lead l ON l.id = c.lead_id WHERE c.created_at >= ? GROUP BY l.mobile10`, [since]);
  for (const r of calls) { const m = String(r.m); add(m, "he", day(r.first_at), { ca: true }, false); }
  // (A person already in the follow-up keeps their type; earlier contacts only move their enrolment day back and add channels.)
  // A person first seen as a plain Hiring Engine message who also has a Meta fill is a Meta person.
  for (const r of fills) { const m = String(r.m); const p = people.get(m); if (p && !inFollowup.has(m) && p.type === "he") { const d = day(r.first_fill); people.set(m, { ...p, type: d >= liveFrom ? "meta_live" : "meta_old" }); } }
  // Only people first contacted inside the period are in the cohort.
  for (const [m, p] of [...people]) if (p.enrolledDay < fromD || p.enrolledDay > to) people.delete(m);
  const from = fromD;

  const confirmed = new Set<string>();
  const [cf] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT l.mobile10 FROM he_match m JOIN he_lead l ON l.id = m.lead_id WHERE m.confirmed_at IS NOT NULL AND m.confirmed_at >= ?`, [fromD]);
  for (const r of cf) confirmed.add(String(r.mobile10));

  const [ats] = await db.execute<RowDataPacket[]>(
    `SELECT mobile, status, current_stage, created_at, walk_in_date FROM ats_candidate WHERE active_status = 1 AND walk_in_date >= ? AND walk_in_date <= ?`, [fromD, to]);
  const joinMap = await getEmployeeMobileJoinMap();

  const drives: Record<SourceType, FunnelCounts> = { meta_live: zero(), meta_old: zero(), he: zero() };
  for (const [m, p] of people) {
    const c = drives[p.type];
    c.enrolled++; if (p.em) c.emailed++; if (p.wa) c.whatsapped++; if (p.ca) c.called++; if (confirmed.has(m)) c.confirmed++;
  }
  const seen = new Set<string>();
  const out = { registered: 0, selected: 0, joined: 0, fromDrives: 0, beforeEnrolment: 0, otherSources: { registered: 0, selected: 0, joined: 0 } };
  for (const r of ats) {
    const m = norm10(r.mobile);
    const sel = isSelected(String(r.status ?? ""), String(r.current_stage ?? ""));
    const joi = candidateBecameEmployee({ current_stage: r.current_stage, mobile: r.mobile, created_at: r.created_at }, joinMap);
    out.registered++; if (sel) out.selected++; if (joi) out.joined++;
    const p = people.get(m);
    if (p && String(r.walk_in_date).slice(0, 10) >= p.enrolledDay && !seen.has(m)) {
      seen.add(m); out.fromDrives++;
      const c = drives[p.type]; c.walkedIn++; if (sel) c.selected++; if (joi) c.joined++;
    } else if (p) {
      out.beforeEnrolment++; // registered at a branch before the engine enrolled them, or a second registration of the same person
    } else {
      out.otherSources.registered++; if (sel) out.otherSources.selected++; if (joi) out.otherSources.joined++;
    }
  }
  const total = zero();
  for (const t of RANK) for (const k of Object.keys(total) as Array<keyof FunnelCounts>) total[k] += drives[t][k];
  const dayMap = new Map<string, { enrolled: number; walkedIn: number }>();
  for (let d = fromD; d <= to; d = addDay(d, 1)) dayMap.set(d, { enrolled: 0, walkedIn: 0 });
  for (const p of people.values()) { const x = dayMap.get(p.enrolledDay); if (x) x.enrolled++; }
  const dayOfMobile = new Map<string, string>();
  for (const r of ats) { const m = norm10(r.mobile); if (seen.has(m) && !dayOfMobile.has(m)) dayOfMobile.set(m, String(r.walk_in_date).slice(0, 10)); }
  for (const dd of dayOfMobile.values()) { const x = dayMap.get(dd); if (x) x.walkedIn++; }
  const daily = [...dayMap].map(([date, v]) => ({ date, ...v }));
  const value: UnifiedFunnel = { generatedAt: new Date().toISOString(), from, to, daily, insights: funnelInsights({ drives, total, ats: out }), drives, drivesTotal: total, ats: out };
  cache.set(key, { at: Date.now(), value });
  return value;
}
