/**
 * Settling a bank name variance with the PAN, so only real doubt reaches a human.
 *
 * The bank check compares the account's registered owner against the
 * candidate's own name and sends anything that disagrees to Payroll HR. Given
 * how Indian names are written, that queue would fill with people whose bank
 * simply holds a different form of their name — and a large queue gets
 * rubber-stamped, which is a weaker control than a small one reviewed properly.
 *
 * PAN is the strongest corroboration available and costs nothing extra. It is
 * issued against a verified identity, the candidate supplies it, and it is
 * already verified in this flow. If the name the bank holds matches the name on
 * the candidate's verified PAN, the account belongs to the person that PAN
 * belongs to — a stronger link than a cancelled cheque, which only restates the
 * account's own name and passes just as cleanly when the account is someone
 * else's.
 *
 * The other half is a policy decision, not a technical one: salary is not
 * credited to an account in someone else's name. So an account matching neither
 * the candidate nor their PAN is not an approvable variance — the candidate is
 * asked for their own account.
 */
import { classifyNameMatch } from "./indian-name-match.js";

export type BankVarianceOutcome =
  /** The PAN vouches for the account; no human needed. */
  | "auto_cleared"
  /** The account is in a third party's name; the candidate must supply their own. */
  | "third_party_account"
  /** Genuinely ambiguous — Payroll HR decides. */
  | "needs_review";

export interface BankVarianceResolution {
  outcome: BankVarianceOutcome;
  status: "verified" | "mismatch" | "manual_review";
  reason: string;
}

export function resolveBankNameVariance(input: {
  candidateName?: string | null;
  bankRegisteredName?: string | null;
  /** Name on the candidate's PAN, and only if that PAN was actually verified. */
  verifiedPanName?: string | null;
}): BankVarianceResolution {
  const { candidateName, bankRegisteredName, verifiedPanName } = input;

  if (String(verifiedPanName ?? "").trim()) {
    const panVouches = classifyNameMatch(verifiedPanName, bankRegisteredName);
    if (!panVouches.suspicious) {
      return {
        outcome: "auto_cleared",
        status: "verified",
        reason:
          `The account is registered to "${bankRegisteredName}", which matches the name on the `
          + `candidate's verified PAN (${panVouches.tier}: ${panVouches.reason}). The account belongs `
          + "to the person that PAN was issued to, so the difference from the recorded name is a "
          + "spelling variance rather than a different person.",
      };
    }

    // The PAN is the candidate's and does not match the account either, so the
    // account is a third party's. That is a policy answer, not a judgement call.
    return {
      outcome: "third_party_account",
      status: "mismatch",
      reason:
        `The account is registered to "${bankRegisteredName}", which matches neither the candidate `
        + "nor the name on their verified PAN. Salary cannot be credited to an account in someone "
        + "else's name — the candidate needs to provide their own account.",
    };
  }

  // Nothing to corroborate with. Not evidence of anything, so it goes to a
  // person rather than being decided either way.
  return {
    outcome: "needs_review",
    status: "manual_review",
    reason:
      `The account is registered to "${bankRegisteredName}", which differs from the candidate's `
      + "recorded name, and there is no verified PAN to check it against. Payroll HR needs to "
      + "confirm whether this is the same person.",
  };
}
