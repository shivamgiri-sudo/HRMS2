import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(resolve(process.cwd(), "src/modules/it-provisioning/it-provisioning.routes.ts"), "utf8");
const service = readFileSync(resolve(process.cwd(), "src/modules/it-provisioning/it-provisioning.service.ts"), "utf8");
const retryJob = readFileSync(resolve(process.cwd(), "src/jobs/provisioning-retry.job.ts"), "utf8");

describe("IT provisioning dashboard scope", () => {
  it("resolves functional queues through canonical dashboard scope", () => {
    expect(routes).toContain("resolveDashboardScope");
    expect(routes).toContain("narrowDashboardScope");
    expect(routes).toContain("filters.branchIds = scoped.branchIds");
    expect(routes).toContain("router.get('/stats'");
    expect(routes).toContain("getProvisioningStats");
  });

  it("supports all assigned branches instead of one caller-controlled branch", () => {
    expect(service).toContain("branchIds?: string[]");
    expect(service).toContain("e.branch_id IN");
  });
});

// commit 53e5ee96 (2026-08-06) loosened provisioning-retry.job.ts's eligibility
// query (JOIN -> LEFT JOIN, 7 -> 30 day window) to stop skipping direct-created
// employees, but active_status = 0 also covers long-exited legacy
// (db_bill-migrated) employees, and legacy-sync re-runs re-touch created_at —
// so exited legacy staff got freshly matched and had IT provisioning tasks
// auto-created for them. legacy_emp_id IS NULL must stay on all three call
// sites: the retry job's eligibility query, the list/stats display queries
// (defense-in-depth against rows already created), and the manual redispatch
// endpoint.
describe("IT provisioning — legacy employee exclusion", () => {
  it("excludes legacy_emp_id employees from the retry job's eligibility query", () => {
    expect(retryJob).toContain("e.legacy_emp_id IS NULL");
  });

  it("excludes legacy_emp_id employees from listProvisioningRequests and getProvisioningStats", () => {
    const listFn = service.slice(
      service.indexOf("export async function listProvisioningRequests"),
      service.indexOf("export async function getProvisioningStats")
    );
    expect(listFn).toContain("e.legacy_emp_id IS NULL");
    const statsFn = service.slice(service.indexOf("export async function getProvisioningStats"));
    expect(statsFn).toContain("e.legacy_emp_id IS NULL");
  });

  it("refuses to redispatch provisioning for a legacy employee", () => {
    const redispatchRoute = routes.slice(routes.indexOf("router.post('/redispatch/:employeeId'"));
    expect(redispatchRoute).toContain("emp.legacy_emp_id");
  });
});
