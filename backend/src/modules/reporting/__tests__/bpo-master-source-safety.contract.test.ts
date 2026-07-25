import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("BPO master report verified source contracts", () => {
  it("routes production execution through safe verified adapters only", () => {
    const service = source("../bpo-master-report-v2.service.ts");
    expect(service).toContain("runVerifiedWorkforceAdapter");
    expect(service).toContain("runSafeVerifiedBusinessAdapter");
    expect(service).toContain("runSafeGovernanceBpoMasterAdapter");
    expect(service).not.toContain("runWorkforceBpoMasterAdapter");
    expect(service).not.toContain("runGovernanceBpoMasterAdapter(code");
  });

  it("uses authoritative KPI and payroll source column candidates", () => {
    const workforce = source("../bpo-master-verified-workforce-adapters.ts");
    expect(workforce).toContain('["score_date", "metric_date"]');
    expect(workforce).toContain('["overall_score"]');
    expect(workforce).toContain('NET_PAY:["net_salary"]');
    expect(workforce).toContain('BASIC_PAY:["basic"]');
    expect(workforce).not.toContain("DIALS' THEN");
    expect(workforce).not.toContain('metric_date) metric_date');
  });

  it("keeps external quality data fully qualified and exact", () => {
    const business = source("../bpo-master-verified-business-adapters.ts");
    expect(business).toContain('const sourceRef = "db_audit.call_quality_assessment"');
    expect(business).toContain("professionalism_maintained");
    expect(business).toContain("active_listening");
    expect(business).toContain("quality_percentage");
  });

  it("fails closed for pre-join ATS branch scope", () => {
    const business = source("../bpo-master-verified-business-safe-adapters.ts");
    expect(business).toContain("candidate_branch");
    expect(business).toContain("UPPER(TRIM");
    expect(business).toContain("scope.branchIds");
    expect(business).toContain('where.push("1=0")');
  });

  it("retains source record evidence for audit and journey events", () => {
    const governance = source("../bpo-master-governance-safe-adapters.ts");
    expect(governance).toContain("SOURCE_RECORD_ID");
    expect(governance).toContain("JSON_VALID");
    expect(governance).toContain("ACTIVITY_DATE_TIME");
    expect(governance).toContain("DAYS_FROM_PREVIOUS_EVENT");
    expect(governance).toContain("PENDING EMPLOYEE CODE");
  });

  it("exposes live source validation before the dynamic report route", () => {
    const routes = source("../bpo-master-report.routes.ts");
    const validationIndex = routes.indexOf('/validation/source-accuracy');
    const dynamicIndex = routes.indexOf('/:code');
    expect(validationIndex).toBeGreaterThanOrEqual(0);
    expect(dynamicIndex).toBeGreaterThan(validationIndex);
    expect(routes).toContain("validateAllBpoMasterReports");
  });
});
