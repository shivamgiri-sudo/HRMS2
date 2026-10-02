import type { DashboardCode } from "../../../shared/dashboardAccessRegistry.js";
import { cacheInstance } from "../../../lib/cache/quality-cache.js";
import { logSourceFailure } from "../../../shared/apiResponse.js";
import { sharedInFlight } from "../metrics-in-flight.js";
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

/** Scope-keyed 60s cache for shared (non-per-user) dashboards; per-user ones key on userId. */
export async function cachedRoleInsights(code: DashboardCode, ctx: InsightContext, perUser: boolean): Promise<RoleInsights> {
  const key = `role-insights:v1:${code}:${ctx.scope.level}:${ctx.scope.branchIds.join(",")}:${ctx.scope.processIds.join(",")}:${ctx.scope.employeeIds.join(",")}${perUser ? `:u${ctx.userId}` : ""}`;
  return sharedInFlight(
    key,
    () => cacheInstance.getOrSet(key, () => computeRoleInsights(code, ctx) as never, 60) as unknown as Promise<Record<string, unknown>>,
  ) as unknown as Promise<RoleInsights>;
}
