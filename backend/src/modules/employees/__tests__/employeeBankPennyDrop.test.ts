import { describe, it, expect } from "vitest";
import { judgeBeneficiaryName } from "../employeeBankPennyDrop.js";

describe("judgeBeneficiaryName", () => {
  it("passes when the bank name matches both the entered holder and the employee", () => {
    const r = judgeBeneficiaryName("NEHA RATHORE", "Neha Rathore", "Neha Rathore");
    expect(r.status).toBe("success");
  });
  it("flags a holder name that does not match the bank's", () => {
    const r = judgeBeneficiaryName("RAMESH KUMAR", "Suresh Singh", "Ramesh Kumar");
    expect(r.status).toBe("name_mismatch");
    expect(r.message).toContain("account holder name entered");
  });
  it("flags an account that belongs to someone other than the employee", () => {
    const r = judgeBeneficiaryName("RAMESH KUMAR", "Ramesh Kumar", "Anita Sharma");
    expect(r.status).toBe("name_mismatch");
    expect(r.message).toContain("employee's name");
  });
  it("fails, not passes, when the bank returns no name", () => {
    expect(judgeBeneficiaryName(null, "A B", "A B").status).toBe("failed");
  });
});
