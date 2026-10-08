import type { DashboardCode } from "../../../shared/dashboardAccessRegistry.js";
import { logSourceFailure } from "../../../shared/apiResponse.js";
import type {
  InsightContext,
  InsightProvider,
  InsightSection,
  RoleInsights,
} from "./types.js";

export type { RoleInsights, InsightContext } from "./types.js";

/**
 * Providers are registered here, one file per dashboard under ./providers.
 * A dashboard with no provider answers with empty sections (never an error).
 */
const PROVIDERS: Partial<Record<DashboardCode, () => Promise<{ default: InsightProvider }>>> = {
  SUPER_ADMIN_DASHBOARD: () => import("./providers/superAdmin.js"),
  CEO_DASHBOARD: () => import("./providers/ceo.js"),
  HR_DASHBOARD: () => import("./providers/hr.js"),
  WFM_DASHBOARD: () => import("./providers/wfm.js"),
  WFM_ATTENDANCE_DASHBOARD: () => import("./providers/wfmAttendance.js"),
  PAYROLL_HR_DASHBOARD: () => import("./providers/payroll.js"),
  QUALITY_DASHBOARD: () => import("./providers/quality.js"),
  OPERATIONS_DASHBOARD: () => import("./providers/operations.js"),
  RECRUITER_DASHBOARD: () => import("./providers/recruiter.js"),
  IT_MANAGER_DASHBOARD: () => import("./providers/itManager.js"),
  MANAGEMENT_DASHBOARD: () => import("./providers/manager.js"),
  EMPLOYEE_SELF_DASHBOARD: () => import("./providers/employee.js"),
};

const SECTION_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${SECTION_TIMEOUT_MS}ms`)), SECTION_TIMEOUT_MS);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export function registerInsightProvider(code: DashboardCode, loader: () => Promise<{ default: InsightProvider }>) {
  PROVIDERS[code] = loader;
}

export async function computeRoleInsights(code: DashboardCode, ctx: InsightContext): Promise<RoleInsights> {
  const out: RoleInsights = {
    dashboardCode: code,
    generatedAt: new Date().toISOString(),
    scopeLevel: ctx.scope.level,
    healthScore: null,
    healthBasis: null,
    actions: [],
    kpis: [],
    series: [],
    tables: [],
    signals: [],
    sectionErrors: {},
  };
  const loader = PROVIDERS[code];
  if (!loader) return out;
  const provider = (await loader()).default;

  const settled = await Promise.all(
    Object.entries(provider.sections).map(async ([name, fn]): Promise<[string, InsightSection | Error]> => {
      try {
        return [name, await withTimeout(fn(ctx), `${code}.${name}`)];
      } catch (err) {
        logSourceFailure("role-insights", err, { code, section: name });
        return [name, err instanceof Error ? err : new Error(String(err))];
      }
    }),
  );

  for (const [name, result] of settled) {
    if (result instanceof Error) { out.sectionErrors[name] = result.message; continue; }
    out.actions.push(...(result.actions ?? []));
    out.kpis.push(...(result.kpis ?? []));
    out.series.push(...(result.series ?? []));
    out.tables.push(...(result.tables ?? []));
    out.signals.push(...(result.signals ?? []));
    if (result.healthScore !== undefined) { out.healthScore = result.healthScore; out.healthBasis = result.healthBasis ?? null; }
  }
  return out;
}

// ── Progressive, stale-while-revalidate delivery ──────────────────────────────────────────────
//
// A dashboard's sections have very different costs (a cold HR/Operations load measured 8-12s while
// most sections finish in well under 2s). Waiting for the slowest one made every dashboard as slow
// as its worst query, and the old 12s cutoff then dropped that data entirely. Instead:
//   * all sections start at once and each stores its own result as it finishes;
//   * a request waits at most FIRST_PAINT_BUDGET_MS, then answers with what is ready plus `pending`
//     (the client polls and merges the rest);
//   * a finished result is served instantly for FRESH_MS, and for STALE_MS after that it is served
//     immediately while one background refresh runs — so repeat visits never wait.
const FIRST_PAINT_BUDGET_MS = 2_500;
const FRESH_MS = 60_000;
const STALE_MS = 30 * 60_000;
const SECTION_HARD_TIMEOUT_MS = 60_000;
const MAX_ENTRIES = 200;

interface Entry {
  code: DashboardCode;
  scopeLevel: RoleInsights["scopeLevel"];
  sections: Map<string, InsightSection | Error>;
  names: string[];
  pending: Set<string>;
  done: Promise<void>;
  startedAt: number;
  completedAt: number | null;
}

const entries = new Map<string, Entry>();
const refreshing = new Set<string>();

function startEntry(code: DashboardCode, ctx: InsightContext, provider: InsightProvider): Entry {
  const names = Object.keys(provider.sections);
  const entry: Entry = {
    code, scopeLevel: ctx.scope.level, sections: new Map(), names, pending: new Set(names), done: Promise.resolve(),
    startedAt: Date.now(), completedAt: null,
  };
  const runs = names.map(async (name) => {
    try {
      const result = await new Promise<InsightSection>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${code}.${name} timed out after ${SECTION_HARD_TIMEOUT_MS}ms`)), SECTION_HARD_TIMEOUT_MS);
        provider.sections[name](ctx).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
      });
      entry.sections.set(name, result);
    } catch (err) {
      logSourceFailure("role-insights", err, { code, section: name });
      entry.sections.set(name, err instanceof Error ? err : new Error(String(err)));
    } finally {
      entry.pending.delete(name);
    }
  });
  entry.done = Promise.all(runs).then(() => { entry.completedAt = Date.now(); });
  return entry;
}

