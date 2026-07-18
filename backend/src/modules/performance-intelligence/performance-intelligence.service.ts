import {
  narrowDashboardScope,
  resolveDashboardScope,
  type DashboardScope,
} from "../../shared/dashboardScope.js";
import {
  type PaginatedPeople,
  type PerformanceContext,
  type PerformancePersonRow,
  type PerformanceQuery,
  type PerformanceRepository,
  type PerformanceTrendPoint,
} from "./performance-intelligence.contracts.js";
import { aggregateMetricFacts } from "./performance-intelligence.formulas.js";

type AuthContext = { userId: string };
type ResolveScope = (userId: string, role: string) => Promise<DashboardScope>;
type NarrowScope = (
  scope: DashboardScope,
  branchId?: string | null,
  processId?: string | null,
) => Promise<DashboardScope>;

export interface PerformanceIntelligenceServiceDependencies {
  repository: PerformanceRepository;
  resolveScope?: ResolveScope;
  narrowScope?: NarrowScope;
}

function forbidden(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 403 });
}

function scopeLabel(scope: DashboardScope): string {
  switch (scope.level) {
    case "ORG_ALL": return "All organisation";
    case "BRANCH_ALL": return "My branch";
    case "PROCESS_ALL": return "My process";
    case "TEAM_ONLY": return "My team";
    case "SELF_ONLY": return "My performance";
    case "CUSTOM_SCOPE": return "Selected scope";
  }
}

function canViewPeople(scope: DashboardScope): boolean {
  return scope.level !== "SELF_ONLY";
}

export function createPerformanceIntelligenceService(
  dependencies: PerformanceIntelligenceServiceDependencies,
) {
  const repository = dependencies.repository;
  const resolveScope = dependencies.resolveScope ?? resolveDashboardScope;
  const narrowScope = dependencies.narrowScope ?? narrowDashboardScope;

  async function effectiveScope(
    auth: AuthContext,
    query?: Pick<PerformanceQuery, "branchId" | "processId">,
  ): Promise<DashboardScope> {
    const resolved = await resolveScope(auth.userId, "");
    const narrowed = await narrowScope(resolved, query?.branchId, query?.processId);
    const requestedNarrowing = Boolean(query?.branchId || query?.processId);
    const deniedNarrowing =
      narrowed.level === "CUSTOM_SCOPE" &&
      narrowed.branchIds.length === 0 &&
      narrowed.processIds.length === 0;

    if (!requestedNarrowing || narrowed.level !== "CUSTOM_SCOPE" || deniedNarrowing) {
      return narrowed;
    }

    // Preserve the original restricted dimension so a cross-dimension filter
    // intersects with, rather than replaces, the caller's entitlement.
    return {
      ...narrowed,
      branchIds:
        resolved.level === "BRANCH_ALL" && !query?.branchId
          ? [...resolved.branchIds]
          : narrowed.branchIds,
      processIds:
        resolved.level === "PROCESS_ALL" && !query?.processId
          ? [...resolved.processIds]
          : narrowed.processIds,
    };
  }

  async function resolveSubject(
    auth: AuthContext,
    scope: DashboardScope,
    requestedEmployeeId?: string,
  ): Promise<string | null> {
    if (scope.level === "SELF_ONLY") {
      const selfEmployeeId = await repository.findSubjectEmployeeId(auth.userId);
      if (!selfEmployeeId) {
        throw forbidden("No active employee record is linked to this account");
      }
      if (requestedEmployeeId && requestedEmployeeId !== selfEmployeeId) {
        throw forbidden("Employee performance is outside your assigned scope");
      }
      return selfEmployeeId;
    }

    if (!requestedEmployeeId) return null;
    if (!(await repository.canAccessEmployee(scope, requestedEmployeeId))) {
      throw forbidden("Employee performance is outside your assigned scope");
    }
    return requestedEmployeeId;
  }

  return {
    async context(auth: AuthContext): Promise<PerformanceContext> {
      const scope = await effectiveScope(auth);
      const subjectEmployeeId = await repository.findSubjectEmployeeId(auth.userId);
      return {
        effectiveRole: scope.role,
        scopeLevel: scope.level,
        scopeLabel: scopeLabel(scope),
        canViewPeople: canViewPeople(scope),
        canSelectBranch: scope.level === "ORG_ALL" || scope.level === "BRANCH_ALL",
        canSelectProcess: ["ORG_ALL", "BRANCH_ALL", "PROCESS_ALL"].includes(scope.level),
        effectiveBranchIds: [...scope.branchIds],
        effectiveProcessIds: [...scope.processIds],
        subjectEmployeeId,
      };
    },

    async scorecard(auth: AuthContext, query: PerformanceQuery) {
      const scope = await effectiveScope(auth, query);
      const subjectEmployeeId = await resolveSubject(
        auth,
        scope,
        query.employeeId,
      );
      const facts = await repository.listMetricFacts(scope, query, subjectEmployeeId);
      return aggregateMetricFacts(facts);
    },

    async trends(
      auth: AuthContext,
      query: PerformanceQuery,
    ): Promise<PerformanceTrendPoint[]> {
      const scope = await effectiveScope(auth, query);
      const subjectEmployeeId = await resolveSubject(
        auth,
        scope,
        query.employeeId,
      );
      const facts = await repository.listDailyTrendFacts(scope, query, subjectEmployeeId);
      const byDate = new Map<string, typeof facts>();
      for (const fact of facts) {
        const rows = byDate.get(fact.scoreDate) ?? [];
        rows.push(fact);
        byDate.set(fact.scoreDate, rows);
      }
      return Array.from(byDate.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, rows]) => ({ date, metrics: aggregateMetricFacts(rows) }));
    },

    async people(
      auth: AuthContext,
      query: PerformanceQuery,
    ): Promise<PaginatedPeople> {
      const scope = await effectiveScope(auth, query);
      if (!canViewPeople(scope)) {
        throw forbidden("Team performance is not available for self-only scope");
      }

      const people = await repository.listPeople(scope, query);
      const employeeIds = people.rows.map((row) => row.employeeId);
      const facts = await repository.listMetricFactsForEmployees(
        scope,
        query,
        employeeIds,
      );
      const factsByEmployee = new Map<string, typeof facts>();
      for (const fact of facts) {
        const rows = factsByEmployee.get(fact.employeeId) ?? [];
        rows.push(fact);
        factsByEmployee.set(fact.employeeId, rows);
      }

      const rows: PerformancePersonRow[] = people.rows.map((person) => {
        const metrics = aggregateMetricFacts(factsByEmployee.get(person.employeeId) ?? []);
        const achievements = metrics
          .map((metric) => metric.achievementPct)
          .filter((value): value is number => value !== null);
        return {
          ...person,
          metrics,
          overallAchievementPct: achievements.length
            ? Math.round(
                (achievements.reduce((sum, value) => sum + value, 0) / achievements.length) * 100,
              ) / 100
            : null,
        };
      });

      return {
        rows,
        total: people.total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  };
}

export type PerformanceIntelligenceService = ReturnType<
  typeof createPerformanceIntelligenceService
>;
