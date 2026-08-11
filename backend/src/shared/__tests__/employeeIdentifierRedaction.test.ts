import { describe, it, expect } from "vitest";
import {
  redactEmployeeIdentifiers,
  maySeeRawIdentifiers,
  RAW_IDENTIFIER_ROLES,
  CRYPTO_PLUMBING_PATTERN,
} from "../employeeIdentifierRedaction.js";

/**
 * Regression coverage for the employee-detail field-level exposure.
 *
 * employeeService.getEmployee() is `SELECT * FROM employees`, and GET /api/employees/:id
 * admits hr, manager, branch_head, process_manager, wfm, payroll_head, payroll_admin,
 * payroll, finance_head and it_head. Row scope was enforced; field scope was not, so a WFM
 * or IT user reading anyone inside their scope received that person's raw Aadhaar, PAN,
 * bank account, IFSC and UAN — plus the at-rest ciphertext and blind indexes.
 */

// A row shaped like the real `employees` SELECT * result.
const ROW = {
  id: "emp-1",
  employee_code: "MAS1234",
  full_name: "Test Person",
  branch_id: "br-1",
  aadhaar_number: "123456789012",
  pan_number: "ABCDE1234F",
  bank_account_number: "50100234567890",
  ifsc_code: "HDFC0001234",
  uan_number: "100234567890",
  aadhaar_last4: "9012",
  pan_number_masked: "ABXXXXX34F",
  aadhaar_number_encrypted: "eyJ2IjoxLCJpdiI6...",
  pan_number_encrypted: "eyJ2IjoxLCJpdiI6...",
  aadhaar_blind_index: "9f2b3c...",
  pan_blind_index: "7d1a4e...",
  aadhaar_enc_key_version: 1,
  pan_enc_key_version: 1,
};

const IDENTIFIERS = [
  "aadhaar_number",
  "pan_number",
  "bank_account_number",
  "ifsc_code",
  "uan_number",
] as const;

const PLUMBING = [
  "aadhaar_number_encrypted",
  "pan_number_encrypted",
  "aadhaar_blind_index",
  "pan_blind_index",
  "aadhaar_enc_key_version",
  "pan_enc_key_version",
] as const;

describe("crypto plumbing never leaves the API", () => {
  it.each([["wfm"], ["manager"], ["hr"], ["payroll"], ["super_admin"]])(
    "is stripped for %s, including roles that keep raw identifiers",
    (role) => {
      const out = redactEmployeeIdentifiers(ROW, [role]);
      for (const key of PLUMBING) expect(out).not.toHaveProperty(key);
    },
  );

  it("strips a password hash if one is ever added to the row", () => {
    const out = redactEmployeeIdentifiers({ ...ROW, password_hash: "$2b$10$abc" }, ["super_admin"]);
    expect(out).not.toHaveProperty("password_hash");
  });

  it("keeps already-masked convenience columns, which are not plumbing", () => {
    const out = redactEmployeeIdentifiers(ROW, ["wfm"]);
    expect(out.aadhaar_last4).toBe("9012");
    expect(out.pan_number_masked).toBe("ABXXXXX34F");
  });

  it("the pattern matches the storage suffixes and nothing else", () => {
    for (const k of PLUMBING) expect(CRYPTO_PLUMBING_PATTERN.test(k)).toBe(true);
    for (const k of ["aadhaar_number", "pan_number", "aadhaar_last4", "pan_number_masked"]) {
      expect(CRYPTO_PLUMBING_PATTERN.test(k)).toBe(false);
    }
  });
});

describe("roles with no business need do not receive raw identifiers", () => {
  it.each([["wfm"], ["manager"], ["branch_head"], ["process_manager"], ["it_head"]])(
    "%s receives masked values, not raw",
    (role) => {
      const out = redactEmployeeIdentifiers(ROW, [role]);
      for (const key of IDENTIFIERS) {
        expect(out[key]).not.toBe(ROW[key]);
        expect(out).toHaveProperty(key); // present but masked, so the UI still renders a field
      }
      expect(out.aadhaar_number).toBe("XXXXXXXX9012");
      expect(out.pan_number).toBe("ABXXXXX34F");
      expect(out.bank_account_number).toBe("XXXXXXXXXX7890");
    },
  );

  it("leaves non-sensitive fields completely untouched", () => {
    const out = redactEmployeeIdentifiers(ROW, ["wfm"]);
    expect(out.id).toBe("emp-1");
    expect(out.employee_code).toBe("MAS1234");
    expect(out.full_name).toBe("Test Person");
    expect(out.branch_id).toBe("br-1");
  });
});

describe("roles that legitimately need raw identifiers keep today's access", () => {
  it.each([...RAW_IDENTIFIER_ROLES].map((r) => [r]))("%s still receives raw values", (role) => {
    const out = redactEmployeeIdentifiers(ROW, [role]);
    for (const key of IDENTIFIERS) expect(out[key]).toBe(ROW[key]);
  });

  it("a user holding several roles keeps the access of the strongest", () => {
    // Branch-scoped users in this system are known to also carry global role rows.
    expect(maySeeRawIdentifiers(["wfm", "payroll"])).toBe(true);
    expect(maySeeRawIdentifiers(["wfm", "manager"])).toBe(false);
  });
});

describe("fails closed", () => {
  it.each([[[]], [null], [undefined]])("masks when roles are %s", (roles) => {
    const out = redactEmployeeIdentifiers(ROW, roles as string[] | null | undefined);
    expect(out.aadhaar_number).toBe("XXXXXXXX9012");
    expect(maySeeRawIdentifiers(roles as string[] | null | undefined)).toBe(false);
  });

  it("masks for a role nobody has heard of, rather than defaulting to hr", () => {
    // getProjectionForRole() resolves an unknown role to the `hr` policy. That default is
    // why this module exists separately: here an unknown role gets the least access.
    const out = redactEmployeeIdentifiers(ROW, ["some_new_role"]);
    expect(out.pan_number).toBe("ABXXXXX34F");
  });

  it("is case- and whitespace-insensitive about role names", () => {
    expect(maySeeRawIdentifiers([" Payroll "])).toBe(true);
    expect(maySeeRawIdentifiers(["SUPER_ADMIN"])).toBe(true);
  });
});

describe("does not corrupt empty or absent values", () => {
  it("leaves a null or blank identifier alone instead of masking it into 'XXXX'", () => {
    const out = redactEmployeeIdentifiers(
      { ...ROW, aadhaar_number: null, pan_number: "", bank_account_number: "   " },
      ["wfm"],
    );
    expect(out.aadhaar_number).toBeNull();
    expect(out.pan_number).toBe("");
    expect(out.bank_account_number).toBe("   ");
  });

  it("does not mutate the record it was given", () => {
    const input = { ...ROW };
    redactEmployeeIdentifiers(input, ["wfm"]);
    expect(input.aadhaar_number).toBe("123456789012");
    expect(input).toHaveProperty("aadhaar_blind_index");
  });
});