function assemble(entry: Entry, stale: boolean): RoleInsights {
  const out: RoleInsights = {
    dashboardCode: entry.code, generatedAt: new Date(entry.completedAt ?? Date.now()).toISOString(), scopeLevel: entry.scopeLevel,
    healthScore: null, healthBasis: null, actions: [], kpis: [], series: [], tables: [], signals: [], sectionErrors: {},
    pending: entry.names.filter((n) => entry.pending.has(n)), stale,
  };
  // Stable provider order so tiles don't reshuffle as late sections arrive.
  for (const name of entry.names) {
    const result = entry.sections.get(name);
    if (!result) continue;
    if (result instanceof Error) { out.sectionErrors[name] = result.message; continue; }
    out.actions.push(...(result.actions ?? []));
    out.kpis.push(...(result.kpis ?? []));
    out.series.push(...(result.series ?? []));
    out.tables.push(...(result.tables ?? []));
    out.signals.push(...(result.signals ?? []));
    if (result.healthScore !== undefined) { out.healthScore = result.healthScore; out.healthBasis = result.healthBasis ?? null; }
  }
  return out;
}

function evict() {
  if (entries.size <= MAX_ENTRIES) return;
  const oldest = [...entries.entries()].sort((a, b) => (a[1].completedAt ?? a[1].startedAt) - (b[1].completedAt ?? b[1].startedAt)).slice(0, entries.size - MAX_ENTRIES);
  for (const [k] of oldest) entries.delete(k);
}

export function insightsCacheKey(code: DashboardCode, ctx: InsightContext, perUser: boolean): string {
  return `role-insights:v2:${code}:${ctx.scope.level}:${ctx.scope.branchIds.join(",")}:${ctx.scope.processIds.join(",")}:${ctx.scope.employeeIds.join(",")}${perUser ? `:u${ctx.userId}` : ""}:f${ctx.canSeeFinance ? 1 : 0}`;
}

export async function cachedRoleInsights(code: DashboardCode, ctx: InsightContext, perUser: boolean): Promise<RoleInsights> {
  const loader = PROVIDERS[code];
  if (!loader) return computeRoleInsights(code, ctx);
  const key = insightsCacheKey(code, ctx, perUser);
  const now = Date.now();
  let entry = entries.get(key);

  if (entry && entry.completedAt !== null) {
    const age = now - entry.completedAt;
    if (age <= FRESH_MS) return assemble(entry, false);
    if (age <= STALE_MS) {
      // Serve what we have now; recompute once in the background and swap it in when finished.
      if (!refreshing.has(key)) {
        refreshing.add(key);
        void loader().then(({ default: provider }) => {
          const next = startEntry(code, ctx, provider);
          return next.done.then(() => {
            // A section that failed this time keeps its previous good result instead of blanking a tile.
            for (const [name, result] of next.sections) {
              const previous = entry!.sections.get(name);
              if (result instanceof Error && previous && !(previous instanceof Error)) next.sections.set(name, previous);
            }
            entries.set(key, next);
          });
        }).catch((err) => logSourceFailure("role-insights", err, { code, phase: "refresh" })).finally(() => refreshing.delete(key));
      }
      return assemble(entry, true);
    }
    entries.delete(key);
    entry = undefined;
  }

  if (!entry) {
    const { default: provider } = await loader();
    entry = startEntry(code, ctx, provider);
    entries.set(key, entry);
    evict();
  }
  // First paint: wait briefly for the fast sections, never for the slowest.
  await Promise.race([entry.done, new Promise<void>((r) => setTimeout(r, FIRST_PAINT_BUDGET_MS))]);
  return assemble(entry, false);
}

/** Boot-time warm-up of the org-wide entries, sequential and spaced so it never competes with users. */
export async function warmRoleInsights(codes: DashboardCode[], opts: { canSeeFinance: boolean; spacingMs?: number } = { canSeeFinance: true }): Promise<void> {
  for (const code of codes) {
    const ctx: InsightContext = {
      scope: { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId: "warmup", role: "super_admin" },
      userId: "warmup", roleKeys: ["super_admin"], canSeeFinance: opts.canSeeFinance, today: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
    };
    try {
      const loader = PROVIDERS[code];
      if (!loader) continue;
      const key = insightsCacheKey(code, ctx, false);
      if (entries.has(key)) continue;
      const entry = startEntry(code, ctx, (await loader()).default);
      entries.set(key, entry);
      await entry.done;
    } catch (err) {
      logSourceFailure("role-insights", err, { code, phase: "warmup" });
    }
    await new Promise((r) => setTimeout(r, opts.spacingMs ?? 5_000));
  }
}
