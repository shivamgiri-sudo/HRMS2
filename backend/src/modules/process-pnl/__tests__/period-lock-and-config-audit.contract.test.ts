import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("finance_period lock — GRN cannot silently move a closed period's numbers", () => {
  it("isPeriodLocked reads status by period_code alone, matching canonical-pnl's own lock check", () => {
    const helper = read("src/modules/process-pnl/finance-period-lock.ts");
    expect(helper).toContain("SELECT status FROM finance_period WHERE period_code = ?");
    expect(helper).toContain('=== "locked"');
  });

  it("blocks a GRN whose budget line's period is locked, in both the standard and smart GRN paths", () => {
    const grn = read("src/modules/finance/grn.service.ts");
    const grnSmart = read("src/modules/finance/grn-smart.service.ts");
    expect(grn).toContain("isPeriodLocked(budgetLine.period_code)");
    expect(grn).toContain("is locked for P&L close");
    expect(grnSmart).toContain("isPeriodLocked(line.period_code)");
    expect(grnSmart).toContain("is locked for P&L close");
  });
});

describe("P&L live read paths surface lock status instead of drifting silently", () => {
  it("summary, process detail and export all report isPeriodLocked", () => {
    const routes = read("src/modules/process-pnl/bpo-pnl.routes.ts");
    const getCount = (routes.match(/isPeriodLocked\(scoped\.period\)/g) ?? []).length;
    expect(getCount).toBe(3);
    expect(routes).toContain("isPeriodLocked: periodLocked");
    expect(routes).toContain('res.setHeader("X-Period-Locked"');
  });
});

describe("P&L configuration changes are now audited (before/after, who/when)", () => {
  it("all five bpo-pnl.service.ts config saves write an audit entry with a before/after diff", () => {
    const service = read("src/modules/process-pnl/bpo-pnl.service.ts");
    expect(service).toContain("async function readExistingConfigRow");
    expect(service).toContain("async function auditConfigSave");
    for (const action of [
      "revenue_rule_saved",
      "delivery_actual_saved",
      "revenue_component_saved",
      "cost_component_saved",
      "allocation_policy_saved",
    ]) {
      expect(service).toContain(`"${action}"`);
    }
    // Every save must read the prior row before writing, not just log the new payload.
    // (6 total occurrences: 1 function definition + 5 call sites.)
    const readCount = (service.match(/readExistingConfigRow\(/g) ?? []).length;
    expect(readCount).toBe(6);
  });

  it("saveClassificationRule (the sixth config save, in the configuration service) is also audited", () => {
    const config = read("src/modules/process-pnl/bpo-pnl.configuration.service.ts");
    expect(config).toContain("writeAuditLog");
    expect(config).toContain("classification_rule_saved");
    expect(config).toContain("SELECT * FROM pnl_cost_classification_rule WHERE id = ?");
  });
});
