/**
 * The appointment letter's salary breakup.
 *
 * ONE admissible source: the package the Payroll Head approved, reached through
 * employee_payroll_head_review (status='approved', package_accepted=1) ->
 * salary_package_id -> salary_package_master.
 *
 * These tests exist because the previous chain — approved package -> ANY active
 * salary_component_assignments row -> legacy_payslip_snapshot — never consulted
 * the Payroll Head at all. Measured live on 2026-09-08: 264 active non-legacy
 * employees held an active assignment row with no approved review, 23 of them
 * still pending_review and one REJECTED. Each would have had that salary
 * digitally signed and emailed to them as their agreed remuneration.
 *
 * So the pins below are not stylistic. "Refuses a pending review" and "refuses a
 * rejected review" are the whole point of the module, and "never reads
 * legacy_payslip_snapshot" guards the fallback from growing back.
 *
 * Verified against production 2026-09-08:
 *   48 reviews at status='approved', all 48 with package_accepted=1,
 *   47 of 48 with a matching salary_component_assignments.package_id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const rows: Record<string, unknown[]> = {};
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      // The approved-package read is the only query that joins the package
      // catalog; the diagnosis read is the only one selecting rejection_remarks.
      if (s.includes("employee_payroll_head_review") && s.includes("JOIN salary_package_master")) {
        return [rows.approved ?? []];
      }
      if (s.includes("employee_payroll_head_review") && s.includes("rejection_remarks")) {
        return [rows.review ?? []];
      }
      return [[]];
    }),
  },
}));

const { resolveAppointmentLetterSalary, toLetterRows, letterSalaryRowsOrBlank, AppointmentLetterSalaryError } =
  await import("../appointmentLetterData.service.js");

/** A complete approved package, as salary_package_master actually stores one. */
const APPROVED_PACKAGE = {
  id: "pkg-1", basic: 7000, hra: 1558, lta: 0, conveyance: 1600, portfolio: 0,
  medical: 0, special_allowance: 0, other_allowance: 0, bonus: 583, pli: 0,
  gross: 10741, epf_employee: 840, esic_employee: 81, professional_tax: 0,
  net_in_hand: 9820, epf_employer: 840, esic_employer: 349, admin_charges: 70,
  ctc: 12000, pf_applicable: 1, esi_applicable: 1,
  package_effective_from: "2026-08-01", reviewed_by: "user-ph", reviewed_at: "2026-08-05T10:00:00Z",
};

beforeEach(() => { rows.approved = []; rows.review = []; });

