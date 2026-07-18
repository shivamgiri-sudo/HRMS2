import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");

function backendFile(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

function repositoryFile(relativePath: string) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

describe("BPO Process P&L schema and API contract", () => {
  it("defines all supported BPO commercial models", () => {
    const migration = backendFile("sql/415_bpo_pnl_revenue_cost_model.sql");
    for (const model of [
      "per_seat",
      "per_fte",
      "per_productive_hour",
      "per_login_hour",
      "per_talk_minute",
      "per_transaction",
      "per_mandate",
      "per_case",
      "fixed_monthly",
      "outcome_based",
    ]) {
      expect(migration).toContain(`'${model}'`);
    }
    expect(migration).toContain("monthly_minimum_commitment");
    expect(migration).toContain("included_units");
    expect(migration).toContain("overage_rate");
    expect(migration).toContain("quality_gate_pct");
    expect(migration).toContain("sla_gate_pct");
  });

  it("stores delivery, revenue adjustments, cost classification and allocation policy", () => {
    const migration = backendFile("sql/415_bpo_pnl_revenue_cost_model.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS process_delivery_actual");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS process_revenue_component");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS process_pnl_cost_component");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS pnl_cost_classification_rule");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS pnl_allocation_policy");
    expect(migration).toContain("agent_salary");
    expect(migration).toContain("dsc_people");
    expect(migration).toContain("dsc_non_people");
    expect(migration).toContain("bmc_people");
    expect(migration).toContain("bmc_non_people");
  });

  it("recognizes GRN and vendor expense by P&L period rather than payment timing", () => {
    const migration = backendFile("sql/415_bpo_pnl_revenue_cost_model.sql");
    expect(migration).toContain("recognition_period");
    expect(migration).toContain("pnl_cost_amount");
    expect(migration).toContain("recoverable_tax");
    expect(migration).toContain("pnl_bucket");
  });

  it("registers migration 415 in automated and manual finance runners", () => {
    const runner = backendFile("src/db/runFinanceSupplementalMigrations.ts");
    const manual = backendFile("sql/000_run_finance_supplemental.sql");
    expect(runner).toContain('"415_bpo_pnl_revenue_cost_model.sql"');
    expect(manual).toContain("SOURCE sql/415_bpo_pnl_revenue_cost_model.sql;");
  });

  it("mounts authenticated BPO P&L APIs under the finance router", () => {
    const parentRoutes = backendFile("src/modules/process-pnl/process-pnl.routes.ts");
    const routes = backendFile("src/modules/process-pnl/bpo-pnl.routes.ts");
    expect(parentRoutes).toContain('router.use("/pnl/bpo", bpoPnlRouter)');
    expect(routes).toContain('router.get("/summary"');
    expect(routes).toContain('router.get("/processes/:processId"');
    expect(routes).toContain('router.get("/export"');
    expect(routes).toContain('router.post(\n  "/revenue-rules"');
    expect(routes).toContain('router.post(\n  "/delivery-actuals"');
    expect(routes).toContain("requireWriteAccess");
    expect(routes).toContain("requireRole(...WRITE_ROLES)");
  });

  it("uses the actual HRMS department schema for payroll classification", () => {
    const service = backendFile("src/modules/process-pnl/bpo-pnl.service.ts");
    expect(service).toContain('departmentColumns.has("dept_name")');
    expect(service).toContain('"dep.dept_name"');
    expect(service).toContain('bucket === "agent_salary"');
    expect(service).toContain('bucket === "dsc_people"');
    expect(service).toContain('bucket === "bmc_people"');
  });

  it("keeps the command centre and process drill-down connected to BPO APIs", () => {
    const hook = repositoryFile("src/hooks/useBpoProcessPnl.ts");
    const detailHook = repositoryFile("src/hooks/useBpoProcessPnlDetail.ts");
    const page = repositoryFile("src/pages/finance/ProcessPnlPage.tsx");
    const detailPage = repositoryFile("src/pages/finance/ProcessPnlDetailPage.tsx");
    expect(hook).toContain("/api/finance/pnl/bpo/summary");
    expect(detailHook).toContain("/api/finance/pnl/bpo/processes/");
    expect(page).toContain("Complete commercial truth from mandate and delivery to EBITDA, PBT and PAT");
    expect(page).toContain("/finance/branch-budget?period=");
    expect(detailPage).toContain("Commercial revenue statement");
    expect(detailPage).toContain("Agent / DSC / BMC");
    expect(detailPage).toContain("GRN &amp; budget");
  });
});
