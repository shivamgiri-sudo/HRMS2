/**
 * The EPF employer block should carry the branch's Payroll HR signature.
 *
 * applyCompanySeal stamps employer_signature on EPF Form 2 and the EPF
 * Declaration from one company-wide seal, so a Noida joiner and a Jaipur joiner
 * are signed for by the same person regardless of which branch's Payroll HR
 * processed them.
 *
 * applyCompanySeal already accepts an optional seal override, so nothing about
 * the stamping logic changes — only which signature is handed to it.
 *
 * The company stamp is deliberately kept in every case. A branch has its own
 * signatory but not its own company stamp; that is the organisation's, and
 * dropping it would remove something the statutory form expects.
 */
import { describe, it, expect } from "vitest";
import { mergeBranchSignatureIntoSeal } from "../branchPayrollHrSignatory.service.js";

const companySeal = {
  signature: Buffer.from("company-signature"),
  stamp: Buffer.from("company-stamp"),
  signatoryName: "Company Signatory",
  signatoryDesignation: "Director",
};

describe("mergeBranchSignatureIntoSeal", () => {
  it("uses the branch signature when the branch has one", () => {
    const merged = mergeBranchSignatureIntoSeal(companySeal, {
      branchId: "b1",
      hrName: "Anita Sharma",
      hrDesignation: "Payroll HR",
      employeeId: null,
      signatureFile: "anita.png",
      signature: Buffer.from("branch-signature"),
    });
    expect(merged.signature?.toString()).toBe("branch-signature");
    expect(merged.signatoryName).toBe("Anita Sharma");
    expect(merged.signatoryDesignation).toBe("Payroll HR");
  });

  it("keeps the company stamp, which belongs to the organisation not the branch", () => {
    const merged = mergeBranchSignatureIntoSeal(companySeal, {
      branchId: "b1",
      hrName: "Anita Sharma",
      hrDesignation: null,
      employeeId: null,
      signatureFile: "anita.png",
      signature: Buffer.from("branch-signature"),
    });
    expect(merged.stamp?.toString()).toBe("company-stamp");
  });

  it("falls back to the company signature when the branch has no image uploaded", () => {
    // The name is configured but no signature yet — the document must still be
    // sealed rather than going out unsigned.
    const merged = mergeBranchSignatureIntoSeal(companySeal, {
      branchId: "b1",
      hrName: "Anita Sharma",
      hrDesignation: null,
      employeeId: null,
      signatureFile: null,
      signature: null,
    });
    expect(merged.signature?.toString()).toBe("company-signature");
  });

  it("still names the branch HR even when their image is missing", () => {
    // Better than the company signatory's name against a company signature,
    // because the branch HR is who actually processed this joiner.
    const merged = mergeBranchSignatureIntoSeal(companySeal, {
      branchId: "b1",
      hrName: "Anita Sharma",
      hrDesignation: "Payroll HR",
      employeeId: null,
      signatureFile: null,
      signature: null,
    });
    expect(merged.signatoryName).toBe("Anita Sharma");
  });

  it("is exactly the company seal when no branch signatory is configured", () => {
    // 45 branches, none configured yet — this is today's behaviour and must be
    // completely unchanged.
    expect(mergeBranchSignatureIntoSeal(companySeal, null)).toEqual(companySeal);
  });

  it("does not mutate the company seal it was given", () => {
    const merged = mergeBranchSignatureIntoSeal(companySeal, {
      branchId: "b1", hrName: "Anita Sharma", hrDesignation: null,
      employeeId: null, signatureFile: "a.png", signature: Buffer.from("branch-signature"),
    });
    expect(companySeal.signature.toString()).toBe("company-signature");
    expect(merged).not.toBe(companySeal);
  });
});
