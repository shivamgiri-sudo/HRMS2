/**
 * The appointment letter's salary breakup.
 *
 * The renderer has always matched the real MAS Callnet letter (17 lines,
 * letters-render.service.ts:172-195) but could never be filled: both callers
 * queried `employee_salary_assignment ORDER BY effective_date DESC` — that
 * column is `effective_from`, so the statement threw, and every field they read
 * (basic_salary, hra, portfolio, bonus, admin_charges, ...) is absent from that
 * table regardless. Every line would have rendered "0.00".
 *
 * Verified against production:
 *   MAS60616 (db_bill migrant) legacy_payslip_snapshot:
 *     basic 17000, hra 8917, conveyance 1600, portfolio 1067, bonus 1416,
 *     gross_salary 30000, ctc_offered 30000   <- matches the printed letter
 *     gross_earned 5807, net_salary 5807      <- PRORATED, must never be used
 *   MAS62917 (HRMS hire) salary_component_assignments:
 *     basic 11500, hra 7322, conveyance 1600, gross 21380, ctc 22875
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const rows: Record<string, unknown[]> = {};
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("salary_package_master") && s.includes("JOIN")) return [rows.pkg ?? []];
      if (s.includes("salary_component_assignments")) return [rows.sca ?? []];
      if (s.includes("legacy_payslip_snapshot")) return [rows.lps ?? []];
      if (s.includes("legacy_salary_snapshot")) return [rows.lss ?? []];
      return [[]];
    }),
  },
}));

const { resolveAppointmentLetterSalary, toLetterRows, AppointmentLetterSalaryError } =
  await import("../appointmentLetterData.service.js");

beforeEach(() => { rows.pkg = []; rows.sca = []; rows.lps = []; rows.lss = []; });

describe("package is preferred and supplies every line", () => {
  it("renders bonus and admin charges, which the assignment cannot", async () => {
    rows.pkg = [{
      id: "pkg-1", basic: 7000, hra: 1558, conveyance: 1600, portfolio: 0, medical: 0,
      special_allowance: 0, other_allowance: 0, bonus: 583, pli: 0, gross: 10741,
      epf_employee: 840, esic_employee: 81, professional_tax: 0, net_in_hand: 9820,
      epf_employer: 840, esic_employer: 349, admin_charges: 70, ctc: 12000,
    }];
    const s = await resolveAppointmentLetterSalary("emp-1");
    expect(s.source).toBe("salary_package_master");
    // The two lines that are silently lost without the package link.
    expect(s.bonus).toBe(583);
    expect(s.adminCharges).toBe(70);
    expect(s.unavailableLines).toEqual([]);
    expect(toLetterRows(s).bonus).toBe("583.00");
    expect(toLetterRows(s).admin_charges).toBe("70.00");
  });
});

describe("assignment fallback (pre-package hires)", () => {
  it("uses the stored amounts and declares what it cannot supply", async () => {
    rows.sca = [{
      id: "sca-1", basic: 11500, hra: 7322, conveyance: 1600, special_allowance: 0,
      gross: 21380, ctc: 22875, net_estimate: 20000, employer_pf: 1380, employer_esi: 0,
      pf_applicable: 1, esi_applicable: 0,
    }];
    const s = await resolveAppointmentLetterSalary("emp-2");
    expect(s.source).toBe("salary_component_assignments");
    expect(s.basic).toBe(11500);
    expect(s.hra).toBe(7322);
    expect(s.gross).toBe(21380);
    expect(s.ctc).toBe(22875);
    // Honest about the six lines this table has no column for.
    expect(s.unavailableLines).toContain("Bonus");
    expect(s.unavailableLines).toContain("Admin Charges");
    expect(s.unavailableLines).toContain("Portfolio");
    expect(s.pfApplicable).toBe(true);
    expect(s.esicApplicable).toBe(false);
  });
});

describe("legacy fallback (db_bill migrants)", () => {
  it("reproduces the printed MAS60616 letter", async () => {
    rows.lps = [{
      id: 129869, employee_code: "MAS60616",
      basic: 17000, hra: 8917, conveyance: 1600, portfolio: 1067, bonus: 1416,
      medical_allowance: 0, lta: 0, special_allowance: 0, other_allowance: 0, pli: 0,
      gross_salary: 30000, ctc_offered: 30000,
      // Prorated columns that must be ignored — 6 earned days of 31.
      gross_earned: 5807, net_salary: 5807, ctc_monthly: 5807,
      epf_employee: 0, esic_employee: 0,
    }];
    rows.lss = [{ pf_eligible: "NO", esic_eligible: "NO" }];

    const s = await resolveAppointmentLetterSalary("emp-3");
    expect(s.source).toBe("legacy_payslip_snapshot");
    expect(s.basic).toBe(17000);
    expect(s.hra).toBe(8917);
    expect(s.conveyance).toBe(1600);
    expect(s.portfolio).toBe(1067);
    expect(s.bonus).toBe(1416);

    // The proration trap: the letter says 30000, the prorated columns say 5807.
    expect(s.gross).toBe(30000);
    expect(s.ctc).toBe(30000);
    expect(s.gross).not.toBe(5807);
    expect(s.netSalary).not.toBe(5807);

    // PF/ESIC exempt -> the letter's zeros are truthful, not accidental.
    expect(s.pfApplicable).toBe(false);
    expect(s.esicApplicable).toBe(false);
    expect(s.epfEmployee).toBe(0);
    expect(s.esicEmployee).toBe(0);
    expect(s.netSalary).toBe(30000);
  });

  it("renders the full 17-line letter table for MAS60616", async () => {
    rows.lps = [{
      id: 1, employee_code: "MAS60616",
      basic: 17000, hra: 8917, conveyance: 1600, portfolio: 1067, bonus: 1416,
      medical_allowance: 0, special_allowance: 0, other_allowance: 0, pli: 0,
      gross_salary: 30000, ctc_offered: 30000, epf_employee: 0, esic_employee: 0,
    }];
    rows.lss = [{ pf_eligible: "NO", esic_eligible: "NO" }];
    const r = toLetterRows(await resolveAppointmentLetterSalary("emp-3"));
    expect([
      r.basic, r.hra, r.conveyance, r.other_allowance, r.special_allowance,
      r.bonus, r.medical_allowance, r.portfolio, r.pli, r.gross_salary,
      r.esic, r.epf, r.net_salary, r.employer_esic, r.employer_epf,
      r.admin_charges, r.ctc,
    ]).toEqual([
      "17000.00", "8917.00", "1600.00", "0.00", "0.00",
      "1416.00", "0.00", "1067.00", "0.00", "30000.00",
      "0.00", "0.00", "30000.00", "0.00", "0.00",
      "0.00", "30000.00",
    ]);
  });
});

describe("never emits a letter of zeros", () => {
  it("blocks when no salary source resolves", async () => {
    await expect(resolveAppointmentLetterSalary("nobody")).rejects.toMatchObject({ code: "salary_not_assigned" });
  });

  it("blocks when the resolved row carries no amounts", async () => {
    rows.sca = [{ id: "x", basic: 0, hra: 0, gross: 0, ctc: 0 }];
    await expect(resolveAppointmentLetterSalary("emp-4")).rejects.toBeInstanceOf(AppointmentLetterSalaryError);
  });
});

describe("source pins", () => {
  const svc = fs.readFileSync(path.resolve(__dirname, "../appointmentLetterData.service.ts"), "utf8");

  it("never reads the attendance-prorated legacy columns", () => {
    const legacy = svc.slice(svc.indexOf("async function fromLegacy"), svc.indexOf("export async function resolveAppointmentLetterSalary"));
    expect(legacy).toContain("l.gross_salary");
    expect(legacy).toContain("l.ctc_offered");
    expect(legacy).not.toMatch(/l\.gross_earned/);
    expect(legacy).not.toMatch(/num\(l\.ctc_monthly\)/);
  });

  it("does not resurrect the broken employee_salary_assignment query", () => {
    // Scope past the header comment, which deliberately documents the old bug.
    const code = svc.slice(svc.indexOf("import type"));
    // The table with none of the component columns, and the column name that
    // does not exist on it. `effective_date` itself is fine — it is a real
    // column on salary_component_assignments and legacy_salary_snapshot.
    expect(code).not.toContain("employee_salary_assignment");
    expect(code).not.toContain("basic_salary");
  });
});
