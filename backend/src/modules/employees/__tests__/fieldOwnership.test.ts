import { describe, it, expect } from "vitest";
import { FIELD_OWNERSHIP, SELF_EDITABLE_PERSONAL_COLUMNS } from "../fieldOwnership.js";

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
