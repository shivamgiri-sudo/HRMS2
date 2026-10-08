/**
 * Facts for the Command Center insights (he-drive-insights.ts). Read-only, never throws: every fact group is its own section; a failing
 * group is logged as section + code only (never the driver message), left at zero and named in `failedSections` ("insight:<group>").
 *
 * Every statement starts from he_drive (by requisition_id + drive_date) and reaches he_match, he_message, he_lead_insight and he_lead
 * by key through JOINs (STRAIGHT_JOIN, so the optimizer cannot start from the big message table). Credit goes through he_match.id as in
 * he-drive-analytics.service.ts. Counts, ids and labels only: error texts are folded to a Meta error code in code and never stored.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { valueAddOn } from "./he-valueadd-switches.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { SOURCE_TYPES, type Grid, type TaggedAggRow } from "./he-drive-analytics.js";
import type { InsightFacts, InsightThresholds, RateFact } from "./he-drive-insights.js";
import { getDrivePlan, poolRemaining, type DrivePlan } from "./he-drive-plan.service.js";
import { nextWorkingDay } from "./he-plan.service.js";
import { pShow, type ShowFacts } from "./he-showup.js";
import { loadShowParams } from "./he-showup.service.js";
import { driveCapacity, generateSlots, istAddMinutes, nowIst } from "./he-slots.js";
import { metaErrorCode } from "./qualified-followup.rules.js";
import type { SourceType } from "./qualified-followup.types.js";
import { loadActiveStreams, toWindow, type StreamRow } from "./requisition-stream.service.js";
import { countPlannedDays, addDays, windowEnd } from "./requisition-stream.window.js";
import type { RequisitionSourceRows } from "./he-sources-window.service.js";
import { countedNoShow } from "./he-no-show-events.js";
import { attributionJoinsSql, sourceTypeSql } from "./he-source-attribution.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";

export interface InsightFactsCtx {
  requisitionIds: string[]; from: string; to: string; today: string; windowDays: number;
  types: InsightFacts["types"]; agg: TaggedAggRow[]; sources: RequisitionSourceRows[]; codes: Map<string, string>; t: InsightThresholds;
  /** Arrival grids of the window (busy hours); open streams already loaded by the caller; the clock. */
  arrivals?: Record<SourceType, Grid>; streams?: StreamRow[]; now?: Date;
  /** Recorded no-show and decline reasons of the window (read once by the caller); passed through only while HE_OUTCOME_REASONS is on. */
  reasons?: InsightFacts["reasons"];
  /** Live Meta cutoff of the caller's build; read from he_model_param when not given. */
  liveFrom?: string;
}

export const MAX_PLAN_REQUISITIONS = 20;
const BUSY_HOURS = 3;
const SLOT_DAYS_AHEAD = 3;
const PLAN_PARALLEL = 4;

const ph = (n: number): string => Array(n).fill("?").join(",");
const noTable = (err: unknown): boolean => (err as { code?: unknown })?.code === "ER_NO_SUCH_TABLE";
const perType = <T>(make: () => T): Record<SourceType, T> => ({ meta_live: make(), meta_old: make(), he: make() });
const rate0 = (): RateFact => ({ n: 0, hits: 0 });
const count = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const typeOf = (v: unknown): SourceType | null => (SOURCE_TYPES.includes(v as SourceType) ? (v as SourceType) : null);
const batchesOf = (ids: string[]): string[][] => { const out: string[][] = []; for (let i = 0; i < ids.length; i += 200) out.push(ids.slice(i, i + 200)); return out; };

// ---- SQL ---------------------------------------------------------------------------------------------------------------------------------
// The shared source rule (he-source-attribution.ts), credit through he_match.id. requisition_stream* may not exist yet (ER_NO_SUCH_TABLE => no credit).
const creditJoin = (streams: boolean): string => attributionJoinsSql({ streams, match: "m", requisition: "d.requisition_id", lead: "al", leadId: "m.lead_id" });
const typeCol = (streams: boolean, liveFrom: string): string => sourceTypeSql({ streams, d: "d", lead: "al", liveFrom, ref: "d.drive_date" });
const FROM_MATCH = `FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id`;
const DRIVE_WHERE = (n: number): string => `d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?`;
const REPLY_24H = `EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.created_at > o.created_at AND i.created_at <= DATE_ADD(o.created_at, INTERVAL 24 HOUR))`;
const CONFIRMED_OR_LATER = "m.state IN ('confirmed','arrived','no_show','selected')";
const SHOWED = "m.state IN ('arrived','selected')";
const outboundJoin = (channels: string): string => `JOIN he_message o ON o.lead_id = m.lead_id AND o.direction = 'out' AND ${channels} AND o.created_at >= ? AND o.created_at < ?`;

