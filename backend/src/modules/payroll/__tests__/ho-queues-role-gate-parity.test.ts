/**
 * Repeat silent-403 pattern (2026-08-25, Phase 2 of the payroll audit fix plan).
 *
 * Across ~14 payroll pages, a role was granted page-level access (role_page_access) or shown
 * a control in the frontend, then silently 403'd on the actual backend requireRole() call —
 * rendering identically to a genuinely empty/healthy queue rather than an error. This asserts
 * the specific fixes for that pattern land and don't regress, following this repo's existing
 * convention of asserting against router source text (see neft-export-total-integrity.test.ts,
 * recalc-validation-status-notnull.test.ts) rather than a full request-mock per route — the
 * fix here is purely which roles are accepted, not new logic.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MODULE_DIR = resolve(import.meta.dirname, "..");

function read(file: string): string {
  return readFileSync(resolve(MODULE_DIR, file), "utf8");
}

describe("salary-verification.routes.ts — admin/payroll_branch parity with the frontend page grant", () => {
  const src = read("salary-verification.routes.ts");

  it("GET /processes, /employees, /summary accept admin and payroll_branch", () => {
    const matches = [...src.matchAll(/requireRole\("wfm", "process_manager", "branch_head", "payroll_head", "super_admin", "payroll", "admin", "payroll_branch"\)/g)];
    expect(matches.length).toBe(4);
  });

  it("POST /verify-bulk accepts payroll_head and super_admin, matching canBulkVerify", () => {
    expect(src).toMatch(/"\/verify-bulk"[\s\S]{0,300}requireRole\("wfm", "process_manager", "branch_head", "payroll_head", "super_admin"\)/);
  });

  it("GET /export accepts admin and payroll_branch", () => {
    expect(src).toMatch(/"\/export"[\s\S]{0,300}requireRole\("wfm", "process_manager", "branch_head", "payroll_head", "super_admin", "admin", "payroll_branch"\)/);
  });
});

describe("payroll-lines.compat.routes.ts — payroll_head reaches the line-editing table it's designed for", () => {
  it("GET /runs/:id/lines (the route that actually serves, shadowing payroll.routes.ts) accepts payroll_head/super_admin/finance_head", () => {
    const src = read("payroll-lines.compat.routes.ts");
    expect(src).toMatch(/requireRole\("admin", "hr", "finance", "payroll", "payroll_head", "super_admin", "finance_head"\)/);
  });
});

describe("payroll-window.routes.ts — TDS mode, window status, salary history parity", () => {
  const src = read("payroll-window.routes.ts");

  it("PATCH /runs/:id/tds-mode accepts payroll_head and finance, matching the GET on the same resource", () => {
    expect(src).toMatch(/'\/runs\/:id\/tds-mode'[\s\S]{0,40}requireRole\('payroll', 'super_admin', 'payroll_head', 'finance'\)/);
  });

  it("GET /runs/:id/window-status accepts admin and payroll_head", () => {
    expect(src).toMatch(/requireRole\('payroll', 'super_admin', 'finance', 'hr', 'admin', 'payroll_head'\)/);
  });

  it("GET /employee-salary-history accepts admin, hr, payroll_head", () => {
    expect(src).toMatch(/requireRole\('payroll', 'super_admin', 'finance', 'admin', 'hr', 'payroll_head'\)/);
  });
});

describe("payroll-extended.routes.ts — salary-sheet-export parity", () => {
  it("both salary-sheet-export paths accept payroll_head, finance_head, payroll_admin", () => {
    const src = read("payroll-extended.routes.ts");
    const matches = [...src.matchAll(/requireRole\("admin", "finance", "payroll", "hr", "payroll_head", "finance_head", "payroll_admin"\)/g)];
    expect(matches.length).toBe(2);
  });
});

describe("payroll-more.routes.ts — Holiday Work admits wfm, matching HolidayWork.tsx's own role lists", () => {
  const src = read("payroll-more.routes.ts");

  it("GET /holiday-work/requests accepts wfm", () => {
    expect(src).toMatch(/"\/holiday-work\/requests"[\s\S]{0,60}requireRole\("admin", "super_admin", "finance", "payroll", "payroll_head", "payroll_branch", "wfm"\)/);
  });

  it("POST /holiday-work/requests accepts wfm", () => {
    expect(src).toMatch(/"\/holiday-work\/requests"[\s\S]{0,60}requireRole\("admin", "super_admin", "payroll", "payroll_head", "wfm"\)/);
  });

  it("PATCH /holiday-work/requests/:id/approve accepts wfm", () => {
    expect(src).toMatch(/"\/holiday-work\/requests\/:id\/approve"[\s\S]{0,60}requireRole\("admin", "super_admin", "payroll", "payroll_head", "wfm"\)/);
  });

  it("does NOT add wfm to the unrelated holiday-master cc/designation-mapping routes", () => {
    const unrelated = [...src.matchAll(/requireRole\("admin", "super_admin", "payroll", "payroll_head"\)/g)];
    expect(unrelated.length).toBe(2); // cc-mapping + designation-mapping, untouched by this fix
  });
});

describe("payroll-statutory-override.routes.ts / cheque-validation.routes.ts — read-only widen, write stays restricted", () => {
  it("PF opt-out GET /all accepts admin, hr, payroll_head", () => {
    const src = read("payroll-statutory-override.routes.ts");
    expect(src).toMatch(/requireRole\('payroll', 'super_admin', 'finance', 'admin', 'hr', 'payroll_head'\)/);
  });

  it("PF opt-out PATCH /:id/approve is untouched — still payroll/super_admin only", () => {
    const src = read("payroll-statutory-override.routes.ts");
    expect(src).toMatch(/'\/:id\/approve'[\s\S]{0,40}requireRole\('payroll', 'super_admin'\)/);
  });

  it("cheque-validation GET /queue accepts admin, hr, payroll_head", () => {
    const src = read("cheque-validation.routes.ts");
    expect(src).toMatch(/requireRole\('payroll', 'super_admin', 'finance', 'admin', 'hr', 'payroll_head'\)/);
  });

  it("cheque-validation PATCH /:id is untouched — still payroll/super_admin only", () => {
    const src = read("cheque-validation.routes.ts");
    expect(src).toMatch(/'\/:id'[\s\S]{0,40}requireRole\('payroll', 'super_admin'\)/);
  });
});
