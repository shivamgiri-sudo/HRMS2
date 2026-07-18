import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

describe("smart GRN validation override control", () => {
  it("registers migration 419 after allocation P&L migration 418", () => {
    const sql418 = read("sql/418_grn_allocation_pnl_attribution.sql");
    const sql419 = read("sql/419_grn_validation_override_control.sql");
    const runner = read("src/db/runFinanceSupplementalMigrations.ts");
    const manual = read("sql/000_finance_supplemental.sql");
    expect(sql418).toContain("vw_process_pnl_grn_allocation");
    expect(sql419).toContain("CREATE TABLE IF NOT EXISTS grn_validation_override");
    expect(sql419).toContain("override_reason");
    expect(sql419).toContain("active_status");
    expect(sql419).not.toMatch(/DROP\s+TABLE/i);
    expect(runner.indexOf('"418_grn_allocation_pnl_attribution.sql"')).toBeLessThan(
      runner.indexOf('"419_grn_validation_override_control.sql"')
    );
    expect(manual).toContain("SOURCE sql/419_grn_validation_override_control.sql;");
  });

  it("persists, applies and revokes a specific validation exception", () => {
    const service = read("src/modules/finance/grn-validation-control.service.ts");
    expect(service).toContain("overrideValidation");
    expect(service).toContain("revokeOverride");
    expect(service).toContain("GRN_VALIDATION_OVERRIDE_APPROVED");
    expect(service).toContain("GRN_VALIDATION_OVERRIDE_REVOKED");
    expect(service).toContain("validation_status = 'overridden'");
    expect(service).toContain("is_blocking = 0");
    expect(service).toContain("at least 10 characters");
  });

  it("revalidates before smart GRN submission and approval", () => {
    const service = read("src/modules/finance/grn-validation-control.service.ts");
    const routes = read("src/modules/finance/grn-smart.routes.ts");
    expect(service).toContain("effectiveValidation(grnId)");
    expect(service).toContain("Resolve or obtain Finance override");
    expect(service).toContain("Approval blocked by");
    expect(routes).toContain("grnValidationControlService.submit");
    expect(routes).toContain("grnValidationControlService.review");
    expect(routes).toContain('"/:id/validations/:validationCode/override"');
    expect(routes).toContain('"/:id/validations/:validationCode/revoke"');
    expect(routes).toContain("SMART_OVERRIDE_ROLES");
  });
});