// Outbound walk-in invites of matched leads with a known best hour; outside = more than the tolerance away from that hour.
// best_hour_ist is TINYINT UNSIGNED: cast before subtracting or an hour below it overflows. The distance is circular (23h vs 00h is 1).
const contactSql = (n: number, s: boolean, lf: string): string => `SELECT STRAIGHT_JOIN ${typeCol(s, lf)} AS source_type, (LEAST(ABS(HOUR(o.created_at) - CAST(li.best_hour_ist AS SIGNED)), 24 - ABS(HOUR(o.created_at) - CAST(li.best_hour_ist AS SIGNED))) > ?) AS outside,
       COUNT(DISTINCT o.id) AS n, COUNT(DISTINCT CASE WHEN ${REPLY_24H} THEN o.id END) AS hits
  ${FROM_MATCH}
  ${creditJoin(s)}
  ${outboundJoin("o.channel IN ('email','whatsapp') AND o.template_key LIKE 'he_walkin_invite%'")}
  JOIN he_lead_insight li ON li.lead_id = m.lead_id AND li.best_hour_ist IS NOT NULL
 WHERE ${DRIVE_WHERE(n)}
 GROUP BY 1, 2`;

// A reminder whose send FAILED is not a reminder (NULL status = not yet reported, still counted).
const remindersSql = (n: number, s: boolean, lf: string): string => `SELECT STRAIGHT_JOIN ${typeCol(s, lf)} AS source_type,
       (EXISTS (SELECT 1 FROM he_message r1 WHERE r1.lead_id = m.lead_id AND r1.drive_id = d.id AND r1.direction = 'out' AND r1.template_key LIKE 'he_reminder_1d%' AND (r1.delivery_status IS NULL OR r1.delivery_status <> 'failed'))
        OR EXISTS (SELECT 1 FROM he_message r2 WHERE r2.lead_id = m.lead_id AND r2.drive_id = d.id AND r2.direction = 'out' AND r2.template_key LIKE 'he_reminder_2h%' AND (r2.delivery_status IS NULL OR r2.delivery_status <> 'failed'))) AS has_reminder,
       COUNT(DISTINCT m.id) AS n, COUNT(DISTINCT CASE WHEN ${SHOWED} THEN m.id END) AS hits
  ${FROM_MATCH}
  ${creditJoin(s)}
 WHERE ${DRIVE_WHERE(n)} AND ${CONFIRMED_OR_LATER}
 GROUP BY 1, 2`;

const distanceSql = (n: number, s: boolean, lf: string): string => `SELECT STRAIGHT_JOIN ${typeCol(s, lf)} AS source_type, (m.distance_km > ?) AS far,
       COUNT(DISTINCT m.id) AS n, COUNT(DISTINCT CASE WHEN ${SHOWED} THEN m.id END) AS hits
  ${FROM_MATCH}
  ${creditJoin(s)}
 WHERE ${DRIVE_WHERE(n)} AND m.distance_km IS NOT NULL AND ${CONFIRMED_OR_LATER}
 GROUP BY 1, 2`;

const WA = "o.channel = 'whatsapp'";
const waFailedSql = (n: number, s: boolean, lf: string): string => `SELECT STRAIGHT_JOIN ${typeCol(s, lf)} AS source_type, o.error_message AS err, COUNT(DISTINCT o.id) AS n
  ${FROM_MATCH}
  ${creditJoin(s)}
  ${outboundJoin(`${WA} AND o.delivery_status = 'failed'`)}
 WHERE ${DRIVE_WHERE(n)}
 GROUP BY 1, 2`;
const waStatusSql = (n: number, s: boolean, lf: string): string => `SELECT STRAIGHT_JOIN ${typeCol(s, lf)} AS source_type,
       COUNT(DISTINCT CASE WHEN o.delivery_status IN ('delivered','read') THEN o.id END) AS wa_delivered,
       COUNT(DISTINCT CASE WHEN o.delivery_status = 'delivered' AND o.created_at < ? THEN o.id END) AS wa_unread
  ${FROM_MATCH}
  ${creditJoin(s)}
  ${outboundJoin(WA)}
 WHERE ${DRIVE_WHERE(n)}
 GROUP BY 1`;

