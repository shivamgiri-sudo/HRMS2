/**
 * A penny drop is real money, and the same answer must not be bought twice.
 *
 * Live case, 2026-09-03: candidate 4e619083 pressed Verify ten times in seventeen minutes
 * against account ...6664 / SBIN0003044. Every call reached Luckpay, every call was
 * charged, and every call returned the identical "Mr. RAHUL  CHHAPANE" — because the bank's
 * answer for one account cannot change between two clicks. He kept pressing because the
 * save gate told him to ("run the verification and save again once it succeeds"), and the
 * name comparison could never clear.
 *
 * The reuse below is deliberately not a plain cache: the provider's half is replayed and
 * OUR half is recomputed against the candidate record as it stands now. That is what makes
 * it safe to put behind the candidate's own button — when HR corrects a misspelled name,
 * the next click clears the account against the name the bank already gave us, with no
 * second charge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, verifyBank } = vi.hoisted(() => ({ execute: vi.fn(), verifyBank: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../bgv-provider.adapter.js", async (importOriginal) => ({
  // resolveBankVerificationOutcome stays real: the replay is only correct if it grades the
  // stored bank name exactly as a fresh call would have done.
  ...(await importOriginal<typeof import("../bgv-provider.adapter.js")>()),
  getConfiguredBgvProviderAdapter: async () => ({ providerKey: "befisc_luckpay", verifyBank }),
}));
vi.mock("../onboarding-full.service.js", () => ({
  validateOnboardingToken: async () => ({ candidate_id: CANDIDATE_ID }),
  loadAsyncBgvTriggerContext: async () => ({ bank: {} }),
  decryptPanForProvider: async () => null,
}));
vi.mock("../onboarding-bridge-status.js", () => ({ syncBridgePennyDropStatus: async () => undefined }));
vi.mock("../../../shared/identityVerificationPropagation.js", () => ({ propagateIdentityVerification: async () => undefined }));
vi.mock("../../../utils/encryption.js", () => ({ encrypt: (v: string) => `enc(${v})`, decrypt: (v: string) => v }));

const CANDIDATE_ID = "4e619083-5eea-43b5-b640-bd546918f367";
const ACCOUNT_NO = "20461206664";
const IFSC = "SBIN0003044";
const BANK_NAME = "Mr. RAHUL  CHHAPANE";

const { verifyBankForCandidate } = await import("../bgv-verification.service.js");

/** Records every INSERT into candidate_bank_verification, in order. */
const savedVerifications: unknown[][] = [];

function installMock(options: { candidateName: string; priorAnswer: boolean }) {
  savedVerifications.length = 0;
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const s = String(sql).trim();
    if (s.startsWith("INSERT INTO candidate_bank_verification")) {
      savedVerifications.push(params);
      return [{ affectedRows: 1 }, undefined];
    }
    if (s.startsWith("INSERT") || s.startsWith("UPDATE") || s.startsWith("REPLACE")) {
      return [{ affectedRows: 1 }, undefined];
    }
    if (s.includes("candidate_bgv_consent")) return [[{ id: "consent-1" }], []];
    if (s.includes("FROM ats_candidate c")) {
      return [[{ id: CANDIDATE_ID, full_name: options.candidateName, employee_name: options.candidateName }], []];
    }
    // The reusable-answer lookup.
    if (s.includes("FROM candidate_bank_verification")) {
      return [options.priorAnswer
        ? [{
            id: "prior-attempt",
            provider_key: "befisc_luckpay",
            provider_reference_id: "PDMTL5GN4A00ZJ",
            provider_account_holder_name: BANK_NAME,
            result_json: { details: { verified: true } },
            created_at: new Date().toISOString(),
          }]
        : [], []];
    }
    return [[], []];
  });
}

const statusOf = (params: unknown[]) => String(params[12]);

describe("verifyBankForCandidate — an answer already paid for is not bought again", () => {
  beforeEach(() => {
    execute.mockReset();
    verifyBank.mockReset();
    verifyBank.mockResolvedValue({
      status: "manual_review",
      providerKey: "befisc_luckpay",
      providerRequestId: "PD1",
      providerReferenceId: "PD1",
      matchScore: 25,
      matchedName: BANK_NAME,
      resultSummary: "name divergence",
      riskFlags: ["BANK_HOLDER_NAME_DIVERGENCE"],
      raw: { details: { verified: true, beneficiaryNameWithBank: BANK_NAME } },
    });
  });

  it("calls the provider when nothing is held for this account", async () => {
    installMock({ candidateName: "RAHUL GAUTAM RAO CHHAPANEY", priorAnswer: false });

    await verifyBankForCandidate(CANDIDATE_ID, { accountNo: ACCOUNT_NO, ifscCode: IFSC });

    expect(verifyBank).toHaveBeenCalledTimes(1);
  });

  it("does not call the provider again for the same account and IFSC", async () => {
    installMock({ candidateName: "RAHUL GAUTAM RAO CHHAPANEY", priorAnswer: true });

    await verifyBankForCandidate(CANDIDATE_ID, { accountNo: ACCOUNT_NO, ifscCode: IFSC });

    expect(verifyBank).not.toHaveBeenCalled();
    // Still recorded, so the save gate and Payroll HR see this attempt.
    expect(savedVerifications).toHaveLength(1);
    // And the live pair clears on its own: "RAHUL GAUTAM RAO CHHAPANEY" against the bank's
    // "Mr. RAHUL  CHHAPANE" is one trailing letter, not one person impersonating another.
    expect(statusOf(savedVerifications[0])).toBe("verified");
  });

  it("re-judges the stored answer against the corrected record, without a new charge", async () => {
    // What HR fixing the surname looks like: same account, same bank name, new record name.
    installMock({ candidateName: "RAHUL GAUTAMBHAI CHHAPANE", priorAnswer: true });

    await verifyBankForCandidate(CANDIDATE_ID, { accountNo: ACCOUNT_NO, ifscCode: IFSC });

    expect(verifyBank).not.toHaveBeenCalled();
    expect(statusOf(savedVerifications[0])).toBe("verified");
  });

  it("keeps a genuine divergence at manual_review when the record is unchanged", async () => {
    installMock({ candidateName: "SANDEEP PATEL", priorAnswer: true });

    await verifyBankForCandidate(CANDIDATE_ID, { accountNo: ACCOUNT_NO, ifscCode: IFSC });

    expect(statusOf(savedVerifications[0])).toBe("manual_review");
  });

  it("logs no API request for a replay, so the cost report is not inflated", async () => {
    installMock({ candidateName: "RAHUL GAUTAM RAO CHHAPANEY", priorAnswer: true });

    await verifyBankForCandidate(CANDIDATE_ID, { accountNo: ACCOUNT_NO, ifscCode: IFSC });

    const logged = execute.mock.calls.filter(([sql]) => String(sql).includes("candidate_bgv_api_request_log"));
    expect(logged).toHaveLength(0);
  });

  it("buys a fresh drop when HR explicitly asks for one", async () => {
    installMock({ candidateName: "RAHUL GAUTAM RAO CHHAPANEY", priorAnswer: true });

    await verifyBankForCandidate(CANDIDATE_ID, { accountNo: ACCOUNT_NO, ifscCode: IFSC, forceProvider: true });

    expect(verifyBank).toHaveBeenCalledTimes(1);
  });
});
