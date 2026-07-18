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
    expect(migration).toContain("pnl_bucket");
    expect(migration).toContain("DATE_FORMAT(COALESCE");
  });

  it("registers the complete 415 to 417 finance sequence in automated and manual runners", () => {
    const runner = backendFile("src/db/runFinanceSupplementalMigrations.ts");
    const manualRunners = [
      backendFile("sql/000_run_finance_supplemental.sql"),
      backendFile("sql/000_finance_supplemental.sql"),
    ];
    for (const filename of [
      "415_bpo_pnl_revenue_cost_model.sql",
      "416_smart_grn_allocation_document_intelligence.sql",
      "417_budget_subhead_coverage_control.sql",
    ]) {
      expect(runner).toContain(`"${filename}"`);
      for (const manual of manualRunners) {
        expect(manual).toContain(`SOURCE sql/${filename};`);
      }
    }
  });

  it("mounts authenticated BPO reporting and configuration APIs under the finance router", () => {
    const parentRoutes = backendFile("src/modules/process-pnl/process-pnl.routes.ts");
    const routes = backendFile("src/modules/process-pnl/bpo-pnl.routes.ts");
    expect(parentRoutes).toContain('router.use("/pnl/bpo", bpoPnlRouter)');
    for (const getPath of [
      "/summary",
      "/processes/:processId",
      "/export",
      "/revenue-rules",
      "/delivery-actuals",
      "/revenue-components",
      "/cost-components",
      "/allocation-policies",
      "/classification-rules",
    ]) {
      expect(routes).toContain(`router.get("${getPath}"`);
    }
    for (const postPath of [
      "/revenue-rules",
      "/delivery-actuals",
      "/revenue-components",
      "/cost-components",
      "/allocation-policies",
      "/classification-rules",
    ]) {
      expect(routes).toContain(`"${postPath}"`);
    }
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

  it("makes classification writes operational and rejects misleading cost-centre overrides", () => {
    const configurationService = backendFile("src/modules/process-pnl/bpo-pnl.configuration.service.ts");
    expect(configurationService).toContain("PEOPLE_SCOPES");
    expect(configurationService).toContain("EXPENSE_SCOPES");
    expect(configurationService).toContain("UPDATE finance_expense_sub_head_master");
    expect(configurationService).toContain("JOIN finance_expense_head_master");
    expect(configurationService).toContain("Cost-centre P&L treatment is derived from process attribution");
  });

  it("keeps the command centre, drill-down and governed configuration workspace connected", () => {
    const summaryHook = repositoryFile("src/hooks/useBpoProcessPnl.ts");
    const detailHook = repositoryFile("src/hooks/useBpoProcessPnlDetail.ts");
    const configurationHook = repositoryFile("src/hooks/useBpoPnlConfiguration.ts");
    const page = repositoryFile("src/pages/finance/ProcessPnlPage.tsx");
    const detailPage = repositoryFile("src/pages/finance/ProcessPnlDetailPage.tsx");
    const configurationPage = repositoryFile("src/pages/finance/ProcessPnlConfigurationPage.tsx");
    expect(summaryHook).toContain("/api/finance/pnl/bpo/summary");
    expect(detailHook).toContain("/api/finance/pnl/bpo/processes/");
    expect(configurationHook).toContain("/api/finance/pnl/bpo/revenue-rules");
    expect(configurationHook).toContain("/api/finance/pnl/bpo/classification-rules");
    expect(page).toContain("Complete commercial truth from mandate and delivery to EBITDA, PBT and PAT");
    expect(page).toContain("/finance/branch-budget?period=");
    expect(detailPage).toContain("Commercial revenue statement");
    expect(detailPage).toContain("Agent / DSC / BMC");
    expect(detailPage).toContain("GRN &amp; budget");
    expect(configurationPage).toContain("Configure every commercial and cost driver");
    expect(configurationPage).toContain("Revenue additions/deductions");
    expect(configurationPage).toContain("Agent / DSC / BMC classification");
  });
});
