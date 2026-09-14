/**
 * Behavioural tests for the bank readiness classifier.
 *
 * classifyBankReadiness() is pure, so these exercise the real decision logic rather than
 * asserting on source text. The precedence order is the part worth pinning: it decides whether
 * an employee whose record is BOTH malformed AND contradicted by the payment history is reported
 * as INVALID (fix the typo) or CONFLICT (do not pay this until a human decides), and those lead
 * to opposite actions.
 */
import { describe, expect, it } from "vitest";
import {
  classifyBankReadiness,
  degradeUnverifiable,
  isCorruptAccount,
  isValidIfsc,
  maskAccount,
  type BankReadinessInput,
} from "../bank-payment-readiness.service.js";

/** A record that is fully payable. Each test perturbs exactly one thing. */
function ready(overrides: Partial<BankReadinessInput> = {}): BankReadinessInput {
  return {
    employee_id: "emp-1",
    employee_code: "MAS00001",
    employee_name: "ASHA KUMARI",
    active_primary_count: 1,
    account_number: "50100234567890",
    account_sources_conflict: false,
    ifsc_code: "HDFC0001234",
    bank_name: "HDFC BANK",
    account_holder_name: "ASHA KUMARI",
    legacy_employee_column_account: "50100234567890",
    has_open_change_request: false,
    duplicate_of_employee_code: null,
    credited_account: "50100234567890",
    credit_receipt_confirmed: true,
    ...overrides,
  };
}

describe("the happy path is actually reachable", () => {
  it("classifies a confirmed-credited account as READY and payable", () => {
    const r = classifyBankReadiness(ready());
    expect(r.readiness_class).toBe("READY");
    expect(r.payable).toBe(true);
    expect(r.reasons).toContain("verified_against_confirmed_credit");
  });
});

describe("MISSING never infers an account", () => {
  it("is MISSING when there is no bank record, even though db_bill knows the account", () => {
    const r = classifyBankReadiness(ready({ account_number: null, active_primary_count: 0 }));
    expect(r.readiness_class).toBe("MISSING");
    expect(r.payable).toBe(false);
    // The known account is FLAGGED as recoverable, never silently adopted.
    expect(r.recoverable_from_db_bill).toBe(true);
    expect(r.account_masked).toBeNull();
  });

  it("distinguishes recoverable from unrecoverable in the reason text", () => {
    const recoverable = classifyBankReadiness(ready({ account_number: null, active_primary_count: 0 }));
    const not = classifyBankReadiness(
      ready({ account_number: null, active_primary_count: 0, credited_account: null }),
    );
    expect(recoverable.recoverable_from_db_bill).toBe(true);
    expect(not.recoverable_from_db_bill).toBe(false);
    expect(not.reason_detail).toMatch(/collected from the employee/i);
  });
});

describe("precedence — the order decides what a human does next", () => {
  it("two active primary records outrank every other fault", () => {
    const r = classifyBankReadiness(
      ready({
        active_primary_count: 2,
        account_number: "notanaccount",
        ifsc_code: "BAD",
        duplicate_of_employee_code: "MAS00009",
      }),
    );
    expect(r.readiness_class).toBe("CONFLICT");
    expect(r.reasons).toEqual(["multiple_active_primary_records"]);
  });

  it("a disagreement with the credited account outranks a malformed IFSC", () => {
    // Both faults present. CONFLICT must win: a well-formed number that would pay the WRONG
    // account is more dangerous than one the bank will simply reject.
    const r = classifyBankReadiness(
      ready({ credited_account: "99999999999999", ifsc_code: "NOT-AN-IFSC" }),
    );
    expect(r.readiness_class).toBe("CONFLICT");
    expect(r.reasons).toContain("disagrees_with_credited_account");
  });

  it("a data fault outranks an in-flight change request, so a pending row cannot hide it", () => {
    const r = classifyBankReadiness(
      ready({ account_number: "2.0021E+14", credited_account: null, has_open_change_request: true }),
    );
    expect(r.readiness_class).toBe("INVALID");
    expect(r.reasons).toContain("account_number_corrupt");
  });

  it("reports every quality fault at once rather than only the first", () => {
    const r = classifyBankReadiness(
      ready({ account_number: "0000", ifsc_code: "NA", credited_account: null }),
    );
    expect(r.readiness_class).toBe("INVALID");
    expect(r.reasons).toEqual(["account_number_corrupt", "ifsc_invalid_format"]);
  });

  it("a corrupt account is CONFLICT, not INVALID, when payment history knows the real one", () => {
    // Deliberate, and it is why the live 2026-08-13 split is 36 INVALID / 19 CONFLICT rather
    // than everything corrupt landing in INVALID. Both readings are defensible; this one wins
    // because the resulting message is strictly more actionable — it does not merely say "this
    // number is garbage", it names the account the salary actually reached. INVALID is reserved
    // for the case where nothing better is known and HR must go back to the employee.
    const r = classifyBankReadiness(
      ready({ account_number: "2.0021E+14", credited_account: "50100234567890" }),
    );
    expect(r.readiness_class).toBe("CONFLICT");
    expect(r.reasons).toContain("disagrees_with_credited_account");
    expect(r.reason_detail).toContain("XXXX7890");
  });
});

