/**
 * PF/ESIC opt-out is Payroll HR's decision at offer creation, not the candidate's.
 *
 * ats_employment_offer.pf_opt_out existed since migration 335 ("PF opt-out tracking on the
 * offer record") but no code anywhere read or wrote it — neither offer-creation function
 * (payroll-hr.service.ts, ats.onboarding.service.ts) referenced the column. Investigated
 * 2026-08-17 after the owner clarified the real process: Payroll HR marks the opt-out when
 * drafting the offer (POST /api/ats/payroll-hr/validate, the NativePayrollHRValidation.tsx
 * page), not the candidate during onboarding — the candidate_onboarding_profile.pf_opt_out_elected
 * Form 11 path exists but is separately broken (saveStatutory() never persists it) and is
 * explicitly not the intended decision-maker.
 *
 * Migration 1228 adds the missing esic_opt_out column alongside the existing pf_opt_out. This
 * wires both into offer creation and, once the employee is created, into an approved
 * employee_statutory_override row — the table payrollCalculate.service.ts already correctly
 * reads for PF/ESIC deduction, so no change to payroll arithmetic was needed, only to what
 * feeds it.
 *
 * Source-text assertions, matching this repo's established style for this exact file
 * (payroll-hr-company.contract.test.ts) and for the orchestrator (fraudAlertGate.contract.test.ts
 * covers a different function the same way) — payroll-hr.service.ts and
 * employee-creation-orchestrator.service.ts are large, DB-heavy functions where a full
 * functional mock would be fragile relative to what it proves.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const routes = read("src/modules/ats/payroll-hr.routes.ts");
const service = read("src/modules/ats/payroll-hr.service.ts");
const orchestrator = read("src/modules/employees/employee-creation-orchestrator.service.ts");
const migration = read("sql/1228_offer_esic_opt_out.sql");
// Strip SQL comment lines before asserting on executable text — the migration's own prose
// explains what it deliberately does NOT do (ADD COLUMN IF NOT EXISTS, DROP), which would
// otherwise trip these same checks. Matches bankDetailColumns.contract.test.ts's convention.
const migrationCode = migration.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");

describe("migration 1228 adds esic_opt_out safely", () => {
  it("uses the information_schema-guarded PREPARE/EXECUTE pattern, not ADD COLUMN IF NOT EXISTS", () => {
    // ADD COLUMN IF NOT EXISTS is MariaDB syntax this MySQL 8 server rejects while still
    // recording the migration as applied (the 2026-08-13 outage pattern) — must never reappear.
    expect(migrationCode).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect(migrationCode).toMatch(/information_schema\.COLUMNS/);
    expect(migrationCode).toMatch(/PREPARE stmt FROM/);
  });

  it("adds esic_opt_out to ats_employment_offer, additive only", () => {
    expect(migrationCode).toContain("ats_employment_offer");
    expect(migrationCode).toContain("esic_opt_out");
    expect(migrationCode).not.toMatch(/DROP|DELETE/i);
  });
});

describe("payroll HR validation accepts the opt-out decision", () => {
  it("the schema accepts pf_opt_out and esic_opt_out as optional booleans", () => {
    expect(routes).toMatch(/pf_opt_out:\s*z\.boolean\(\)\.optional\(\)/);
    expect(routes).toMatch(/esic_opt_out:\s*z\.boolean\(\)\.optional\(\)/);
  });

  it("SalaryValidationInput carries both fields through to the service", () => {
    expect(service).toMatch(/pf_opt_out\?:\s*boolean/);
    expect(service).toMatch(/esic_opt_out\?:\s*boolean/);
  });

  it("the offer INSERT writes both columns, not just PF", () => {
    const insertAt = service.indexOf("INSERT INTO ats_employment_offer");
    const block = service.slice(insertAt, insertAt + 2500);
    expect(block).toMatch(/pf_opt_out,\s*esic_opt_out/);
    expect(block).toContain("pf_opt_out = VALUES(pf_opt_out)");
    expect(block).toContain("esic_opt_out = VALUES(esic_opt_out)");
  });

  it("re-submitting an offer (ON DUPLICATE KEY UPDATE) can change the opt-out decision, not just set it once", () => {
    const insertAt = service.indexOf("INSERT INTO ats_employment_offer");
    const dupAt = service.indexOf("ON DUPLICATE KEY UPDATE", insertAt);
    const updateBlock = service.slice(dupAt, dupAt + 1200);
    expect(updateBlock).toContain("pf_opt_out = VALUES(pf_opt_out)");
    expect(updateBlock).toContain("esic_opt_out = VALUES(esic_opt_out)");
  });
});

describe("employee creation transfers the offer's opt-out into an approved override", () => {
  const block = orchestrator.slice(
    orchestrator.indexOf("PF/ESIC opt-out elected by Payroll HR at offer creation"),
  );

  it("reads from the offer, not the candidate's onboarding profile", () => {
    expect(block).toContain("offer.pf_opt_out");
    expect(block).toContain("offer.esic_opt_out");
  });

  it("writes an already-approved row — no separate Payroll HO review, since Branch Head already approved the offer", () => {
    expect(block).toMatch(/INSERT IGNORE INTO employee_statutory_override/);
    expect(block).toMatch(/'approved'/);
  });

  it("covers both override types via the same ENUM the live payroll engine already reads", () => {
    expect(block).toContain("'pf_opt_out'");
    expect(block).toContain("'esic_opt_out'");
  });

  it("sets effective_from_month from the employee's actual joining date, not today", () => {
    expect(block).toMatch(/joiningDate\.getFullYear\(\)/);
    expect(block).toContain("offer.date_of_joining");
  });

  it("is idempotent — INSERT IGNORE against the same unique key the Form 11 path also relies on", () => {
    // uq_emp_override_active on (employee_id, override_type, status) — asserted once, in the
    // Form 11 block's own comment above this one; this block reuses the same guarantee.
    expect(orchestrator).toContain("uq_emp_override_active");
  });

  it("does not touch or duplicate the existing Form 11 (candidate-elected) block", () => {
    // Both blocks must coexist — the Form 11 path is not the intended decision-maker per the
    // owner, but it isn't being removed either (do not delete existing functionality).
    expect(orchestrator).toContain("candRow?.pf_opt_out_elected");
    expect(orchestrator).toContain("PF opt-out elected by employee on Form 11 during onboarding");
  });
});

describe("the Payroll HR page lets HR set both toggles", () => {
  const page = readFileSync(resolve(process.cwd(), "..", "src/pages/NativePayrollHRValidation.tsx"), "utf8");

  it("the form state and payload carry both flags", () => {
    expect(page).toMatch(/pf_opt_out:\s*boolean/);
    expect(page).toMatch(/esic_opt_out:\s*boolean/);
    // payload spreads formData wholesale, so no extra wiring is needed to post these.
    expect(page).toContain("...formData");
  });

  it("renders both checkboxes, distinctly labelled", () => {
    expect(page).toContain("Opt out of PF");
    expect(page).toContain("Opt out of ESIC");
  });

  it("states plainly that this is Payroll HR's decision, not the candidate's", () => {
    expect(page).toMatch(/Payroll HR's decision, not the candidate's/);
  });
});
