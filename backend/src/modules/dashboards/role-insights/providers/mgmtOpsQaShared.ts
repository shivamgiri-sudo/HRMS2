import { logSourceFailure } from "../../../../shared/apiResponse.js";
import { resolvePeriod, type OpsCtx } from "../../../operations/ops-command.context.js";
import { loadView, type DimView } from "../../../operations/ops-command.dim.js";
import type { InsightAction, InsightContext } from "../types.js";

/**
 * Helpers shared by the Manager, Operations and Quality providers. Pure except `guarded`/`memoFor`.
 */

/** A pending request older than this many days counts as past its response window. */
export const QUEUE_SLA_DAYS = 3;

/** Whole days between two YYYY-MM-DD dates (later - earlier); null when either is missing/invalid. */
export function dayDiff(later: string | null | undefined, earlier: string | null | undefined): number | null {
  if (!later || !earlier) return null;
  const a = Date.parse(`${String(later).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(earlier).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Severity of a queue: anything past its window is at least "high"; three or more is "critical". */
export function queueSeverity(count: number | null, overdue: number | null): InsightAction["severity"] {
  if (count === null || count <= 0) return "info";
  const o = overdue ?? 0;
  if (o >= 3) return "critical";
  if (o > 0) return "high";
  return "normal";
}

/** True when the scope is person-keyed but resolved to nobody (e.g. a manager whose hierarchy maps no one). */
export function scopeIsEmptyTeam(ctx: InsightContext): boolean {
  const l = ctx.scope.level;
  return (l === "TEAM_ONLY" || l === "SELF_ONLY") && (ctx.scope.employeeIds?.length ?? 0) === 0;
}

export const NO_TEAM_REASON = "No reporting hierarchy is mapped to this account, so there is no team to measure.";

export interface QueueInput {
  id: string;
  label: string;
  href: string;
  group?: string;
  hint?: string;
  count: number | null;
  oldestDays?: number | null;
  overdue?: number | null;
  unavailable?: string | null;
}

export function toAction(q: QueueInput): InsightAction {
  return {
    id: q.id,
    label: q.label,
    href: q.href,
    group: q.group,
    hint: q.hint,
    count: q.count,
    oldestDays: q.count === null ? null : q.oldestDays ?? null,
    overdue: q.count === null ? null : q.overdue ?? 0,
    severity: queueSeverity(q.count, q.overdue ?? null),
    unavailable: q.unavailable ?? null,
  };
}

/** Runs one query-backed value; a failure becomes `{ error }` (logged) instead of rejecting the whole section. */
export async function guarded<T>(site: string, fn: () => Promise<T>): Promise<{ value: T; error: null } | { value: null; error: string }> {
  try {
    return { value: await fn(), error: null };
  } catch (err) {
    logSourceFailure("role-insights", err, { site });
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const memoStore = new WeakMap<InsightContext, Map<string, Promise<unknown>>>();

/** Shares one in-flight/finished computation between sections of the same request (ctx identity). */
export function memoFor<T>(ctx: InsightContext, key: string, fn: () => Promise<T>): Promise<T> {
  let m = memoStore.get(ctx);
  if (!m) { m = new Map(); memoStore.set(ctx, m); }
  const hit = m.get(key);
  if (hit) return hit as Promise<T>;
  const p = fn();
  m.set(key, p);
  return p;
}

/** Percentage-point delta between two percents, 1dp; null when either side is unknown. */
export function deltaPoints(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 10) / 10;
}

export function mean(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function round1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}

/** `Tue 07 Oct` style label from a YYYY-MM-DD. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd} ${String(d.getUTCDate()).padStart(2, "0")} ${mon}`;
}

/** Operations-Command context for this request (same scope, latest complete attendance date, 30-day window). */
export function opsCtxFor(ctx: InsightContext, days = 30): Promise<OpsCtx> {
  return memoFor(ctx, `opsctx|${days}`, async () => {
    const period = await resolvePeriod(undefined, undefined);
    const from = days === 30 ? period.from : addDaysIso(period.to, -(days - 1));
    return {
      scope: ctx.scope, attThrough: period.attThrough, today: period.today,
      f: { from, to: period.to, branchId: ctx.branchId, processId: ctx.processId },
    };
  });
}

/** Scoped employee view (row scope enforced in SQL by loadView), shared across sections of one request. */
export function opsViewFor(ctx: InsightContext): Promise<{ ops: OpsCtx; view: DimView }> {
  return memoFor(ctx, "opsview", async () => {
    const ops = await opsCtxFor(ctx);
    return { ops, view: await loadView(ops) };
  });
}