const languageSql = (n: number, s: boolean, lf: string): string => `SELECT STRAIGHT_JOIN ${typeCol(s, lf)} AS source_type, COALESCE(li.language_pref = 'hi', 0) AS hi,
       COUNT(DISTINCT o.id) AS n, COUNT(DISTINCT CASE WHEN ${REPLY_24H} THEN o.id END) AS hits
  ${FROM_MATCH}
  ${creditJoin(s)}
  ${outboundJoin(WA)}
  LEFT JOIN he_lead_insight li ON li.lead_id = m.lead_id
 WHERE ${DRIVE_WHERE(n)}
 GROUP BY 1, 2`;

// Drives from today to today + 3 and their booked matches, one statement each (the same show-up facts as getControlRoom, no per-drive loop).
const slotDrivesSql = (n: number): string => `SELECT d.id, d.requisition_id, d.drive_date, d.slot_start, d.slot_end, d.slot_minutes, d.slot_capacity
  FROM he_drive d
 WHERE ${DRIVE_WHERE(n)} AND d.status <> 'closed'
 ORDER BY d.drive_date, d.id`;
const slotMatchesSql = (n: number): string => `SELECT STRAIGHT_JOIN m.drive_id, m.state, m.distance_km, m.slot_at, hl.walkin_count,
       (SELECT COUNT(*) FROM he_lead_event e WHERE e.lead_id = m.lead_id AND ${countedNoShow("e")} AND (e.drive_id IS NULL OR e.drive_id <> m.drive_id)) AS past_no_shows,
       EXISTS (SELECT 1 FROM he_location_ping p WHERE p.match_id = m.id) AS shared_location,
       EXISTS (SELECT 1 FROM he_message i WHERE i.lead_id = m.lead_id AND i.direction = 'in' AND i.intent IN ('confirm','on_my_way') AND i.created_at >= m.created_at) AS replied_yes
  ${FROM_MATCH}
  JOIN he_lead hl ON hl.id = m.lead_id
 WHERE ${DRIVE_WHERE(n)} AND d.status <> 'closed' AND m.state IN ('invited','confirmed','arrived','selected')`;