describe("CONFLICT reasons never leak a full account number", () => {
  it("masks both sides of a credited-account disagreement", () => {
    const r = classifyBankReadiness(
      ready({ account_number: "50100234567890", credited_account: "60200987654321" }),
    );
    expect(r.readiness_class).toBe("CONFLICT");
    expect(r.reason_detail).toContain("XXXX7890");
    expect(r.reason_detail).toContain("XXXX4321");
    expect(r.reason_detail).not.toContain("50100234567890");
    expect(r.reason_detail).not.toContain("60200987654321");
  });

  it("names the other employee on a shared account without printing the number", () => {
    const r = classifyBankReadiness(ready({ duplicate_of_employee_code: "MAS00042" }));
    expect(r.readiness_class).toBe("CONFLICT");
    expect(r.reason_detail).toContain("MAS00042");
    expect(r.reason_detail).not.toContain("50100234567890");
  });
});

describe("BLOCKED separates 'unverifiable' from 'wrong'", () => {
  it("is BLOCKED, not READY, when there is no payment history at all", () => {
    const r = classifyBankReadiness(ready({ credited_account: null }));
    expect(r.readiness_class).toBe("BLOCKED");
    expect(r.reasons).toContain("no_payment_history_to_verify_against");
  });

  it("is BLOCKED when the account matches but receipt was never confirmed", () => {
    // This is the July-2026 shape: the credit exists, SalaryReceiveStatus is still NULL.
    const r = classifyBankReadiness(ready({ credit_receipt_confirmed: false }));
    expect(r.readiness_class).toBe("BLOCKED");
    expect(r.reasons).toContain("credit_receipt_unconfirmed");
  });
});

describe("beneficiary name falls back but says so", () => {
  it("uses the bank record's account holder when present, unflagged", () => {
    const r = classifyBankReadiness(ready({ account_holder_name: "ASHA KUMARI" }));
    expect(r.beneficiary_source).toBe("bank_record");
    expect(r.beneficiary_unconfirmed).toBe(false);
  });

  it("falls back to the employee name and flags it, without blocking payment", () => {
    const r = classifyBankReadiness(ready({ account_holder_name: null }));
    expect(r.beneficiary_source).toBe("employee_record");
    expect(r.beneficiary_unconfirmed).toBe(true);
    expect(r.beneficiary_name).toBe("ASHA KUMARI");
    // The whole point of the owner's ruling: a blank holder name does not make someone unpayable.
    expect(r.readiness_class).toBe("READY");
  });
});

describe("a dead verification source degrades honestly", () => {
  it("turns READY into BLOCKED and says it is a system fault", () => {
    const r = degradeUnverifiable(classifyBankReadiness(ready()));
    expect(r.readiness_class).toBe("BLOCKED");
    expect(r.payable).toBe(false);
    expect(r.reasons).toEqual(["bank_source_unavailable"]);
    expect(r.reason_detail).toMatch(/system fault, not a fault on the employee/i);
  });

  it("leaves a genuine data fault reported as itself", () => {
    // A missing record is still missing when db_bill is down. Rewriting every class to
    // BLOCKED would erase the one part of the answer that is still knowable.
    const missing = classifyBankReadiness(ready({ account_number: null, active_primary_count: 0 }));
    expect(degradeUnverifiable(missing).readiness_class).toBe("MISSING");

    const invalid = classifyBankReadiness(ready({ ifsc_code: "NA" }));
    expect(degradeUnverifiable(invalid).readiness_class).toBe("INVALID");
  });
});

describe("field validators", () => {
  it("rejects Excel scientific notation, which is the dominant corruption here", () => {
    expect(isCorruptAccount("2.0021E+14")).toBe(true);
    expect(isCorruptAccount("2.0021e+14")).toBe(true);
    expect(isCorruptAccount("50100234567890")).toBe(false);
  });

  it("rejects all-zero and out-of-range account numbers", () => {
    expect(isCorruptAccount("00000000")).toBe(true);
    expect(isCorruptAccount("12345")).toBe(true);            // 5 digits, too short
    expect(isCorruptAccount("1".repeat(21))).toBe(true);     // 21 digits, too long
    expect(isCorruptAccount("123456")).toBe(false);          // 6 is the floor
  });

  it("enforces the RBI IFSC shape, including the literal zero in position 5", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    // Real values found live: an 'O' where the zero belongs, and a plain 'NA'.
    expect(isValidIfsc("BARBONAGINA")).toBe(false);
    expect(isValidIfsc("NA")).toBe(false);
    expect(isValidIfsc("ICICI0000831")).toBe(false);         // 12 chars, one too many
    expect(isValidIfsc("hdfc0001234")).toBe(true);           // case-insensitive
    expect(isValidIfsc(null)).toBe(false);
  });

  it("masks to last 4 and never partially reveals a short value", () => {
    expect(maskAccount("50100234567890")).toBe("XXXX7890");
    expect(maskAccount("123")).toBe("XXXX");
    expect(maskAccount(null)).toBe("XXXX");
  });
});
