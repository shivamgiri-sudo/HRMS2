import { describe, expect, it, vi } from "vitest";
import type { DashboardScope } from "../../../shared/dashboardScope.js";
import type {
  PerformanceQuery,
  PerformanceRepository,
} from "../performance-intelligence.contracts.js";
import { createPerformanceIntelligenceService } from "../performance-intelligence.service.js";

function query(overrides: Partial<PerformanceQuery> = {}): PerformanceQuery {
  return {
    from: "2026-07-01",
    to: "2026-07-18",
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

function scope(level: DashboardScope["level"], role: string): DashboardScope {
  return {
    level,
    role,
    userId: `${role}-user`,
    branchIds: [],
    processIds: [],
  };
}

function repository(): PerformanceRepository {
  return {
    findSubjectEmployeeId: vi.fn().mockResolvedValue("self-employee"),
    canAccessEmployee: vi.fn().mockResolvedValue(true),
    listMetricFacts: vi.fn().mockResolvedValue([]),
    listDailyTrendFacts: vi.fn().mockResolvedValue([]),
    listPeople: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    listMetricFactsForEmployees: vi.fn().mockResolvedValue([]),
  };
}

describe("performance intelligence scope enforcement", () => {
  it("rejects an employee outside the server-resolved employee set", async () => {
    const repo = repository();
    vi.mocked(repo.canAccessEmployee).mockResolvedValueOnce(false);
    const service = createPerformanceIntelligenceService({
      repository: repo,
      resolveScope: vi.fn().mockResolvedValue(scope("TEAM_ONLY", "team_leader")),
      narrowScope: vi.fn(async (resolved) => resolved),
    });

    await expect(service.scorecard(
      { userId: "tl-user" },
      query({ employeeId: "other-employee" }),
    )).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.listMetricFacts).not.toHaveBeenCalled();
  });

  it("does not let a team leader widen to a process", async () => {
    const repo = repository();
    const service = createPerformanceIntelligenceService({
      repository: repo,
      resolveScope: vi.fn().mockResolvedValue(scope("TEAM_ONLY", "team_leader")),
      narrowScope: vi.fn(async (resolved) => resolved),
    });

    const result = await service.context({ userId: "tl-user" });

    expect(result.scopeLevel).toBe("TEAM_ONLY");
    expect(result.canSelectProcess).toBe(false);
    expect(result.canViewPeople).toBe(true);
  });

  it("preserves process entitlement when narrowing a process manager by branch", async () => {
    const repo = repository();
    const processScope: DashboardScope = {
      ...scope("PROCESS_ALL", "process_manager"),
      processIds: ["process-1"],
      branchIds: ["branch-1"],
    };
    const service = createPerformanceIntelligenceService({
      repository: repo,
      resolveScope: vi.fn().mockResolvedValue(processScope),
      narrowScope: vi.fn().mockResolvedValue({
        ...processScope,
        level: "CUSTOM_SCOPE",
        branchIds: ["branch-1"],
        processIds: [],
      }),
    });

    await service.scorecard(
      { userId: "pm-user" },
      query({ branchId: "branch-1" }),
    );

    expect(repo.listMetricFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "CUSTOM_SCOPE",
        branchIds: ["branch-1"],
        processIds: ["process-1"],
      }),
      expect.any(Object),
      null,
    );
  });

  it("fails closed when no employee record maps to a self-only user", async () => {
    const repo = repository();
    vi.mocked(repo.findSubjectEmployeeId).mockResolvedValueOnce(null);
    const service = createPerformanceIntelligenceService({
      repository: repo,
      resolveScope: vi.fn().mockResolvedValue(scope("SELF_ONLY", "employee")),
      narrowScope: vi.fn(async (resolved) => resolved),
    });

    await expect(service.scorecard(
      { userId: "employee-user" },
      query(),
    )).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.listMetricFacts).not.toHaveBeenCalled();
  });

  it("forces a self-only request to the authenticated employee", async () => {
    const repo = repository();
    const service = createPerformanceIntelligenceService({
      repository: repo,
      resolveScope: vi.fn().mockResolvedValue(scope("SELF_ONLY", "employee")),
      narrowScope: vi.fn(async (resolved) => resolved),
    });

    await service.scorecard({ userId: "employee-user" }, query());

    expect(repo.listMetricFacts).toHaveBeenCalledWith(
      expect.objectContaining({ level: "SELF_ONLY" }),
      expect.any(Object),
      "self-employee",
    );
  });

  it("rejects people ranking for self-only users", async () => {
    const repo = repository();
    const service = createPerformanceIntelligenceService({
      repository: repo,
      resolveScope: vi.fn().mockResolvedValue(scope("SELF_ONLY", "employee")),
      narrowScope: vi.fn(async (resolved) => resolved),
    });

    await expect(service.people(
      { userId: "employee-user" },
      query(),
    )).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.listPeople).not.toHaveBeenCalled();
  });
});
