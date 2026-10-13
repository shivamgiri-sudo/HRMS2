/**
 * Branch hiring plan facts: open seats per branch (130% join target), each branch's conversion history from the recruiter ledger,
 * its observed walk-in pace and spend over the last 30 days, and booked-not-yet-arrived candidates. Maths is in he-branch-plan.ts.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { FILL_BUFFER, joinTarget, joinsLeft } from "../../shared/requisition-fill.js";
import { getCostByBranch } from "./he-cost-branch.service.js";
import {
  buildBranchPlan, type BranchBooked, type BranchHistory, type BranchPace, type BranchPlan, type BranchPlanOverrides, type BranchSeats,
} from "./he-branch-plan.js";

const PACE_DAYS = 30;
const IST_NOW = "DATE_ADD(NOW(), INTERVAL 330 MINUTE)";
const n = (v: unknown) => Number(v ?? 0);

export interface BranchPlanRequest extends BranchPlanOverrides { months?: number | null; deadline?: string | null }
export interface BranchPlanResponse extends BranchPlan {
  asOf: string; historyMonths: number; paceDays: number; joinBufferPct: number; deadlineDays: number | null;
  costNote: string;
}

async function seats(): Promise<BranchSeats[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name, requested_headcount, fulfilled_headcount, joined_headcount
       FROM job_requisition
      WHERE active_status = 1 AND approval_status = 'approved' AND branch_name IS NOT NULL AND branch_name <> '' AND requested_headcount > 0`);
  const by = new Map<string, BranchSeats>();
  for (const r of rows) {
    const b = String(r.branch_name);
    const requested = n(r.requested_headcount), joined = n(r.joined_headcount), fulfilled = n(r.fulfilled_headcount);
    const left = joinsLeft(requested, joined);
    if (left === 0) continue; // filled requisitions do not count toward what is still needed
    const s = by.get(b) ?? { branch: b, requisitions: 0, requested: 0, target: 0, joined: 0, pendingSelected: 0, joinsLeft: 0 };
    s.requisitions += 1; s.requested += requested; s.target += joinTarget(requested); s.joined += joined; s.joinsLeft += left;
    s.pendingSelected += Math.max(0, Math.min(fulfilled, requested) - joined);
    by.set(b, s);
  }
  return [...by.values()];
}

async function history(months: number): Promise<BranchHistory[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name AS branch, COUNT(DISTINCT mobile10) AS uniqueLeads,
            COUNT(DISTINCT CASE WHEN walkin_flag OR final_selection_flag OR joined_flag THEN mobile10 END) AS walkins,
            COUNT(DISTINCT CASE WHEN final_selection_flag OR joined_flag THEN mobile10 END) AS selected,
            COUNT(DISTINCT CASE WHEN joined_flag THEN mobile10 END) AS joined
       FROM ats_recruiter_hiring_activity
      WHERE activity_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH) AND branch_name IS NOT NULL AND branch_name <> ''
      GROUP BY branch_name`, [months]);
  return rows.map((r) => ({ branch: String(r.branch), uniqueLeads: n(r.uniqueLeads), walkins: n(r.walkins), selected: n(r.selected), joined: n(r.joined) }));
}

/**
 * Walk-in pace per branch over the last PACE_DAYS: the larger of (a) the recruiter ledger's walk-in flags and (b) distinct candidates
 * issued a queue token at the branch (a token is what a real arrival gets, the same test the Meta recruitment count uses for "walked in").
 * The ledger alone showed 0.1-0.5 walk-ins a day on prod (it is filled in by hand), which turned the plan into "54,000 days".
 */
async function pace(): Promise<BranchPace[]> {
  const [ledger] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name AS branch,
            COUNT(DISTINCT CASE WHEN walkin_flag OR final_selection_flag OR joined_flag THEN mobile10 END) AS walkins,
            COUNT(DISTINCT CASE WHEN joined_flag THEN mobile10 END) AS joined
       FROM ats_recruiter_hiring_activity
      WHERE activity_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND branch_name IS NOT NULL AND branch_name <> ''
      GROUP BY branch_name`, [PACE_DAYS]);
  const [tokens] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name AS branch, COUNT(DISTINCT candidate_id) AS walkins FROM ats_queue_token
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND branch_name IS NOT NULL AND branch_name <> '' GROUP BY branch_name`, [PACE_DAYS])
    .catch(() => [[]] as unknown as [RowDataPacket[]]);
  const by = new Map<string, BranchPace>();
  const key = (b: unknown) => String(b).trim().toLowerCase();
  for (const r of ledger) by.set(key(r.branch), { branch: String(r.branch).trim(), walkinsInWindow: n(r.walkins), joinedInWindow: n(r.joined), windowDays: PACE_DAYS });
  for (const r of tokens as RowDataPacket[]) {
    const k = key(r.branch), cur = by.get(k);
    if (cur) cur.walkinsInWindow = Math.max(cur.walkinsInWindow, n(r.walkins));
    else by.set(k, { branch: String(r.branch).trim(), walkinsInWindow: n(r.walkins), joinedInWindow: 0, windowDays: PACE_DAYS });
  }
  return [...by.values()];
}

