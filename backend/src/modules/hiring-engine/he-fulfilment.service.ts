/**
 * The owner's two questions, answered from data the system already holds:
 *   1. Who is expected to walk in, at which branch and at what time (today, and the next working day with drives)?
 *   2. Will every open requisition be filled by its deadline, and if not, what is the shortfall and what must the engine add per day?
 * Expected arrivals weigh each booked person by their learned show-up probability (he-showup). The lead requirement comes from the
 * planner: this process's (else all hiring's) lead -> walk-in -> selection -> joined history, sized to the seats still open.
 * Read-only. A failure in one requisition leaves that row out with a reason; it never fails the page.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { FACTS_SQL, loadShowParams } from "./he-showup.service.js";
import { pShow } from "./he-showup.js";
import { planHiring } from "./he-planner.service.js";
import { dailyInviteTarget } from "./walkin-booking.service.js";
import { joinTarget, selectionsStillNeeded } from "../../shared/requisition-fill.js";

export interface HourBucket { hour: string; booked: number; confirmed: number; expected: number }
export interface BranchDay { branch: string; booked: number; confirmed: number; expected: number; hours: HourBucket[] }
export interface ExpectedDay { date: string; booked: number; confirmed: number; expected: number; branches: BranchDay[] }
export type FillVerdict = "covered" | "on_track" | "at_risk" | "past_deadline" | "no_history" | "queued";
export interface RequisitionFill {
  id: string; code: string; branch: string; process: string; role: string;
  /** Selections still to make to reach the 130% target (selected or joined, whichever is larger, already counted). */
  seatsOpen: number; requested: number; fulfilled: number; target: number; selected: number; joined: number;
  /** Position in the sequence of this process, designation and branch (1 = being filled now) and which requisition it waits for. */
  sequence: number; queuedBehind: string | null;
  deadline: string | null; daysLeft: number | null;
  neededLeads: number; covered: number; gap: number; perDayNeeded: number; capacityPerDay: number;
  invited: number; confirmed: number; expectedArrivals7d: number; expectedJoined: number;
  ratesFrom: "branch+process" | "process" | "all"; verdict: FillVerdict; reason: string;
}
export interface FulfilmentView { generatedAt: string; today: ExpectedDay; next: ExpectedDay | null; requisitions: RequisitionFill[]; totals: { seatsOpen: number; atRisk: number; expectedToday: number };
  /** True while the per-requisition sizing is still being computed (the first read after a restart): the day blocks are final, the table follows. */
  computing: boolean }

const IST_MS = 330 * 60_000;
const istDay = (d: Date): string => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const r1 = (n: number): number => Math.round(n * 10) / 10;
const num = (v: unknown): number => Number(v ?? 0) || 0;
const dayOf = (v: unknown): string | null => (v == null || v === "" ? null : String(v).slice(0, 10));

async function safe<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) { logger.warn({ label, err: (err as Error).message.slice(0, 140) }, "[fulfilment] read failed"); return fallback; }
}

interface FactRow extends RowDataPacket { state: string; slot_at: string | null; drive_date: string; branch_name: string; requisition_id: string }

function toDay(date: string, rows: FactRow[], params: Record<string, number>): ExpectedDay {
  const branches = new Map<string, BranchDay>();
  let booked = 0, confirmed = 0, expected = 0;
  for (const r of rows.filter((x) => dayOf(x.drive_date) === date)) {
    const p = pShow({ state: String(r.state), walkedBefore: num(r.walkin_count) > 0, pastNoShows: num(r.past_no_shows), distanceKm: r.distance_km == null ? null : num(r.distance_km), sharedLocation: num(r.shared_location) === 1, repliedPositive: num(r.replied_yes) === 1 }, params);
    const arrived = r.state === "arrived";
    const e = arrived ? 1 : p;
    const hour = r.slot_at ? `${String(r.slot_at).slice(11, 13)}:00` : "no slot";
    let b = branches.get(r.branch_name);
    if (!b) { b = { branch: r.branch_name, booked: 0, confirmed: 0, expected: 0, hours: [] }; branches.set(r.branch_name, b); }
    let h = b.hours.find((x) => x.hour === hour);
    if (!h) { h = { hour, booked: 0, confirmed: 0, expected: 0 }; b.hours.push(h); }
    const isConfirmed = r.state === "confirmed" || arrived;
    b.booked++; h.booked++; booked++;
    if (isConfirmed) { b.confirmed++; h.confirmed++; confirmed++; }
    b.expected += e; h.expected += e; expected += e;
  }
  const list = [...branches.values()].map((b) => ({ ...b, expected: r1(b.expected), hours: b.hours.map((h) => ({ ...h, expected: r1(h.expected) })).sort((a, c) => a.hour.localeCompare(c.hour)) }));
  list.sort((a, c) => c.expected - a.expected);
  return { date, booked, confirmed, expected: r1(expected), branches: list };
}

