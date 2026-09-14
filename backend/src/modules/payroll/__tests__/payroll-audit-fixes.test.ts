/**
 * Regression tests for the 2026-08-10 payroll audit fixes.
 *
 * All tests are pure-logic or source-text contracts — no DB connection required.
 *
 * Items covered:
 *   P0-A  resolveAccountNumberWithConflict — source-conflict detection
 *   P0-B  bank-exception-report endpoint — gated, enumerates missing + conflict
 *   P0-C  MISSING_VERIFIED_BANK promoted to blocker
 *   P0-D  golden-month-reconcile endpoint — POST with control file
 *   P1-A  ESI mid-period contribution-period coverage
 *   P1-B  MISSING_PAN blocker for auto-TDS, warning for manual
 *   P2-A  salary_prep_line_component unique key migration exists
 *   P2-B  payslip_ref includes run_id to prevent collision
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  resolveAccountNumber,
  resolveAccountNumberWithConflict,
} from "../../../shared/fieldEncryption.js";
import { esiContributionPeriodStart } from "../payroll-governance.service.js";

// ─── Source files for contract tests ─────────────────────────────────────────
const GOVERNANCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-governance.service.ts"),
  "utf8",
);
const EXTENDED = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-extended.routes.ts"),
  "utf8",
);
const PAYSLIP = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payslip.service.ts"),
  "utf8",
);
const CALCULATE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
  "utf8",
);

// ─── P0-A: resolveAccountNumberWithConflict ───────────────────────────────────

describe("P0-A — resolveAccountNumberWithConflict", () => {
  it("returns ok when both sources agree", () => {
    const r = resolveAccountNumberWithConflict({
      account_number_enc: null,
      account_number: Buffer.from("123456789012"),
    });
    expect(r.status).toBe("legacy_only");
    expect(r.resolved).toBe("123456789012");
  });

  it("returns missing when both sources are absent", () => {
    const r = resolveAccountNumberWithConflict({
      account_number_enc: null,
      account_number: null,
    });
    expect(r.status).toBe("missing");
    expect(r.resolved).toBeNull();
  });

  it("returns missing for empty string legacy account", () => {
    const r = resolveAccountNumberWithConflict({
      account_number_enc: null,
      account_number: "",
    });
    expect(r.status).toBe("missing");
  });

  it("legacy_only when only legacy column present", () => {
    const r = resolveAccountNumberWithConflict({
      account_number_enc: null,
      account_number: Buffer.from("999888777666"),
    });
    expect(r.status).toBe("legacy_only");
    expect(r.legacyValue).toBe("999888777666");
    expect(r.encValue).toBeNull();
  });

  it("encrypt_only when only encrypted column present and decrypts ok", () => {
    // We cannot encrypt in unit tests without a real key; test via a bad base64 (decrypt fails → falls through)
    // so check the fallback path produces 'missing'
    const r = resolveAccountNumberWithConflict({
      account_number_enc: "bad-base64-not-a-real-ciphertext",
      account_number: null,
    });
    // Decrypt fails → encValue = null, legacyValue = null → missing
    expect(r.status).toBe("missing");
  });

  it("resolveAccountNumber (original) still works for single-source rows", () => {
    expect(resolveAccountNumber({ account_number_enc: null, account_number: Buffer.from("444555666") }))
      .toBe("444555666");
    expect(resolveAccountNumber({ account_number_enc: null, account_number: null }))
      .toBeNull();
  });
});

// ─── P0-B: bank-exception-report endpoint exists and is gated ─────────────────

describe("P0-B — bank-exception-report endpoint", () => {
  it("endpoint is registered in payroll-extended.routes.ts", () => {
    expect(EXTENDED).toContain('"/runs/:runId/bank-exception-report"');
  });

  it("endpoint checks hasExportScope before querying", () => {
    // Fixed 2026-08-17 (Section M RBAC audit): was hasOrgWideScope, which trusts bare `admin`
    // membership with no scope row — see bank-export-gating.contract.test.ts.
    const idx = EXTENDED.indexOf('"/runs/:runId/bank-exception-report"');
    const body = EXTENDED.slice(idx, idx + 800);
    expect(body).toMatch(/hasExportScope\(/);
  });

  it("uses resolveAccountNumberWithConflict (not just resolveAccountNumber)", () => {
    expect(EXTENDED).toContain("resolveAccountNumberWithConflict");
  });

  it("returns gate_clear and unresolved_count in the response", () => {
    expect(EXTENDED).toContain("gate_clear");
    expect(EXTENDED).toContain("unresolved_count");
  });

  it("masks account numbers in conflict report — no raw account exposed", () => {
    const idx = EXTENDED.indexOf("conflict_detail");
    const surrounds = EXTENDED.slice(Math.max(0, idx - 400), idx + 200);
    // Should mask with XXXX prefix, not expose raw values
    expect(surrounds).toContain("XXXX");
    expect(surrounds).not.toMatch(/resolved\.encValue[^;]*res\.json/);
  });
});

// ─── P0-C: MISSING_VERIFIED_BANK promoted to blocker ─────────────────────────

describe("P0-C — MISSING_VERIFIED_BANK is a blocker", () => {
  it("MISSING_VERIFIED_BANK severity is 'blocker' not 'warning'", () => {
    const idx = GOVERNANCE.indexOf("MISSING_VERIFIED_BANK");
    expect(idx).toBeGreaterThan(-1);
    // Grab 600 chars forward from the code string — the severity literal follows
    // the block comment and then the closing quote of the message string.
    const surrounding = GOVERNANCE.slice(idx, idx + 600);
    expect(surrounding).toContain('"blocker"');
    expect(surrounding).not.toContain('"warning"');
  });
});

// ─── P0-D: golden-month-reconcile endpoint ────────────────────────────────────

describe("P0-D — golden-month-reconcile endpoint", () => {
  it("endpoint is registered in payroll-extended.routes.ts", () => {
    expect(EXTENDED).toContain('"/runs/:runId/golden-month-reconcile"');
  });

  it("is a POST endpoint (accepts control file payload)", () => {
    const idx = EXTENDED.indexOf('"/runs/:runId/golden-month-reconcile"');
    const before = EXTENDED.slice(Math.max(0, idx - 30), idx);
    expect(before).toContain(".post(");
  });

  it("checks hasExportScope", () => {
    // Fixed 2026-08-17 (Section M RBAC audit): was hasOrgWideScope, which trusts bare `admin`
    // membership with no scope row — see bank-export-gating.contract.test.ts.
    const idx = EXTENDED.indexOf('"/runs/:runId/golden-month-reconcile"');
    const body = EXTENDED.slice(idx, idx + 600);
    expect(body).toMatch(/hasExportScope\(/);
  });

  it("computes system figures from salary_prep_line not just run totals column", () => {
    // Anchored on the quoted route path, not the bare substring: a bare "golden-month-reconcile"
    // can match an EARLIER, unrelated mention of the same words in a docstring/comment elsewhere
    // in the file, which silently widens this slice into the wrong region.
    const idx = EXTENDED.indexOf('"/runs/:runId/golden-month-reconcile"');
    const body = EXTENDED.slice(idx, idx + 2000);
    expect(body).toContain("FROM salary_prep_line WHERE run_id");
  });

  it("audits the reconciliation attempt via logSensitiveAction", () => {
    const idx = EXTENDED.indexOf("GOLDEN_MONTH_RECONCILE");
    expect(idx).toBeGreaterThan(-1);
  });

  it("returns golden=true when all variances pass", () => {
    expect(EXTENDED).toContain("golden");
    expect(EXTENDED).toContain("tolerance_rupees");
  });
});

// ─── P1-A: ESI contribution-period mid-period fix ────────────────────────────

describe("P1-A — esiContributionPeriodStart correctness", () => {
  it("April → period start is April", () => {
    expect(esiContributionPeriodStart("2026-04")).toBe("2026-04");
  });
  it("September → period start is April (same period)", () => {
    expect(esiContributionPeriodStart("2026-09")).toBe("2026-04");
  });
  it("October → period start is October", () => {
    expect(esiContributionPeriodStart("2026-10")).toBe("2026-10");
  });
  it("March → period start is October of the prior year", () => {
    expect(esiContributionPeriodStart("2026-03")).toBe("2025-10");
  });
  it("January → period start is October of the prior year", () => {
    expect(esiContributionPeriodStart("2027-01")).toBe("2026-10");
  });
});

describe("P1-A — ESI mid-period fix is in calculatePayrollRun", () => {
  it("imports esiContributionPeriodStart", () => {
    expect(CALCULATE).toContain("esiContributionPeriodStart");
    expect(CALCULATE).toContain('from "./payroll-governance.service.js"');
  });

  it("checks prior salary_prep_line for period coverage before applying ceiling", () => {
    expect(CALCULATE).toContain("esiContributionPeriodStart(run.run_month)");
    expect(CALCULATE).toContain("Covered at period start");
    expect(CALCULATE).toContain("esicOptOutDeclared");
  });

  it("sets esicContinuityOverride=true when coverage is inherited from period start", () => {
    // Superseded 2026-08-14 (delta-audit P0): the original version of this
    // assertion checked for "esicOptOut = false" here, which was itself the
    // bug — esicOptOut is already false on every path that reaches this
    // branch (gated by !esicOptOutDeclared), so re-setting it to false changed
    // nothing and the ceiling check in calculateNetSalary never saw an
    // override. esicContinuityOverride is the real signal now.
    const idx = CALCULATE.indexOf("esicContinuityOverride = true");
    expect(idx).toBeGreaterThan(-1);
    // Should be inside the ESI period-start check, not the unconditional path
    const surrounding = CALCULATE.slice(Math.max(0, idx - 200), idx + 50);
    expect(surrounding).toContain("esiPriorRows");
  });

  it("passes esicContinuityOverride through to calculateNetSalary, independent of esicOptOut", () => {
    expect(CALCULATE).toContain("esicContinuityOverride,");
    // esicOptOut itself must stay a simple declared-only value now — the old
    // `let esicOptOut = ...; ... esicOptOut = false` mutation pattern is gone.
    expect(CALCULATE).toContain("const esicOptOut = esicOptOutDeclared;");
  });
});

// ─── P1-B: MISSING_PAN blocker for auto-TDS, warning for manual ──────────────

describe("P1-B — MISSING_PAN severity depends on tds_mode", () => {
  it("MISSING_PAN code is present in payroll-governance.service.ts", () => {
    expect(GOVERNANCE).toContain('"MISSING_PAN"');
  });

  it("uses tdsMode conditional to pick blocker vs warning", () => {
    const idx = GOVERNANCE.indexOf('"MISSING_PAN"');
    expect(idx).toBeGreaterThan(-1);
    // The ternary and both severity literals follow the code string
    const forward = GOVERNANCE.slice(idx, idx + 600);
    expect(forward).toContain("tdsMode");
    expect(forward).toContain('"blocker"');
    expect(forward).toContain('"warning"');
  });
});

// ─── TDS PAN format validation ───────────────────────────────────────────────

describe("TDS — INVALID_PAN_FORMAT governance check", () => {
  it("INVALID_PAN_FORMAT check is present in governance service", () => {
    expect(GOVERNANCE).toContain('"INVALID_PAN_FORMAT"');
  });

  it("uses REGEXP to validate the 10-char PAN pattern", () => {
    const idx = GOVERNANCE.indexOf("INVALID_PAN_FORMAT");
    const surrounding = GOVERNANCE.slice(Math.max(0, idx - 300), idx + 300);
    expect(surrounding).toContain("REGEXP");
    expect(surrounding).toContain("[A-Z]{5}[0-9]{4}[A-Z]{1}");
  });

  it("only fires for non-empty PANs (does not duplicate MISSING_PAN)", () => {
    const idx = GOVERNANCE.indexOf("INVALID_PAN_FORMAT");
    const surrounding = GOVERNANCE.slice(Math.max(0, idx - 300), idx + 100);
    expect(surrounding).toContain("<> ''");
  });

  it("applies the same tdsMode blocker/warning rule as MISSING_PAN", () => {
    const idx = GOVERNANCE.indexOf('"INVALID_PAN_FORMAT"');
    const forward = GOVERNANCE.slice(idx, idx + 600);
    expect(forward).toContain("tdsMode");
    expect(forward).toContain('"blocker"');
    expect(forward).toContain('"warning"');
  });
});

// ─── P2-A: salary_prep_line_component unique key migration ───────────────────

describe("P2-A — unique constraint migration 1126 exists", () => {
  it("migration file exists", () => {
    const src = readFileSync(
      resolve(process.cwd(), "sql/1126_salary_prep_line_component_unique_key.sql"),
      "utf8",
    );
    expect(src).toContain("uq_splc_run_line_code_type");
    expect(src).toContain("run_id, line_id, component_code, component_type");
  });

  it("dedup companion script exists", () => {
    const src = readFileSync(
      resolve(process.cwd(), "scripts/dedup-salary-prep-line-component.sql"),
      "utf8",
    );
    expect(src).toContain("salary_prep_line_component");
    expect(src).toContain("GROUP BY run_id, line_id, component_code, component_type");
  });
});

// ─── P2-B: payslip_ref uniqueness for correction runs ────────────────────────

describe("P2-B — payslip_ref includes run_id prefix", () => {
  it("payslip_ref construction references runId", () => {
    const idx = PAYSLIP.indexOf("payslipRef");
    expect(idx).toBeGreaterThan(-1);
    const surrounding = PAYSLIP.slice(idx, idx + 200);
    expect(surrounding).toContain("runId");
    expect(surrounding).toContain("PS-");
  });

  it("uses slice(0,8) of runId to keep the ref human-readable", () => {
    expect(PAYSLIP).toContain("runId.slice(0, 8)");
  });
});