async function booked(): Promise<BranchBooked[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT jr.branch_name AS branch, SUM(m.state = 'invited') AS invited, SUM(m.state = 'confirmed') AS confirmed
       FROM he_match m JOIN job_requisition jr ON jr.id = m.requisition_id
      WHERE m.state IN ('invited','confirmed') AND m.slot_at >= ${IST_NOW} AND jr.branch_name IS NOT NULL
      GROUP BY jr.branch_name`);
  return rows.map((r) => ({ branch: String(r.branch), invited: n(r.invited), confirmed: n(r.confirmed) }));
}

interface PlanInputs { today: string; seats: BranchSeats[]; history: BranchHistory[]; pace: BranchPace[]; booked: BranchBooked[]; spendByBranch: Record<string, number> }
// The inputs scan the recruiter ledger and every branch's cost usage: seconds on production, and they move slowly. Cached for 20 minutes
// per history window with single-flight, so a visit (and every what-if change, which only re-runs the pure maths) is instant after the first.
// 20 minutes, against the 14-minute warm-up in he-planner.service.ts, so the cache never lapses between refreshes.
const INPUT_TTL_MS = 20 * 60_000;
/** Engine cost usage is the slowest input (its messages query times out on production) and the least material: it never holds the plan up. */
const COST_WAIT_MS = 8_000;
const inputCache = new Map<number, { at: number; value: Promise<PlanInputs> }>();

async function loadInputs(months: number): Promise<PlanInputs> {
  const hit = inputCache.get(months);
  if (hit && Date.now() - hit.at < INPUT_TTL_MS) return hit.value;
  const value = (async (): Promise<PlanInputs> => {
    const [d] = await db.execute<RowDataPacket[]>(`SELECT DATE(${IST_NOW}) AS today, DATE_SUB(DATE(${IST_NOW}), INTERVAL ${PACE_DAYS - 1} DAY) AS start`);
    const today = String(d[0].today).slice(0, 10), start = String(d[0].start).slice(0, 10);
    const costP = Promise.race([
      getCostByBranch(start, today).catch(() => null),
      new Promise<null>((resolve) => { const t = setTimeout(() => resolve(null), COST_WAIT_MS); t.unref?.(); }),
    ]);
    const [seatRows, history_, pace_, booked_, cost] = await Promise.all([seats(), history(months), pace(), booked(), costP]);
    return { today, seats: seatRows, history: history_, pace: pace_, booked: booked_, spendByBranch: cost ? Object.fromEntries(cost.rows.map((r) => [r.branch, r.total])) : {} };
  })();
  inputCache.set(months, { at: Date.now(), value });
  value.catch(() => inputCache.delete(months));
  if (inputCache.size > 6) inputCache.delete(inputCache.keys().next().value as number);
  return value;
}

export async function planBranches(q: BranchPlanRequest = {}): Promise<BranchPlanResponse> {
  const months = Math.min(24, Math.max(1, Math.floor(q.months ?? 6)));
  const inputs = await loadInputs(months);
  const { today } = inputs;
  const deadlineDays = q.deadline && /^\d{4}-\d{2}-\d{2}$/.test(q.deadline)
    ? Math.max(0, Math.ceil((Date.parse(`${q.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)) : null;
  const plan = buildBranchPlan({ today, seats: inputs.seats, history: inputs.history, pace: inputs.pace, booked: inputs.booked, spendByBranch: inputs.spendByBranch, overrides: q, deadlineDays });
  return {
    ...plan, asOf: today, historyMonths: months, paceDays: PACE_DAYS, joinBufferPct: Math.round((FILL_BUFFER - 1) * 100), deadlineDays,
    costNote: "Without a cost-per-walk-in input, cost is ENGINE spend only: the last 30 days of Meta ad spend that is synced, WhatsApp, bot calls and e-mail at the owner's rates, divided by walk-ins. It excludes recruiter pay, venue, referral and incentive cost, so it understates what a walk-in really costs. Enter an all-in cost per walk-in to plan with a real figure.",
  };
}

/** Warm the default window so the first person to open the Planner does not wait. */
export async function warmBranchPlan(): Promise<void> {
  try { await loadInputs(6); } catch { /* the plan still works cold */ }
}