async function computeFulfilment(now: Date): Promise<FulfilmentView> {
  const today = istDay(now);
  const params = await safe("show-params", {} as Record<string, number>, loadShowParams);
  const facts = await safe<FactRow[]>("facts", [], async () => (await db.execute<RowDataPacket[]>(
    `SELECT f.*, d.drive_date, d.branch_name, d.requisition_id FROM (${FACTS_SQL}) f JOIN he_drive d ON d.id = f.drive_id
      WHERE d.drive_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND d.status IN ('active','draft','paused')
        AND f.state IN ('invited','confirmed','arrived')`))[0] as FactRow[]);
  const dates = [...new Set(facts.map((f) => dayOf(f.drive_date)).filter((d): d is string => !!d))].sort();
  const todayDay = toDay(today, facts, params);
  const nextDate = dates.find((d) => d > today) ?? null;
  const nextDay = nextDate ? toDay(nextDate, facts, params) : null;

  const reqs = await safe<RowDataPacket[]>("requisitions", [], async () => (await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_code, designation_name, process_name, branch_name, requested_headcount, fulfilled_headcount, joined_headcount, requisition_validity
       FROM job_requisition WHERE active_status = 1 AND approval_status = 'approved' AND closed_at IS NULL AND joined_headcount < CEIL(requested_headcount * 1.3)
      ORDER BY (requisition_validity IS NULL), requisition_validity ASC LIMIT 12`))[0]);
  const capacity = await safe("capacity", 400, dailyInviteTarget);
  // Sequence inside each process + designation + branch: nearest end date first (none last), then the lower requisition number.
  const seqNo = (code: string): number => { const m = /-(\d+)\s*$/.exec(code); return m ? Number(m[1]) : Number.POSITIVE_INFINITY; };
  const groupKey = (q: RowDataPacket): string => [q.process_name, q.designation_name, q.branch_name].map((x) => String(x ?? "").toUpperCase()).join("|");
  // A requisition whose end date has passed is overflow (arrivals roll to the next open one); it never holds the queue.
  const expired = (q: RowDataPacket): boolean => { const d = dayOf(q.requisition_validity); return d != null && d < today; };
  const ordered = [...reqs].filter((q) => !expired(q)).sort((a, b) => groupKey(a).localeCompare(groupKey(b))
    || String(a.requisition_validity ?? "9999-12-31").localeCompare(String(b.requisition_validity ?? "9999-12-31")) || seqNo(String(a.requisition_code)) - seqNo(String(b.requisition_code)));
  const seq = new Map<string, { n: number; behind: string | null }>();
  const firstOf = new Map<string, string>(); const countOf = new Map<string, number>();
  for (const q of ordered) {
    const k = groupKey(q); const n = (countOf.get(k) ?? 0) + 1; countOf.set(k, n);
    if (n === 1) firstOf.set(k, String(q.requisition_code));
    seq.set(String(q.id), { n, behind: n === 1 ? null : (firstOf.get(k) ?? null) });
  }
  const out: RequisitionFill[] = [];
  for (const q of reqs) {
    const id = String(q.id);
    const requestedSeats = num(q.requested_headcount), selected = num(q.fulfilled_headcount), joined = num(q.joined_headcount);
    const seatsOpen = selectionsStillNeeded(requestedSeats, selected, joined);
    const position = seq.get(id) ?? { n: 0, behind: null }; // 0 = overflow (end date passed)
    const deadline = dayOf(q.requisition_validity);
    const daysLeft = deadline ? Math.ceil((Date.parse(`${deadline}T23:59:59+05:30`) - now.getTime()) / 86_400_000) : null;
    const mine = facts.filter((f) => String(f.requisition_id) === id);
    const invited = mine.filter((f) => f.state === "invited").length, confirmed = mine.filter((f) => f.state === "confirmed" || f.state === "arrived").length;
    const exp7 = r1(mine.reduce((a, f) => a + pShow({ state: String(f.state), walkedBefore: num(f.walkin_count) > 0, pastNoShows: num(f.past_no_shows), distanceKm: f.distance_km == null ? null : num(f.distance_km), sharedLocation: num(f.shared_location) === 1, repliedPositive: num(f.replied_yes) === 1 }, params), 0));
    try {
      const plan = await planHiring({ requisitionId: id, targetSelected: seatsOpen, deadline: deadline && (daysLeft ?? 0) > 0 ? deadline : null });
      const neededLeads = plan.totals.uniqueLeads;
      const covered = plan.pool.reachableNow + Math.max(plan.pool.invitedOrConfirmed, plan.pool.inPipeline);
      const gap = Math.max(0, neededLeads - covered);
      const horizon = daysLeft != null && daysLeft > 0 ? daysLeft : 7;
      const perDay = gap > 0 ? Math.ceil(gap / horizon) : 0;
      let verdict: FillVerdict; let reason: string;
      if (daysLeft != null && daysLeft <= 0) { verdict = "past_deadline"; reason = `The end date has passed with ${seatsOpen} seats open: people who arrive are carried to the next open requisition at this branch.`; }
      else if (plan.scope === "all" && neededLeads === 0) { verdict = "no_history"; reason = "Not enough history to size this requisition yet."; }
      else if (position.behind) { verdict = "queued"; reason = `Queued: filled after ${position.behind} (same process, designation and branch). It starts when ${position.behind} reaches its join target. ${gap <= 0 ? "Its people are already lined up." : `About ${gap} more people will be needed then.`}`; }
      else if (gap <= 0) { verdict = "covered"; reason = `${covered} people are already invited or queued, which covers the ${neededLeads} the history says are needed.`; }
      else if (perDay <= capacity) { verdict = "on_track"; reason = `${covered} of ${neededLeads} needed are covered. The engine must add about ${perDay} a day for ${horizon} day${horizon === 1 ? "" : "s"}; its daily capacity is ${capacity}.`; }
      else { verdict = "at_risk"; reason = `${covered} of ${neededLeads} needed are covered. It needs ${perDay} new people a day for ${horizon} day${horizon === 1 ? "" : "s"}, above the ${capacity} a day the engine sends. More leads or a later date are needed.`; }
      out.push({
        id, code: String(q.requisition_code), branch: String(q.branch_name ?? ""), process: String(q.process_name ?? ""), role: String(q.designation_name ?? ""),
        seatsOpen, requested: requestedSeats, fulfilled: selected, target: joinTarget(requestedSeats), selected, joined, sequence: position.n, queuedBehind: position.behind, deadline, daysLeft,
        neededLeads, covered, gap, perDayNeeded: perDay, capacityPerDay: capacity, invited, confirmed, expectedArrivals7d: exp7, expectedJoined: plan.totals.expectedJoined,
        ratesFrom: plan.scope, verdict, reason,
      });
    } catch (err) {
      logger.warn({ id, err: (err as Error).message.slice(0, 120) }, "[fulfilment] requisition skipped");
    }
  }
  return {
    generatedAt: now.toISOString(), today: todayDay, next: nextDay, requisitions: out,
    totals: { seatsOpen: out.reduce((a, r) => a + r.seatsOpen, 0), atRisk: out.filter((r) => r.verdict === "at_risk").length, expectedToday: todayDay.expected },
    computing: false,
  };
}

// Sizing every requisition scans six months of recruiter history (8 to 15 s per scope when cold), so a request never waits for it:
// the last snapshot is served, a stale one is refreshed in the background, and the very first read after a restart answers within
// WAIT_MS with whatever is ready (computing = true) while the snapshot finishes.
const TTL_MS = 5 * 60_000;
const WAIT_MS = 12_000;
let snapshot: { at: number; data: FulfilmentView } | null = null;
let inflight: Promise<FulfilmentView> | null = null;

function refresh(now: Date): Promise<FulfilmentView> {
  if (!inflight) {
    inflight = computeFulfilment(now)
      .then((d) => { snapshot = { at: Date.now(), data: d }; return d; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export async function getFulfilment(now: Date = new Date()): Promise<FulfilmentView> {
  if (snapshot && Date.now() - snapshot.at < TTL_MS) return snapshot.data;
  if (snapshot) { void refresh(now).catch(() => undefined); return snapshot.data; }
  const p = refresh(now);
  void p.catch(() => undefined);
  const early = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))]);
  if (early) return early;
  // Not ready yet: the fast part (who is expected) is cheap, so answer with it and let the table fill in.
  const fast = await computeExpectedOnly(now);
  return fast;
}

async function computeExpectedOnly(now: Date): Promise<FulfilmentView> {
  const today = istDay(now);
  const params = await safe("show-params", {} as Record<string, number>, loadShowParams);
  const facts = await safe<FactRow[]>("facts", [], async () => (await db.execute<RowDataPacket[]>(
    `SELECT f.*, d.drive_date, d.branch_name, d.requisition_id FROM (${FACTS_SQL}) f JOIN he_drive d ON d.id = f.drive_id
      WHERE d.drive_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND d.status IN ('active','draft','paused')
        AND f.state IN ('invited','confirmed','arrived')`))[0] as FactRow[]);
  const dates = [...new Set(facts.map((f) => dayOf(f.drive_date)).filter((d): d is string => !!d))].sort();
  const t = toDay(today, facts, params);
  const nd = dates.find((d) => d > today) ?? null;
  return { generatedAt: now.toISOString(), today: t, next: nd ? toDay(nd, facts, params) : null, requisitions: [], totals: { seatsOpen: 0, atRisk: 0, expectedToday: t.expected }, computing: true };
}

/** Compute the snapshot once after start so the first visit is instant; re-run every 4 minutes. */
let warmTimer: ReturnType<typeof setInterval> | null = null;
export function startFulfilmentWarmup(): void {
  if (warmTimer) return;
  setTimeout(() => void refresh(new Date()).catch(() => undefined), 45_000).unref?.();
  warmTimer = setInterval(() => void refresh(new Date()).catch(() => undefined), 4 * 60_000);
  warmTimer.unref?.();
}
