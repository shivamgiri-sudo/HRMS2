/**
 * Regression test for a reproduced production bug (MAS63413, candidate_id
 * a7edfea8-fcfd-4744-9223-f109eefcadaf): bank verification succeeded at
 * 2026-08-24 06:37:56, yet candidate_onboarding_bank_detail.account_no_encrypted
 * was NULL both in the row created 24s later and in a subsequent update ~2h
 * after that.
 *
 * Root cause: the frontend deliberately leaves the account-number field blank
 * on reload ("re-enter for security" — useOnboardingFull.ts), so any resave
 * that doesn't re-enter it submits no accountNo. saveBankDetails' ON DUPLICATE
 * KEY UPDATE overwrote account_no_encrypted/masked/hash unconditionally,
 * wiping an already-saved (possibly already-verified) account number to NULL.
 *
 * Fix: COALESCE(VALUES(x), x) on all three account-number columns, so a
 * submission without a new account number preserves whatever was already
 * stored, instead of erasing it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../utils/encryption.js", () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(|\)$/g, ""),
}));

const { saveBankDetails } = await import("../onboarding-full.service.js");

const TOKEN = "test-onboarding-token";
const CANDIDATE_ID = "a7edfea8-fcfd-4744-9223-f109eefcadaf";

// Every query saveBankDetails triggers (token validation twice — once for
// itself, once inside the getFullOnboardingStatus it returns — plus the
// profile lookup, the bank-detail write, and the profile_status update, plus
// whatever getFullOnboardingStatus reads afterward) goes through one
// SQL-sniffing mock rather than a brittle call-order chain.
function installTokenAwareMock(bankVerificationStatus: string | null = "verified") {
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    // The penny-drop gate added 2026-09-02 reads this before it will save anything.
    // Without an answer here every case below fails on the gate rather than on what
    // it means to assert.
    if (s.includes("candidate_bank_verification")) {
      return [bankVerificationStatus ? [{ verification_status: bankVerificationStatus }] : [], []];
    }
    if (s.includes("ats_onboarding_bridge")) {
      return [[{
        candidate_id: CANDIDATE_ID,
        onboarding_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        id: CANDIDATE_ID,
        candidate_code: "MAS63413",
        full_name: "UDAY KUMAR",
      }], []];
    }
    if (s.trim().startsWith("INSERT") || s.trim().startsWith("UPDATE")) {
      return [{ affectedRows: 1 }, undefined];
    }
    return [[], []];
  });
}

describe("saveBankDetails — account number resave does not wipe a stored value", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("submits an accountNo the first time and persists it encrypted", async () => {
    installTokenAwareMock();

    await saveBankDetails(TOKEN, {
      bankName: "Central Bank of India",
      branchName: "MADARNA",
      accountHolderName: "UDAY KUMAR",
      accountNo: "1234567890126026",
      ifscCode: "CBIN0281806",
    });

    const insertCall = execute.mock.calls.find(([sql]) => String(sql).includes("candidate_onboarding_bank_detail"));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall!;
    expect(String(sql)).toContain("account_no_encrypted = COALESCE(VALUES(account_no_encrypted), account_no_encrypted)");
    expect(params).toContain("enc(1234567890126026)");
  });

  it("does NOT overwrite the stored account number with NULL on a resave that omits it", async () => {
    installTokenAwareMock();

    // Candidate goes back to fix the branch name only — accountNo is blank,
    // exactly as the frontend sends it on a reload per useOnboardingFull.ts:354-355.
    await saveBankDetails(TOKEN, {
      bankName: "Central Bank of India",
      branchName: "MADARNA (corrected)",
      accountHolderName: "UDAY KUMAR",
      accountNo: "",
      ifscCode: "CBIN0281806",
    });

    const insertCall = execute.mock.calls.find(([sql]) => String(sql).includes("candidate_onboarding_bank_detail"));
    const [sql, params] = insertCall!;
    // The guard must be present in the SQL (this is what makes a blank
    // resubmission a no-op on the encrypted column instead of a wipe).
    expect(String(sql)).toContain("account_no_encrypted = COALESCE(VALUES(account_no_encrypted), account_no_encrypted)");
    // And the value bound for this submission is NULL, relying on COALESCE
    // in the SQL (not JS) to keep the previously-stored ciphertext.
    expect(params).toContain(null);
  });
});

/**
 * The gate says "not proven"; it must not say "not possible".
 *
 * A penny drop that reaches the bank and comes back with a different spelling of the
 * candidate's name lands on manual_review — a warning for Payroll HR, and by design not a
 * blocker. Requiring 'verified' exactly turned it into one, and the instruction the
 * candidate was given ("run the verification and save again once it succeeds") could never
 * be carried out: the bank returns the same name every time. On 2026-09-03 candidate
 * 4e619083 ran ten penny drops against SBIN0003044 in seventeen minutes, all charged, and
 * still finished with no bank row at all.
 *
 * Letting a manual_review account save does not let it be paid: employee_bank_detail is
 * written by employee-creation-orchestrator, which still demands 'verified'.
 */
describe("saveBankDetails — a name variance is a warning, not a wall", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  const submission = {
    bankName: "State Bank of India",
    branchName: "JALDARSHAN",
    accountHolderName: "RAHUL GAUTAMBHAI CHHAPANE",
    accountNo: "20461206664",
    ifscCode: "SBIN0003044",
  };

  it("saves an account whose penny drop landed on manual_review, and records that status", async () => {
    installTokenAwareMock("manual_review");

    await saveBankDetails(TOKEN, submission);

    const insertCall = execute.mock.calls.find(([sql]) => String(sql).includes("candidate_onboarding_bank_detail"));
    expect(insertCall).toBeDefined();
    // Saved as manual_review, not as an untested 'not_started': Payroll HR has to be able
    // to see that this account is waiting on a human.
    expect(insertCall![1]).toContain("manual_review");
  });

  it("still refuses an account no penny drop has ever reached", async () => {
    installTokenAwareMock(null);

    await expect(saveBankDetails(TOKEN, submission)).rejects.toThrow(/penny-drop verification has not passed/);
  });
});
