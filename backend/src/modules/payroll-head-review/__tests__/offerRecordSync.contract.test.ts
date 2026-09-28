import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ats_employment_offer is the ORIGINAL offer row, and other screens (offer history,
 * the Payroll Head Review queue's "Offered" column) read it directly. When Payroll
 * Head builds/assigns a NEW package from the catalog (writeComponentAssignment, via
 * assignPackage/createAndAssignPackage), the real figures land in
 * salary_component_assignments/employee_salary_assignment -- but nothing wrote them
 * back to ats_employment_offer, so it stayed on whatever it started at.
 *
 * Confirmed live, 2026-09-11: AKASH (MAS63497), HARSH NILAY (MAS63496) and VANSH
 * ARYAN (MAS63423) were all approved with a real package (₹25,000 / ₹25,000 /
 * ₹20,000 per month) through this path, yet their offer row was still frozen at
 * the ₹0 it started at before the zero-CTC submit guard existed -- so anything
 * reading the offer table kept showing them as ₹0, contradicting their own
 * approved payroll.
 *
 * approveOfferedPackage is deliberately NOT touched: that path copies FROM the
 * offer INTO the assignment, so the offer is already the source of truth there.
 */
const SERVICE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll-head-review/payroll-head-review.service.ts"),
  "utf8",
);

describe("ats_employment_offer stays in sync when Payroll Head assigns a catalog package", () => {
  it("defines a non-fatal helper that updates the offer row's CTC/components", () => {
    expect(SERVICE).toMatch(/async function syncOfferRecordFromPackage\(/);
    const helper = SERVICE.slice(
      SERVICE.indexOf("async function syncOfferRecordFromPackage("),
      SERVICE.indexOf("async function writeComponentAssignment("),
    );
    expect(helper).toMatch(/if \(!candidateId\) return/);
    expect(helper).toContain("UPDATE ats_employment_offer SET");
    expect(helper).toMatch(/offered_ctc = \?/);
    expect(helper).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it("writeComponentAssignment (assignPackage / createAndAssignPackage) calls the sync helper", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("async function writeComponentAssignment("),
      SERVICE.indexOf("export async function assignPackage"),
    );
    expect(fn).toMatch(/await syncOfferRecordFromPackage\(candidateId, pkg\);/);
  });

  it("approveOfferedPackage does NOT call the sync helper -- the offer is already its source", () => {
    const fn = SERVICE.slice(
      SERVICE.indexOf("export async function approveOfferedPackage("),
      SERVICE.indexOf("// ── Notification helpers"),
    );
    expect(fn).not.toMatch(/syncOfferRecordFromPackage/);
  });
});
