import { empScope, rows } from "../../helpers.js";
import type { InsightContext } from "../../types.js";
import { TENURE_BUCKETS, addDays, attritionPct, int, lit, memoized, monthStart, tenureBucket } from "./shared.js";

/**
 * One narrow in-memory roster instead of eight scans of `employees`.
 *
 * employees is 59k wide rows and has no index on date_of_exit / date_of_joining, so each aggregate
 * over it costs about 3 seconds and they queue behind one another (measured 21 to 46 seconds for the
 * attrition sections). Active people are ~1k (indexed on active_status) and leavers in the last 13
 * months are ~3k, so one scan for those, kept for 5 minutes, feeds every movement / attrition figure.
 * People with no exit date at all (legacy imports) cannot be dated and are not in the roster.
 */
export interface RosterRow {
  doj: string;
  /** Exit date; null while still on the roll. */
  xd: string | null;
  branchId: string | null;
  processId: string | null;
  reason: string | null;
}

const XD = `COALESCE(e.date_of_exit, e.date_of_leaving)`;
const REAL = `e.date_of_joining IS NOT NULL AND COALESCE(e.employment_status, '') NOT IN ('preboarding', 'not_joined')`;

interface CacheEntry { at: number; data?: RosterRow[]; pending?: Promise<RosterRow[]>; refreshing?: boolean }
const CACHE = new Map<string, CacheEntry>();
const FRESH_MS = 15 * 60_000;
const MAX_STALE_MS = 2 * 3_600_000;

async function fetchRoster(ctx: InsightContext): Promise<RosterRow[]> {
  const sc = empScope(ctx);
  const from = monthStart(ctx.today, 12);
  const [active, gone] = await Promise.all([
    rows(`SELECT DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS doj, e.branch_id, e.process_id FROM employees e
           WHERE e.active_status = 1 AND e.date_of_joining IS NOT NULL${sc.sql}`, sc.params),
    rows(`SELECT DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS doj, DATE_FORMAT(${XD}, '%Y-%m-%d') AS xd, e.branch_id, e.process_id, NULLIF(TRIM(e.attrition_reason), '') AS reason
            FROM employees e WHERE e.active_status = 0 AND ${REAL} AND ${XD} >= ${lit(from)}${sc.sql}`, sc.params),
  ]);
  return [
    ...active.map((r): RosterRow => ({ doj: String(r.doj), xd: null, branchId: r.branch_id ?? null, processId: r.process_id ?? null, reason: null })),
    ...gone.map((r): RosterRow => ({ doj: String(r.doj), xd: String(r.xd), branchId: r.branch_id ?? null, processId: r.process_id ?? null, reason: r.reason ?? null })),
  ];
}

/**
 * Stale-while-revalidate: the leaver scan can take 3 to 25 seconds depending on database load, so a
 * cached roster is served at once and refreshed in the background. The first call after a restart
 * may exceed the 12s section timeout; the load keeps running and the next request is instant.
 */
export const loadRoster = memoized("roster", async (ctx: InsightContext): Promise<RosterRow[]> => {
  const s = ctx.scope;
  const key = [s.level, s.branchIds.join(","), s.processIds.join(","), s.employeeIds.join(",")].join("|");
  const hit = CACHE.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit?.data && age < MAX_STALE_MS) {
    if (age > FRESH_MS && !hit.refreshing) {
      hit.refreshing = true;
      fetchRoster(ctx).then((data) => CACHE.set(key, { at: Date.now(), data })).catch(() => { hit.refreshing = false; });
    }
    return hit.data;
  }
  if (hit?.pending) return hit.pending;
  const pending = fetchRoster(ctx).then((data) => { CACHE.set(key, { at: Date.now(), data }); return data; }).catch((err) => { CACHE.delete(key); throw err; });
  CACHE.set(key, { at: Date.now(), pending });
  return pending;
});

export const onRoll = (r: RosterRow, d: string) => r.doj <= d && (r.xd === null || r.xd > d);
export const leftIn = (r: RosterRow, from: string, to: string) => r.xd !== null && r.xd > from && r.xd <= to;
export const joinedIn = (r: RosterRow, from: string, to: string) => r.doj > from && r.doj <= to;
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

export interface Movement {
  hcNow: number; hcOpen: number; hcOpenPrev: number;
  joins: number; joinsPrev: number; exits: number; exitsPrev: number; earlyExits: number;
  attrition: number | null; attritionPrev: number | null;
}

/**
 * 30-day movement from dates on the employee record. Joins count everyone who joined in the window
 * whether or not they are still here; the summary endpoint counted only the still-active while its
 * exits included quick leavers, which understated net movement by every joiner who had already left.
 */
