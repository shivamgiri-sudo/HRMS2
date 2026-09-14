import { describe, it, expect } from "vitest";
import { FIELD_OWNERSHIP, SELF_EDITABLE_PERSONAL_COLUMNS, dbColumnFor } from "../fieldOwnership.js";

describe("FIELD_OWNERSHIP", () => {
  it("every entry has exactly one ownership shape it can honestly claim", () => {
    // immutable + employeeEditable/hrEditable/approvalRequired all true at once would be
    // self-contradictory (nothing can be both unwritable and directly writable).
    for (const [key, f] of Object.entries(FIELD_OWNERSHIP)) {
      if (f.immutable) {
        expect(f.employeeEditable, `${key}: immutable but marked employeeEditable`).toBe(false);
        expect(f.hrEditable, `${key}: immutable but marked hrEditable`).toBe(false);
      }
    }
  });

  it("official_email is HR-editable but never employee-editable", () => {
    expect(FIELD_OWNERSHIP.official_email.employeeEditable).toBe(false);
    expect(FIELD_OWNERSHIP.official_email.hrEditable).toBe(true);
  });

  it("employee_code is immutable in practice (accepted by the schema, never written)", () => {
    expect(FIELD_OWNERSHIP.employee_code.immutable).toBe(true);
  });

  it("every Employment-tab field is closed to direct employee edits", () => {
    for (const [key, f] of Object.entries(FIELD_OWNERSHIP)) {
      if (f.tab === "employment") {
        expect(f.employeeEditable, `${key}: an Employment field must not be employeeEditable`).toBe(false);
      }
    }
  });

  it("identity and bank fields route through approval for the employee, even where HR can write directly", () => {
    for (const [key, f] of Object.entries(FIELD_OWNERSHIP)) {
      if (f.tab === "identity" || f.tab === "bank") {
        if (f.employeeEditable || f.hrEditable) {
          expect(f.approvalRequired, `${key}: identity/bank fields must be approval-gated for the employee`).toBe(true);
        }
      }
    }
  });
});

describe("SELF_EDITABLE_PERSONAL_COLUMNS", () => {
  it("matches the live PATCH /me allowlist exactly — this is what that route now imports", () => {
    expect(SELF_EDITABLE_PERSONAL_COLUMNS.sort()).toEqual(
      [
        "mobile", "personal_email", "personal_phone", "alternate_mobile",
        "address_line1", "address_line2", "city", "state", "pincode",
        "date_of_birth", "gender", "marital_status", "blood_group",
        "working_hours_start", "working_hours_end", "working_days",
      ].sort(),
    );
  });

  it("never includes official_email, employment fields, or composite sub-resources", () => {
    expect(SELF_EDITABLE_PERSONAL_COLUMNS).not.toContain("official_email");
    expect(SELF_EDITABLE_PERSONAL_COLUMNS).not.toContain("branch_id");
    expect(SELF_EDITABLE_PERSONAL_COLUMNS).not.toContain("employment_status");
    expect(SELF_EDITABLE_PERSONAL_COLUMNS).not.toContain("emergency_contact");
    expect(SELF_EDITABLE_PERSONAL_COLUMNS).not.toContain("nominee");
  });
});

describe("dbColumnFor", () => {
  // Regression test, 2026-08-13: address_line1 is a near-empty column (2 of 58,840 rows)
  // that only /employees/me ever touched; address1 is the real, populated one every other
  // path (admin edit, onboarding, document form-fill) reads and writes. Self-service must
  // resolve to the real column or an employee's own address edit is invisible everywhere
  // else in the system.
  it("maps address_line1 (the wire field) to address1 (the real column)", () => {
    expect(dbColumnFor("address_line1")).toBe("address1");
    expect(FIELD_OWNERSHIP.address_line1.dbColumn).toBe("address1");
  });

  it("falls back to the field name itself when no override is declared", () => {
    expect(dbColumnFor("mobile")).toBe("mobile");
    expect(dbColumnFor("city")).toBe("city");
    expect(dbColumnFor("some_field_not_in_the_matrix")).toBe("some_field_not_in_the_matrix");
  });
});