describe("the Payroll-Head-approved package is the source", () => {
  it("supplies every line, including the ones only the package carries", async () => {
    rows.approved = [APPROVED_PACKAGE];
    const s = await resolveAppointmentLetterSalary("emp-1");

    expect(s.source).toBe("payroll_head_approved_package");
    expect(s.sourceRef).toBe("pkg-1");
    // bonus and admin_charges exist on no other source; losing the package link
    // used to silently zero both.
    expect(s.bonus).toBe(583);
    expect(s.adminCharges).toBe(70);
    expect(s.gross).toBe(10741);
    expect(s.netSalary).toBe(9820);
    expect(s.unavailableLines).toEqual([]);
    expect(toLetterRows(s).bonus).toBe("583.00");
    expect(toLetterRows(s).admin_charges).toBe("70.00");
  });

  it("records who approved it and when, so the letter is auditable", async () => {
    rows.approved = [APPROVED_PACKAGE];
    const s = await resolveAppointmentLetterSalary("emp-1");
    expect(s.approvedBy).toBe("user-ph");
    expect(s.approvedAt?.toISOString().slice(0, 10)).toBe("2026-08-05");
    expect(s.packageEffectiveFrom?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("renders the full 17-line letter table", async () => {
    rows.approved = [APPROVED_PACKAGE];
    const r = toLetterRows(await resolveAppointmentLetterSalary("emp-1"));
    for (const k of [
      "basic", "hra", "lta", "conveyance", "other_allowance", "special_allowance",
      "bonus", "medical_allowance", "portfolio", "pli", "gross_salary", "esic",
      "epf", "net_salary", "employer_esic", "employer_epf", "admin_charges", "ctc",
    ]) {
      expect(r[k], `missing letter row: ${k}`).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

describe("an unapproved salary never reaches a letter", () => {
  it("refuses when the employee has no Payroll Head review at all", async () => {
    await expect(resolveAppointmentLetterSalary("emp-x"))
      .rejects.toMatchObject({ code: "salary_not_reviewed" });
  });

  it("refuses a review still pending, and says so", async () => {
    rows.review = [{ status: "pending_review", package_accepted: 0, salary_package_id: null }];
    await expect(resolveAppointmentLetterSalary("emp-x"))
      .rejects.toMatchObject({ code: "salary_not_approved" });
  });

  it("refuses a REJECTED review and quotes the remarks", async () => {
    rows.review = [{
      status: "rejected", package_accepted: 0, salary_package_id: null,
      rejection_remarks: "Package does not match offer CTC",
    }];
    const err = await resolveAppointmentLetterSalary("emp-x").catch((e) => e);
    expect(err).toBeInstanceOf(AppointmentLetterSalaryError);
    expect(err.code).toBe("salary_review_rejected");
    expect(err.message).toContain("Package does not match offer CTC");
  });

  it("refuses an approved review whose package was never accepted", async () => {
    rows.review = [{ status: "approved", package_accepted: 0, salary_package_id: "pkg-1" }];
    await expect(resolveAppointmentLetterSalary("emp-x"))
      .rejects.toMatchObject({ code: "salary_package_not_accepted" });
  });

  it("refuses an approved, accepted review carrying no package", async () => {
    rows.review = [{ status: "approved", package_accepted: 1, salary_package_id: null }];
    await expect(resolveAppointmentLetterSalary("emp-x"))
      .rejects.toMatchObject({ code: "salary_package_missing" });
  });

  it("refuses an approved package that carries no amounts", async () => {
    rows.approved = [{ ...APPROVED_PACKAGE, basic: 0, gross: 0 }];
    await expect(resolveAppointmentLetterSalary("emp-1"))
      .rejects.toMatchObject({ code: "salary_empty" });
  });
});

describe("the generic letter generator is not taken down by that strictness", () => {
  // letters.service.ts / letters.routes.ts render offer, confirmation and
  // experience templates — live, those are the only three — and two of them
  // print no salary. Hard-failing them on a missing payroll review would be a
  // regression introduced by a rule that was never about those letters.
  it("returns blank salary rows, not zeros, when no approved package exists", async () => {
    const { rows: r, unavailableReason } = await letterSalaryRowsOrBlank("emp-x");
    expect(unavailableReason).toContain("Payroll Head");
    expect(r.basic).toBe("");
    expect(r.gross_salary).toBe("");
    // Zero would read as a stated salary of nothing. Blank reads as absent.
    expect(Object.values(r).every((v) => v === "")).toBe(true);
  });

  it("returns the real rows when the package is approved", async () => {
    rows.approved = [APPROVED_PACKAGE];
    const { rows: r, unavailableReason } = await letterSalaryRowsOrBlank("emp-1");
    expect(unavailableReason).toBeNull();
    expect(r.basic).toBe("7000.00");
  });
});

describe("source pins", () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "src/modules/letters/appointmentLetterData.service.ts"), "utf8");

  // Comments are stripped before every assertion below. The file's own
  // documentation names the rejected sources on purpose — explaining WHY
  // legacy_payslip_snapshot must never be read is the point of writing it down,
  // and a pin that forbade the words would forbid the explanation with them.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never reads legacy_payslip_snapshot — it is not Payroll Head approved", () => {
    expect(code).not.toContain("legacy_payslip_snapshot");
    expect(code).not.toContain("legacy_salary_snapshot");
  });

  it("does not resurrect the broken employee_salary_assignment query", () => {
    expect(code).not.toContain("employee_salary_assignment");
  });

  it("reads salary_component_assignments only for the PF/ESIC flags, never for amounts", () => {
    // The single permitted reference is the LEFT JOIN pinned to the approved
    // package_id. If a second one appears, an amount source has crept back.
    const refs = code.match(/salary_component_assignments/g) ?? [];
    expect(refs.length).toBe(1);
    expect(code).toContain("AND a.package_id = r.salary_package_id");
    // Amounts come off the package alias `p`, never off the assignment alias `a`.
    expect(code).not.toMatch(/\bnum\(a\./);
  });

  it("requires approved AND accepted, not merely a review row", () => {
    expect(code).toContain("r.status = 'approved'");
    expect(code).toContain("r.package_accepted = 1");
  });
});