export function computeMovement(list: RosterRow[], today: string): Movement {
  const s1 = addDays(today, -30), s2 = addDays(today, -60);
  const count = (f: (r: RosterRow) => boolean) => list.reduce((n, r) => (f(r) ? n + 1 : n), 0);
  const m = {
    hcNow: count((r) => onRoll(r, today)), hcOpen: count((r) => onRoll(r, s1)), hcOpenPrev: count((r) => onRoll(r, s2)),
    joins: count((r) => joinedIn(r, s1, today)), joinsPrev: count((r) => joinedIn(r, s2, s1)),
    exits: count((r) => leftIn(r, s1, today)), exitsPrev: count((r) => leftIn(r, s2, s1)),
    earlyExits: count((r) => leftIn(r, s1, today) && daysBetween(r.doj, r.xd as string) < 90),
  };
  return { ...m, attrition: attritionPct(m.exits, m.hcOpen, m.hcNow), attritionPrev: attritionPct(m.exitsPrev, m.hcOpenPrev, m.hcOpen) };
}

export const movement = memoized("wf.movement", async (ctx: InsightContext) => computeMovement(await loadRoster(ctx), ctx.today));

/** Month-end headcount worked back from today's, so joins/exits and headcount are one consistent set. */
export function monthEndHeadcount(hcNow: number, months: string[], joins: Map<string, number>, exits: Map<string, number>): number[] {
  const out: number[] = new Array(months.length);
  let running = hcNow;
  for (let i = months.length - 1; i >= 0; i--) {
    out[i] = running;
    running = running - (joins.get(months[i]) ?? 0) + (exits.get(months[i]) ?? 0);
  }
  return out;
}

export function monthlyCounts(list: RosterRow[], today: string, months: string[]) {
  const first = `${months[0]}-01`;
  const joins = new Map<string, number>(), exits = new Map<string, number>();
  for (const r of list) {
    if (r.doj >= first && r.doj <= today) joins.set(r.doj.slice(0, 7), (joins.get(r.doj.slice(0, 7)) ?? 0) + 1);
    if (r.xd !== null && r.xd >= first && r.xd <= today) exits.set(r.xd.slice(0, 7), (exits.get(r.xd.slice(0, 7)) ?? 0) + 1);
  }
  return { joins, exits };
}

export function tenureDistribution(list: RosterRow[], today: string, windowDays = 90): Array<{ label: string; value: number }> {
  const from = addDays(today, -windowDays);
  const acc = new Map<string, number>(TENURE_BUCKETS.map((b) => [b, 0]));
  for (const r of list) {
    if (!leftIn(r, from, today)) continue;
    const b = tenureBucket(daysBetween(r.doj, r.xd as string));
    if (b) acc.set(b, (acc.get(b) ?? 0) + 1);
  }
  return [...acc].map(([label, value]) => ({ label, value }));
}

export interface GroupRow { id: string | null; headcount: number; joins: number; exits: number; attrition: number | null }
/** Per-branch / per-process figures. A group with nobody on the roll today has no meaningful rate (a wound-down process shows 200% on this formula), so its rate is null. */
export function groupMovement(list: RosterRow[], today: string, key: (r: RosterRow) => string | null): GroupRow[] {
  const s1 = addDays(today, -30);
  const by = new Map<string, { id: string | null; hcNow: number; hcOpen: number; joins: number; exits: number }>();
  for (const r of list) {
    const k = key(r) ?? "";
    const g = by.get(k) ?? { id: key(r), hcNow: 0, hcOpen: 0, joins: 0, exits: 0 };
    if (onRoll(r, today)) g.hcNow++;
    if (onRoll(r, s1)) g.hcOpen++;
    if (joinedIn(r, s1, today)) g.joins++;
    if (leftIn(r, s1, today)) g.exits++;
    by.set(k, g);
  }
  return [...by.values()]
    .filter((g) => g.hcNow > 0 || g.exits > 0)
    .map((g) => ({ id: g.id, headcount: g.hcNow, joins: g.joins, exits: g.exits, attrition: g.hcNow > 0 ? attritionPct(g.exits, g.hcOpen, g.hcNow) : null }))
    .sort((a, b) => b.exits - a.exits);
}

export const reasonCoverage = (list: RosterRow[], today: string, windowDays = 90) => {
  const from = addDays(today, -windowDays);
  const exits = list.filter((r) => leftIn(r, from, today));
  const counts = new Map<string, number>();
  for (const r of exits) if (r.reason) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  return { total: exits.length, withReason: [...counts.values()].reduce((a, b) => a + b, 0), top: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8) };
};

export async function nameLookup(table: "branch_master" | "process_master"): Promise<Map<string, string>> {
  const col = table === "branch_master" ? "branch_name" : "process_name";
  const r = await rows(`SELECT id, ${col} AS name FROM ${table}`);
  return new Map(r.map((x) => [String(x.id), String(x.name)]));
}
export { int };
