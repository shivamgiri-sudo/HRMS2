/**
 * Letting the PAN settle a bank name variance, so only real doubt reaches a human.
 *
 * The bank check compares the account's registered owner against the candidate's
 * own name, and sends anything that disagrees to Payroll HR. Indian names being
 * what they are, that queue would fill with people whose bank simply holds a
 * different form of their name — and a queue that large gets rubber-stamped,
 * which is worse than a small one reviewed properly.
 *
 * PAN is the strongest corroboration available and costs nothing: it is issued
 * against a verified identity, the candidate supplies it, and we already verify
 * it (18 verified in production). If the name the bank holds matches the name on
 * the candidate's verified PAN, the account belongs to the person that PAN
 * belongs to. That is a stronger link than a cancelled cheque, which only
 * restates the account's own name.
 *
 * The reverse case matters just as much: a bank name that matches neither the
 * candidate nor their PAN is a third-party account, and those are not permitted
 * for salary credit — so the outcome is "provide your own account", not an
 * approvable variance.
 */
import { describe, it, expect } from "vitest";
import { resolveBankNameVariance } from "../bank-name-corroboration.js";

describe("resolveBankNameVariance", () => {
  it("clears a variance the PAN corroborates, without a human", () => {
    const result = resolveBankNameVariance({
      candidateName: "RAJESH KUMAR",
      bankRegisteredName: "RAJESH KUMAR SINGH",
      verifiedPanName: "RAJESH KUMAR SINGH",
    });
    expect(result.outcome).toBe("auto_cleared");
    expect(result.status).toBe("verified");
    expect(result.reason.toLowerCase()).toContain("pan");
  });

  it("clears it across the regional forms that would otherwise flood the queue", () => {
    for (const [bank, pan] of [
      ["DHAVAL R PATEL", "DHAVAL RAMESHBHAI PATEL"],
      ["S SRINIVASAN", "SRINIVASAN"],
      ["BELLAPPU SRINIVASA PRASAD", "SRINIVASA PRASAD BELLAPPU"],
    ]) {
      const result = resolveBankNameVariance({
        candidateName: "SOMEONE ELSE ENTIRELY",
        bankRegisteredName: bank,
        verifiedPanName: pan,
      });
      expect(result.outcome, `${bank} vs PAN ${pan}`).toBe("auto_cleared");
    }
  });

  it("treats an account matching neither name as a third-party account", () => {
    // Not an approvable variance: salary is not credited to someone else's
    // account, so the candidate has to supply their own.
    const result = resolveBankNameVariance({
      candidateName: "HARSH THAKUR",
      bankRegisteredName: "PRIYA SHARMA",
      verifiedPanName: "HARSH THAKUR",
    });
    expect(result.outcome).toBe("third_party_account");
    expect(result.status).toBe("mismatch");
    expect(result.reason.toLowerCase()).toMatch(/own account/);
  });

  it("sends it to a human when there is no verified PAN to corroborate with", () => {
    const result = resolveBankNameVariance({
      candidateName: "HARSH THAKUR",
      bankRegisteredName: "H THAKUR GENERAL STORES",
      verifiedPanName: null,
    });
    expect(result.outcome).toBe("needs_review");
    expect(result.status).toBe("manual_review");
  });

  it("does not let an unverified PAN clear anything", () => {
    // A PAN name we never verified is just another thing the candidate typed.
    const result = resolveBankNameVariance({
      candidateName: "HARSH THAKUR",
      bankRegisteredName: "PRIYA SHARMA",
      verifiedPanName: "",
    });
    expect(result.outcome).not.toBe("auto_cleared");
  });

  it("still refuses a relative's account even when a PAN exists", () => {
    // The usual shape of account sharing: same surname, different person.
    const result = resolveBankNameVariance({
      candidateName: "HARSH THAKUR",
      bankRegisteredName: "RAJESH THAKUR",
      verifiedPanName: "HARSH THAKUR",
    });
    expect(result.outcome).toBe("third_party_account");
  });

  it("explains itself, because a reviewer or a candidate has to act on it", () => {
    const result = resolveBankNameVariance({
      candidateName: "HARSH THAKUR",
      bankRegisteredName: "PRIYA SHARMA",
      verifiedPanName: null,
    });
    expect(result.reason.length).toBeGreaterThan(30);
  });
});