// ---- plumbing ----------------------------------------------------------------------------------------------------------------------------
type Failed = string[];
async function group<T>(name: string, failed: Failed, fn: () => Promise<T>, fallback: () => T): Promise<T> {
  try { return await fn(); } catch (err) {
    if (!failed.includes(name)) failed.push(name);
    logger.error({ section: name, code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-drive-insight-facts] section failed");
    return fallback();
  }
}
/** One statement per 200 requisitions; `streams` false is the same read before the stream tables exist. */
async function read(ids: string[], sqlOf: (n: number, streams: boolean, liveFrom: string) => string, params: (b: string[]) => unknown[], liveFrom: string): Promise<RowDataPacket[]> {
  const one = async (b: string[]): Promise<RowDataPacket[]> => {
    try { return (await db.execute<RowDataPacket[]>(sqlOf(b.length, true, liveFrom), params(b)))[0]; } catch (err) {
      if (!noTable(err)) throw err;
      return (await db.execute<RowDataPacket[]>(sqlOf(b.length, false, liveFrom), params(b)))[0];
    }
  };
  return (await Promise.all(batchesOf(ids).map(one))).flat();
}

const rateGroups = (rowsIn: RowDataPacket[], flag: string): Record<SourceType, { yes: RateFact; no: RateFact }> => {
  const out = perType(() => ({ yes: rate0(), no: rate0() }));
  for (const r of rowsIn) {
    const t = typeOf(r.source_type);
    if (!t) continue;
    const g = Number(r[flag]) === 1 ? out[t].yes : out[t].no;
    g.n += count(r.n); g.hits += count(r.hits);
  }
  return out;
};

const hourOf = (v: unknown): number | null => {
  const s = String(v ?? "");
  const h = Number(s.slice(11, 13));
  return s.length >= 13 && Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
};
const weekdayOf = (day: string): number => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday, as MySQL WEEKDAY()

function busyHours(arrivals: Record<SourceType, Grid> | undefined): Set<number> {
  const perHour = new Array<number>(24).fill(0);
  for (const t of SOURCE_TYPES) for (const row of arrivals?.[t] ?? []) for (let h = 0; h < 24; h++) perHour[h] += count(row?.[h]);
  return new Set(perHour.map((n, h) => ({ n, h })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.h - b.h).slice(0, BUSY_HOURS).map((x) => x.h));
}

// ---- plan-based facts --------------------------------------------------------------------------------------------------------------------
async function inChunks<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Collects the facts `evaluateInsights` needs. Never throws; see the header for the failure contract. */
export async function collectInsightFacts(ctx: InsightFactsCtx, scope: BranchScope): Promise<{ facts: InsightFacts; failedSections: string[] }> {
  const failed: Failed = [];
  const ids = [...ctx.requisitionIds];
  const now = ctx.now ?? new Date();
  const codeOf = (id: string): string => ctx.codes.get(id) ?? "";
  const dt = [`${ctx.from} 00:00:00`, `${addDays(ctx.to, 1)} 00:00:00`];
  const upTo = ctx.to < ctx.today ? ctx.to : ctx.today;
  const lf = ctx.liveFrom ?? await loadLiveFrom();
  const win = (b: string[]): unknown[] => [...dt, ...b, ctx.from, ctx.to];

  const facts: InsightFacts = {
    today: ctx.today, windowDays: ctx.windowDays, types: ctx.types, tomorrow: [],
    contact: perType(() => ({ inside: rate0(), outside: rate0() })),
    reminders: perType(() => ({ confirmed: 0, missing: 0, withReminder: rate0(), withoutReminder: rate0() })),
    distance: perType(() => ({ near: rate0(), far: rate0() })),
    channel: perType(() => ({ qualified: 0, unreached: 0, reachedArrivalRate: 0, waFailedByCode: {}, waDelivered: 0, waUnread: 0 })),
    language: perType(() => ({ hi: rate0(), other: rate0() })),
    slots: [], streams: [], sources: [], weekdays: [],
  };
  if (ctx.reasons && valueAddOn("outcome_reasons")) facts.reasons = ctx.reasons;
  if (ids.length === 0) return { facts, failedSections: [] };

  // The groups below are independent reads; each fills only its own part of `facts`.
  const reads = [
    group("insight:contact", failed, async () => {
      const g = rateGroups(await read(ids, contactSql, (b) => [ctx.t["insight.timing_hour_tolerance"], ...win(b)], lf), "outside");
      for (const t of SOURCE_TYPES) facts.contact[t] = { inside: g[t].no, outside: g[t].yes };
    }, () => undefined),
    group("insight:reminders", failed, async () => {
      const g = rateGroups(await read(ids, remindersSql, (b) => [...b, ctx.from, upTo], lf), "has_reminder");
      for (const t of SOURCE_TYPES) facts.reminders[t] = { confirmed: g[t].yes.n + g[t].no.n, missing: g[t].no.n, withReminder: g[t].yes, withoutReminder: g[t].no };
    }, () => undefined),
    group("insight:distance", failed, async () => {
      const g = rateGroups(await read(ids, distanceSql, (b) => [ctx.t["insight.distance_band_km"], ...b, ctx.from, upTo], lf), "far");
      for (const t of SOURCE_TYPES) facts.distance[t] = { near: g[t].no, far: g[t].yes };
    }, () => undefined),
    group("insight:channel", failed, async () => {
      const unreadBefore = istAddMinutes(nowIst(now), -24 * 60);
      const [failedRows, statusRows] = await Promise.all([
        read(ids, waFailedSql, win, lf),
        read(ids, waStatusSql, (b) => [unreadBefore, ...win(b)], lf),
      ]);
      const sums = perType(() => ({ qualified: 0, reached: 0, arrived: 0 }));
      for (const r of ctx.sources) for (const row of r.rows) {
        const t = typeOf(row.sourceType);
        if (!t) continue;
        sums[t].qualified += count(row.qualified); sums[t].arrived += count(row.arrived);
        sums[t].reached += Math.max(count(row.emailed), count(row.whatsapped)); // per row: a person reached by either channel
      }
      const byCode = perType(() => ({}) as Record<string, number>);
      for (const r of failedRows) {
        const t = typeOf(r.source_type);
        if (!t) continue;
        const code = metaErrorCode(r.err == null ? null : String(r.err)); // the text itself is dropped here
        byCode[t][code] = (byCode[t][code] ?? 0) + count(r.n);
      }
      const wa = perType(() => ({ delivered: 0, unread: 0 }));
      for (const r of statusRows) { const t = typeOf(r.source_type); if (t) { wa[t].delivered += count(r.wa_delivered); wa[t].unread += count(r.wa_unread); } }
      for (const t of SOURCE_TYPES) {
        const s = sums[t];
        facts.channel[t] = {
          qualified: s.qualified, unreached: Math.max(0, s.qualified - s.reached), reachedArrivalRate: s.reached > 0 ? s.arrived / s.reached : 0,
          waFailedByCode: byCode[t], waDelivered: wa[t].delivered, waUnread: wa[t].unread,
        };
      }
    }, () => undefined),
    group("insight:language", failed, async () => {
      const g = rateGroups(await read(ids, languageSql, win, lf), "hi");
      for (const t of SOURCE_TYPES) facts.language[t] = { hi: g[t].yes, other: g[t].no };
    }, () => undefined),
    group("insight:slots", failed, async () => {
      const last = addDays(ctx.today, SLOT_DAYS_AHEAD);
      const [drives, matches, params] = await Promise.all([
        readPlain(ids, slotDrivesSql, ctx.today, last), readPlain(ids, slotMatchesSql, ctx.today, last), loadShowParams(),
      ]);
      const busy = busyHours(ctx.arrivals);
      const byDrive = new Map<string, RowDataPacket[]>();
      for (const m of matches) { const l = byDrive.get(String(m.drive_id)); if (l) l.push(m); else byDrive.set(String(m.drive_id), [m]); }
      for (const d of drives) {
        const minutes = Number(d.slot_minutes), cap = Number(d.slot_capacity);
        if (!(minutes > 0) || !(cap > 0)) continue; // generateSlots would never end on a non-positive step
        const date = String(d.drive_date).slice(0, 10);
        const cfg = { date, start: String(d.slot_start), end: String(d.slot_end), minutes, capacity: cap };
        const mine = byDrive.get(String(d.id)) ?? [];
        let expected = 0, booked = 0;
        for (const m of mine) {
          const state = String(m.state);
          if (state === "arrived" || state === "selected") expected += 1;
          else if (m.slot_at) {
            const f: ShowFacts = {
              state, walkedBefore: Number(m.walkin_count) > 0, pastNoShows: count(m.past_no_shows),
              distanceKm: m.distance_km == null ? null : Number(m.distance_km), sharedLocation: Number(m.shared_location) === 1, repliedPositive: Number(m.replied_yes) === 1,
            };
            expected += pShow(f, params);
          }
          const h = hourOf(m.slot_at);
          if (h !== null && busy.has(h)) booked++;
        }
        const busySlots = generateSlots(cfg).filter((s) => busy.has(Number(s.slice(11, 13)))).length;
        facts.slots.push({
          driveId: String(d.id), requisitionId: String(d.requisition_id), code: codeOf(String(d.requisition_id)), date, capacity: driveCapacity(cfg),
          expected: Math.round(expected * 1000) / 1000, busyHourSeats: busySlots * cap, busyHourBooked: booked,
        });
      }
    }, () => undefined),
    group("insight:sources", failed, async () => {
      const inWin = ctx.agg.filter((r) => r.date >= ctx.from && r.date <= ctx.to);
      const invited = new Map<string, number>();
      for (const r of inWin) { const k = `${r.requisitionId}|${r.streamType ?? "he"}`; invited.set(k, (invited.get(k) ?? 0) + count(r.invited)); }
      for (const r of ctx.sources) {
        const byType: InsightFacts["sources"][number]["byType"] = {};
        for (const row of r.rows) {
          const t = typeOf(row.sourceType);
          if (!t) continue;
          const e = byType[t] ?? { leads: 0, joined: 0, invited: invited.get(`${r.requisitionId}|${t}`) ?? 0 };
          e.leads += count(row.leads); e.joined += count(row.joined);
          byType[t] = e;
        }
        for (const t of SOURCE_TYPES) if (!byType[t] && invited.get(`${r.requisitionId}|${t}`)) byType[t] = { leads: 0, joined: 0, invited: invited.get(`${r.requisitionId}|${t}`) ?? 0 };
        if (Object.keys(byType).length) facts.sources.push({ requisitionId: r.requisitionId, code: codeOf(r.requisitionId), byType });
      }
      const wd = new Map<number, { confirmed: number; arrived: number }>();
      for (const r of inWin) {
        const k = weekdayOf(r.date), e = wd.get(k) ?? { confirmed: 0, arrived: 0 };
        e.confirmed += count(r.confirmed); e.arrived += count(r.arrived);
        wd.set(k, e);
      }
      facts.weekdays = [...wd.entries()].sort((a, b) => a[0] - b[0]).map(([weekday, e]) => ({ weekday, ...e }));
    }, () => undefined),
    group("insight:plan", failed, () => planFacts(), () => undefined),
  ];
  await Promise.all(reads);

  async function planFacts(): Promise<void> {
    const tomorrow = nextWorkingDay(now);
    let open: StreamRow[] = ctx.streams ?? [];
    if (!ctx.streams) open = await group("insight:streams", failed, async () => { try { return await loadActiveStreams(); } catch (err) { if (noTable(err)) return []; throw err; } }, () => [] as StreamRow[]);
    const mine = new Set(ids);
    open = open.filter((s) => s.status === "open" && mine.has(s.requisitionId));
    // Plans are built ONLY for requisitions with an open stream, earliest stream end first. A requisition whose drives have no stream
    // (production before streams) gets no plan: its plan would read expected 0 against the drive's target and fire a false critical.
    const endOf = new Map<string, string>();
    for (const s of open) { const e = windowEnd(toWindow(s)); const cur = endOf.get(s.requisitionId); if (cur === undefined || e < cur) endOf.set(s.requisitionId, e); }
    const ordered = [...endOf.entries()].sort((a, b) => (a[0] === b[0] ? 0 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
    const chosen = ordered.slice(0, MAX_PLAN_REQUISITIONS);

    const plans = new Map<string, DrivePlan>();
    await group("insight:tomorrow", failed, async () => {
      const got = await inChunks(chosen, PLAN_PARALLEL, async (id) => {
        try { return [id, await getDrivePlan({ requisitionId: id, from: tomorrow, days: 1 }, scope, now, ctx.t)] as const; } catch (err) {
          if (!failed.includes("insight:tomorrow")) failed.push("insight:tomorrow");
          logger.error({ section: "insight:tomorrow", code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-drive-insight-facts] section failed");
          return [id, null] as const;
        }
      });
      for (const [id, p] of got) {
        if (!p) continue;
        // a degraded plan (e.g. its rates fell back to the default) must not feed insights, and flags the response partial
        if (p.partial) { if (!failed.includes("insight:tomorrow")) failed.push("insight:tomorrow"); continue; }
        plans.set(id, p);
      }
    }, () => undefined);
    for (const id of chosen) {
      const day = plans.get(id)?.days.find((d) => d.date === tomorrow);
      if (!day || !day.streams.some((s) => s.covers)) continue; // no stream plans that day: nothing to project or recommend
      facts.tomorrow.push({
        requisitionId: id, code: codeOf(id), date: day.date, target: count(day.target), projected: day.expected,
        recommended: day.streams.filter((s) => s.recommended > 0).map((s) => ({ streamId: s.streamId, sourceType: s.sourceType, invites: s.recommended })),
      });
    }

    const chosenSet = new Set(chosen);
    const streams = open.filter((s) => chosenSet.has(s.requisitionId));
    await group("insight:streams", failed, async () => {
      const lines = await inChunks(streams, PLAN_PARALLEL, async (s) => {
        const remainingDays = countPlannedDays(tomorrow, windowEnd(toWindow(s)), s);
        const cap = plans.get(s.requisitionId)?.days.find((d) => d.date === tomorrow)?.streams.find((l) => l.streamId === s.id)?.cap ?? count(s.dailyInvites);
        let pool: number | null = null;
        try { pool = await poolRemaining(s); } catch (err) {
          if (!failed.includes("insight:streams")) failed.push("insight:streams");
          logger.error({ section: "insight:streams", code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-drive-insight-facts] section failed");
        }
        return { streamId: s.id, requisitionId: s.requisitionId, code: codeOf(s.requisitionId), sourceType: s.sourceType, cap, remainingDays, poolRemaining: pool };
      });
      facts.streams.push(...lines.filter((l) => l.cap > 0 && l.remainingDays > 0));
    }, () => undefined);
  }

  return { facts, failedSections: [...new Set(failed)] };

  async function readPlain(list: string[], sqlOf: (n: number) => string, ...tail: unknown[]): Promise<RowDataPacket[]> {
    return (await Promise.all(batchesOf(list).map(async (b) => (await db.execute<RowDataPacket[]>(sqlOf(b.length), [...b, ...tail]))[0]))).flat();
  }
}
