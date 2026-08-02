import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { DashboardScope } from "../../../shared/dashboardScope.js";
import { buildDatasetScopeFilter } from "../performance-governance.service.js";

function scope(
  level: DashboardScope["level"],
  overrides: Partial<DashboardScope> = {},
): DashboardScope {
  return {
    level,
    branchIds: [],
    processIds: [],
    employeeIds: [],
    userId: "user-1",
    role: "admin",
    ...overrides,
  };
}

describe("performance ingestion dataset scope", () => {
  it("allows organisation-wide roles to see all configured sources", () => {
    expect(buildDatasetScopeFilter(scope("ORG_ALL"))).toEqual({
      sql: "1 = 1",
      params: [],
    });
  });

  it("limits process roles to their assigned process ids", () => {
    const filter = buildDatasetScopeFilter(scope("PROCESS_ALL", {
      processIds: ["process-1", "process-2"],
    }));

    expect(filter.sql).toContain("psd.process_id IN (?, ?)");
    expect(filter.params).toEqual(["process-1", "process-2"]);
  });

  it("limits branch roles to direct branch sources or active processes inside their branches", () => {
    const filter = buildDatasetScopeFilter(scope("BRANCH_ALL", {
      branchIds: ["branch-1"],
    }));

    expect(filter.sql).toContain("psd.branch_id IN (?)");
    expect(filter.sql).toContain("SELECT DISTINCT e.process_id");
    expect(filter.params).toEqual(["branch-1", "branch-1"]);
  });

  it("fails closed for self-only and team-only scopes", () => {
    expect(buildDatasetScopeFilter(scope("SELF_ONLY")).sql).toBe("1 = 0");
    expect(buildDatasetScopeFilter(scope("TEAM_ONLY")).sql).toBe("1 = 0");
  });
});

describe("performance ingestion governance route contract", () => {
  const routePath = path.resolve(__dirname, "../performance-ingestion.routes.ts");
  const routeCode = fs.readFileSync(routePath, "utf8");

  it("requires effective-dated approval and backend write access", () => {
    expect(routeCode).toContain("effectiveFrom");
    expect(routeCode).toMatch(/router\.post\(\s*"\/datasets\/:id\/approve",\s*requireWriteAccess/);
    expect(routeCode).toContain("performanceGovernanceService.approveDataset");
  });

  it("exposes scoped run history and mapping exception resolution", () => {
    expect(routeCode).toContain('"/datasets/:id/runs"');
    expect(routeCode).toContain('"/mapping-exceptions/:id/resolve"');
    expect(routeCode).toContain("performanceGovernanceService.runDetail");
    expect(routeCode).toContain("performanceGovernanceService.resolveMappingException");
  });

  it("guards every ingestion mutation with requireWriteAccess", () => {
    const protectedRoutePatterns = [
      /router\.post\(\s*"\/datasets",\s*requireWriteAccess/,
      /router\.patch\(\s*"\/datasets\/:id\/status",\s*requireWriteAccess/,
      /router\.post\(\s*"\/datasets\/:id\/approve",\s*requireWriteAccess/,
      /router\.post\(\s*"\/identity-maps",\s*requireWriteAccess/,
      /router\.post\(\s*"\/process-maps",\s*requireWriteAccess/,
      /router\.post\(\s*"\/mapping-exceptions\/:id\/resolve",\s*requireWriteAccess/,
    ];

    for (const pattern of protectedRoutePatterns) {
      expect(routeCode).toMatch(pattern);
    }
    expect(routeCode).toContain("function runRoute");
    expect(routeCode).toMatch(/function runRoute[\s\S]*requireWriteAccess/);
  });
});

describe("performance final governance controls", () => {
  const routeCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-ingestion.routes.ts"),
    "utf8",
  );
  const guardCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-dataset-mutation.guard.ts"),
    "utf8",
  );
  const auditCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-governance-audit.middleware.ts"),
    "utf8",
  );
  const auditRouteCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-governance-audit.routes.ts"),
    "utf8",
  );
  const auditServiceCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-governance-audit.service.ts"),
    "utf8",
  );

  it("keeps dataset keys immutable and exceptional publication controls admin-only", () => {
    expect(guardCode).toContain("PERFORMANCE_DATASET_KEY_IMMUTABLE");
    expect(guardCode).toContain("PERFORMANCE_EXCEPTIONAL_CONTROL_ADMIN_ONLY");
    expect(guardCode).toContain("allowPartialPublication");
    expect(guardCode).toContain("allowEmptyPublication");
  });

  it("audits successful governance mutations with redaction", () => {
    expect(routeCode).toContain("performanceGovernanceAuditMiddleware");
    expect(auditCode).toContain("performance_governance_audit");
    expect(auditCode).toContain("[REDACTED]");
    expect(auditCode).toContain("resolveDatasetId");
  });

  it("scopes dataset-specific audit history, and keeps org-level actions visible", () => {
    expect(auditRouteCode).toContain('"/governance-audit"');
    expect(auditRouteCode).toContain("requireRole(...readers)");
    expect(auditServiceCode).toContain("resolveDashboardScope");
    expect(auditServiceCode).toContain("buildDatasetScopeFilter");

    // This asserted `pga.dataset_id IS NOT NULL`, and the service does the
    // opposite: `(pga.dataset_id IS NULL OR (scoped))`. The service is right.
    //
    // dataset_id is nullable by design (582_performance_governance_audit.sql).
    // The rows carrying NULL are the org-level ones — identity_mapping,
    // process_mapping, mapping_exception — which have no dataset to be scoped
    // BY. Requiring IS NOT NULL would not tighten anything; it would hide every
    // identity- and process-mapping change from the audit log entirely, which is
    // the opposite of what an audit log is for.
    //
    // The scoping that matters is still asserted above: dataset-specific rows go
    // through buildDatasetScopeFilter, and the endpoint is limited to
    // super_admin, admin, hr, process_manager, qa_manager and quality_lead.
    // BOTH queries against performance_governance_audit must carry the gate: the
    // history listing and the distinct-action-code lookup. Asserting merely that
    // the clause appears somewhere is not enough — with two call sites, removing
    // one still leaves the other to satisfy a `toContain`, and the assertion
    // passes while half the endpoint returns unscoped rows. Verified by removing
    // one gate and watching this fail.
    const gates = auditServiceCode.match(/pga\.dataset_id IS NULL OR \(\$\{scoped\.sql\}\)/g) ?? [];
    expect(gates).toHaveLength(2);
  });
});
