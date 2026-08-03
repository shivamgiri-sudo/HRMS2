/**
 * The bank check must decide against who the candidate IS, not what they typed.
 *
 * This is the hole it closes. Both provider adapters scored the penny-drop
 * result with
 *
 *     roughNameMatchScore(input.accountHolderName ?? input.candidateName, matchedName)
 *
 * and sent `account_holder_name: input.accountHolderName ?? input.candidateName`
 * to the provider. `accountHolderName` is a free-text field the candidate fills
 * in. So X, submitting Y's account number and typing "Y" as the holder, is
 * scored Y-against-Y and comes back a perfect match. Every one of the 11
 * verified bank checks in production has match_score exactly 100, which is what
 * that looks like from the outside.
 *
 * The registered name on ats_candidate is the only name in this exchange the
 * candidate does not control, so it is the only one worth comparing against.
 *
 * Name variance is handled separately and deliberately: a bank holding a fuller
 * or differently-ordered form of the same name is not fraud, and treating it as
 * fraud would strand far more genuine joiners than it would catch fraudsters.
 * That grading lives in indian-name-match.ts.
 */
import { describe, it, expect } from "vitest";
import { resolveBankVerificationOutcome } from "../bgv-provider.adapter.js";

const provider = (status: "verified" | "mismatch" | "failed") => status;

describe("bank verification outcome", () => {
  it("catches the fraud: someone else's account, that person's name typed in", () => {
    const outcome = resolveBankVerificationOutcome({
      providerStatus: provider("verified"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "PRIYA SHARMA",
      bankRegisteredName: "PRIYA SHARMA",
    });

    // The provider is satisfied - it compared Priya against Priya. We are not.
    expect(outcome.status).toBe("manual_review");
    expect(outcome.riskFlags).toContain("BANK_HOLDER_NAME_DIVERGENCE");
    expect(outcome.matchScore).toBe(0);
  });

  it("does not let the typed name influence the score at all", () => {
    const honest = resolveBankVerificationOutcome({
      providerStatus: provider("verified"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "HARSH THAKUR",
      bankRegisteredName: "PRIYA SHARMA",
    });
    const lying = resolveBankVerificationOutcome({
      providerStatus: provider("verified"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "PRIYA SHARMA",
      bankRegisteredName: "PRIYA SHARMA",
    });
    expect(lying.matchScore).toBe(honest.matchScore);
    expect(lying.status).toBe(honest.status);
  });

  it("passes a genuine account cleanly", () => {
    const outcome = resolveBankVerificationOutcome({
      providerStatus: provider("verified"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "HARSH THAKUR",
      bankRegisteredName: "HARSH THAKUR",
    });
    expect(outcome.status).toBe("verified");
    expect(outcome.riskFlags).toEqual([]);
    expect(outcome.matchScore).toBe(100);
  });

  it("passes ordinary name variance without sending it for review", () => {
    // The bank holding a fuller name is the single most common real case.
    for (const bankName of ["RAJESH KUMAR SINGH", "KUMAR RAJESH", "MR RAJESH KUMAR"]) {
      const outcome = resolveBankVerificationOutcome({
        providerStatus: provider("verified"),
        candidateName: "RAJESH KUMAR",
        typedAccountHolderName: "RAJESH KUMAR",
        bankRegisteredName: bankName,
      });
      expect(outcome.status, `${bankName} should not need review`).toBe("verified");
    }
  });

  it("handles the regional forms that would otherwise flood the queue", () => {
    const cases: Array<[string, string]> = [
      ["DHAVAL RAMESHBHAI PATEL", "DHAVAL R PATEL"],
      ["S SRINIVASAN", "SRINIVASAN"],
      ["SRINIVASA PRASAD BELLAPPU", "BELLAPPU SRINIVASA PRASAD"],
    ];
    for (const [candidateName, bankRegisteredName] of cases) {
      const outcome = resolveBankVerificationOutcome({
        providerStatus: provider("verified"),
        candidateName,
        typedAccountHolderName: candidateName,
        bankRegisteredName,
      });
      expect(outcome.status, `${candidateName} vs ${bankRegisteredName}`).toBe("verified");
    }
  });

  it("still flags a relative's account, which is what sharing usually looks like", () => {
    const outcome = resolveBankVerificationOutcome({
      providerStatus: provider("verified"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "HARSH THAKUR",
      bankRegisteredName: "RAJESH THAKUR",
    });
    expect(outcome.status).toBe("manual_review");
    expect(outcome.riskFlags).toContain("BANK_HOLDER_NAME_DIVERGENCE");
  });

  it("never upgrades an outcome the provider already rejected", () => {
    const outcome = resolveBankVerificationOutcome({
      providerStatus: provider("failed"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "HARSH THAKUR",
      bankRegisteredName: "HARSH THAKUR",
    });
    expect(outcome.status).toBe("failed");
  });

  it("asks for review rather than guessing when the bank returns no name", () => {
    const outcome = resolveBankVerificationOutcome({
      providerStatus: provider("verified"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "HARSH THAKUR",
      bankRegisteredName: null,
    });
    expect(outcome.status).toBe("manual_review");
    expect(outcome.riskFlags).toContain("BANK_NAME_NOT_RETURNED");
  });

  it("records the divergent typed name so a reviewer can see what was claimed", () => {
    const outcome = resolveBankVerificationOutcome({
      providerStatus: provider("verified"),
      candidateName: "HARSH THAKUR",
      typedAccountHolderName: "PRIYA SHARMA",
      bankRegisteredName: "PRIYA SHARMA",
    });
    expect(outcome.reason).toMatch(/typed/i);
  });
});
