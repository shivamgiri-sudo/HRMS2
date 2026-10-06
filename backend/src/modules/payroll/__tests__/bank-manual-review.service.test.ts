/**
 * Automatic copy of verified bank accounts to the employee record, and the exceptions-only
 * manual path (approve / reject).
 *
 * Live 2026-10-06: seven joiners' bank checks were verified after they had become employees,
 * and nothing copied the account across, so they sat in the Ops Control Tower's penny-drop
 * pending list until someone clicked Approve. The owner's rule: automatic for verified,
 * manual only for exceptions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, syncBridge, sendResubmit } = vi.hoisted(() => ({
  execute: vi.fn(),
  syncBridge: vi.fn(),
  sendResubmit: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/fieldEncryption.js", () => ({ encryptField: (v: string) => `enc(${v})` }));
vi.mock("../../../shared/bankAccountDuplicate.js", () => ({ computeAccountBlindIndex: (v: string) => `bi(${v})` }));
vi.mock("../../../shared/piiCiphertext.js", () => ({
  decryptPii: (v: string) => {
    if (!v.startsWith("cipher:")) throw new Error("bad ciphertext");
    return v.slice("cipher:".length);
  },
}));
vi.mock("../../../shared/piiHash.js", () => ({ hashPiiForMatch: (v: unknown) => `h(${String(v)})` }));
vi.mock("../bank-payment-readiness.service.js", () => ({ maskAccount: (v: string) => `XXXX${v.slice(-4)}` }));
vi.mock("../../ats/onboarding-bridge-status.js", () => ({ syncBridgePennyDropStatus: syncBridge }));
vi.mock("../../ats/ats.onboarding.service.js", () => ({ sendBankResubmitRequest: sendResubmit }));

const svc = await import("../bank-manual-review.service.js");

type Latest = Record<string, unknown>;

/** Routes each query by its shape, so tests describe data, not call order. */
function wire(opts: { latest?: Latest | null; hasPrimary?: boolean; candidateId?: string | null; gaps?: Latest[] }) {
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM employee_bank_detail WHERE employee_id")) {
      return [opts.hasPrimary ? [{ id: "ebd-1" }] : []];
    }
    if (sql.includes("INSERT INTO")) return [{ affectedRows: 1 }];
    if (sql.includes("ORDER BY COALESCE(v.verified_at, v.created_at) DESC, v.created_at DESC\n      LIMIT 1")) {
      return [opts.candidateId ? [{ candidate_id: opts.candidateId }] : []];
    }
    if (sql.includes("candidate_onboarding_document")) return [[]];
    if (sql.includes("emp_rn")) return [opts.gaps ?? []];
    if (sql.includes("WHERE v.candidate_id = ?")) return [opts.latest ? [opts.latest] : []];
    return [[]];
  });
}

const insertCalls = () => execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO"));

const VERIFIED: Latest = {
  verification_status: "verified",
  provider_key: "befisc_luckpay",
  account_no_hash: "h(1234567890)",
  ifsc_code: "SBIN0001234",
  account_holder_name: "NEHA RATHORE",
  employee_id: "emp-1",
  plain_account_no: "",
  onboarding_account_encrypted: "cipher:1234567890",
  candidate_account_encrypted: null,
  bank_name: "SBI",
  branch_name: "Main",
};

beforeEach(() => {
  execute.mockReset();
  syncBridge.mockReset();
  sendResubmit.mockReset();
});

describe("resolveAccountNumber", () => {
  it("prefers plaintext, then the onboarding ciphertext, then the candidate ciphertext", () => {
    expect(svc.resolveAccountNumber({ plain: " 12 34 ", onboardingEncrypted: "cipher:9" })).toBe("1234");
    expect(svc.resolveAccountNumber({ plain: "", onboardingEncrypted: "cipher:555", candidateEncrypted: "cipher:9" })).toBe("555");
    expect(svc.resolveAccountNumber({ onboardingEncrypted: "garbage", candidateEncrypted: "cipher:777" })).toBe("777");
    expect(svc.resolveAccountNumber({})).toBeNull();
  });
});

describe("copyVerifiedBankToEmployee — the automatic path", () => {
  it("copies a verified account to an employee with no bank row, reading the encrypted number", async () => {
    wire({ latest: VERIFIED, hasPrimary: false });
    const r = await svc.copyVerifiedBankToEmployee("cand-1");
    expect(r).toEqual({ status: "inserted", employeeId: "emp-1" });
    const [sql, params] = insertCalls()[0];
    expect(String(sql)).toContain("INSERT INTO employee_bank_detail");
    expect(params).toContain("1234567890");
    expect(params).toContain("enc(1234567890)");
    expect(params).toContain("SBIN0001234");
  });

  it("writes nothing on a dry run", async () => {
    wire({ latest: VERIFIED, hasPrimary: false });
    expect((await svc.copyVerifiedBankToEmployee("cand-1", { dryRun: true })).status).toBe("would_insert");
    expect(insertCalls()).toHaveLength(0);
  });

  it("never copies an exception: manual_review and mismatch stay for a person", async () => {
    for (const status of ["manual_review", "mismatch"]) {
      wire({ latest: { ...VERIFIED, verification_status: status } });
      expect((await svc.copyVerifiedBankToEmployee("cand-1")).status).toBe("not_verified");
    }
    expect(insertCalls()).toHaveLength(0);
  });

  it("never copies mock-provider results", async () => {
    wire({ latest: { ...VERIFIED, provider_key: "mock_bgv" } });
    expect((await svc.copyVerifiedBankToEmployee("cand-1")).status).toBe("not_verified");
  });

  it("refuses when the stored number is not the account that was verified", async () => {
    wire({ latest: { ...VERIFIED, onboarding_account_encrypted: "cipher:9999999999" } });
    expect((await svc.copyVerifiedBankToEmployee("cand-1")).status).toBe("account_changed");
    expect(insertCalls()).toHaveLength(0);
  });

  it("leaves an existing primary account alone", async () => {
    wire({ latest: VERIFIED, hasPrimary: true });
    expect((await svc.copyVerifiedBankToEmployee("cand-1")).status).toBe("already_has_primary");
    expect(insertCalls()).toHaveLength(0);
  });

  it("does nothing for a candidate who is not yet an employee", async () => {
    wire({ latest: { ...VERIFIED, employee_id: null } });
    expect((await svc.copyVerifiedBankToEmployee("cand-1")).status).toBe("not_an_employee");
  });

  it("reports a missing account number instead of writing a blank one", async () => {
    wire({ latest: { ...VERIFIED, onboarding_account_encrypted: null } });
    expect((await svc.copyVerifiedBankToEmployee("cand-1")).status).toBe("no_account_number");
  });
});

describe("approveManualReviewBankDetail — a person accepts an exception", () => {
  it("copies a manual_review account, readable only from ciphertext", async () => {
    wire({ candidateId: "cand-1", latest: { ...VERIFIED, verification_status: "manual_review" } });
    expect((await svc.approveManualReviewBankDetail({ employeeId: "emp-1" })).status).toBe("inserted");
    expect(insertCalls()).toHaveLength(1);
  });

  it("is idempotent against an existing primary row", async () => {
    wire({ candidateId: "cand-1", latest: { ...VERIFIED, verification_status: "manual_review" }, hasPrimary: true });
    expect((await svc.approveManualReviewBankDetail({ employeeId: "emp-1" })).status).toBe("already_has_primary");
  });

  it("refuses an account number the bank never checked (re-entered since)", async () => {
    wire({ candidateId: "cand-1", latest: { ...VERIFIED, verification_status: "verified", onboarding_account_encrypted: "cipher:5555555555" } });
    expect((await svc.approveManualReviewBankDetail({ employeeId: "emp-1" })).status).toBe("account_changed");
    expect(insertCalls()).toHaveLength(0);
  });

  it("404s when there is no verification for the employee", async () => {
    wire({ candidateId: null });
    expect((await svc.approveManualReviewBankDetail({ employeeId: "emp-1" })).status).toBe("no_manual_review_row");
  });
});

describe("rejectManualReviewBankDetail — a person refuses an exception", () => {
  it("appends an hr_review mismatch, marks the bridge, asks the joiner to resubmit, copies nothing", async () => {
    wire({ candidateId: "cand-1", latest: { ...VERIFIED, verification_status: "manual_review", provider_account_holder_name: "RAMESH" } });
    sendResubmit.mockResolvedValue({ emailSent: true });

    const r = await svc.rejectManualReviewBankDetail({ employeeId: "emp-1", reason: "Account is in father's name", actorUserId: "u-1" });

    expect(r).toMatchObject({ status: "rejected", candidateId: "cand-1", resubmitEmailSent: true });
    const inserts = insertCalls();
    expect(inserts).toHaveLength(1);
    expect(String(inserts[0][0])).toContain("INSERT INTO candidate_bank_verification");
    expect(String(inserts[0][0])).toContain("'hr_review'");
    expect(String(inserts[0][0])).toContain("'mismatch'");
    expect(JSON.parse(String((inserts[0][1] as unknown[]).at(-1)))).toMatchObject({ mode: "hr_rejected", reason: "Account is in father's name" });
    expect(syncBridge).toHaveBeenCalledWith(expect.anything(), "cand-1", "mismatch", ["HR_REJECTED_BANK_ACCOUNT"]);
    expect(sendResubmit).toHaveBeenCalledWith("cand-1", "u-1");
  });

  it("still rejects when the resubmit email fails, and says so", async () => {
    wire({ candidateId: "cand-1", latest: { ...VERIFIED, verification_status: "mismatch" } });
    sendResubmit.mockRejectedValue(new Error("SMTP down"));
    const r = await svc.rejectManualReviewBankDetail({ employeeId: "emp-1", reason: "third party", actorUserId: "u-1" });
    expect(r).toMatchObject({ status: "rejected", resubmitEmailSent: false, resubmitError: "SMTP down" });
  });
});

describe("getManualReviewBankGaps — what the reviewer sees", () => {
  it("shows the bank's name next to every recorded name, with the reason, masked", async () => {
    wire({
      gaps: [{
        employee_id: "emp-1", employee_code: "MAS63527", employee_name: "HEMKALA NEGI", employee_record_name: "HEMKALA NEGI",
        candidate_id: "cand-1", verification_status: "manual_review", provider_account_holder_name: "Ms. KM HEMKALA",
        candidate_name: "HEMKALA NEGI", profile_name: "Hemkala", plain_account_no: null,
        onboarding_account_encrypted: "cipher:30123456789", review_reason: "matches neither the candidate nor the typed holder name",
        risk_flags_json: '["BANK_HOLDER_NAME_DIVERGENCE"]',
      }],
    });
    const [row] = await svc.getManualReviewBankGaps();
    expect(row.bank_registered_name).toBe("Ms. KM HEMKALA");
    expect(row.recorded_names).toEqual(["HEMKALA NEGI", "Hemkala"]);
    expect(row.review_reason).toContain("matches neither");
    expect(row.risk_flags).toEqual(["BANK_HOLDER_NAME_DIVERGENCE"]);
    expect(row.account_masked).toBe("XXXX6789");
    expect(row.account_changed).toBe(false);
  });

  it("flags a row whose number on file is not the verified one", async () => {
    wire({ gaps: [{ employee_id: "emp-2", candidate_id: "cand-2", verification_status: "verified",
      onboarding_account_encrypted: "cipher:111", account_no_hash: "h(222)" }] });
    const [row] = await svc.getManualReviewBankGaps();
    expect(row.account_changed).toBe(true);
  });

  it("lists only exceptions: excludes HR-rejected attempts and employees who already have an account", async () => {
    wire({ gaps: [] });
    await svc.getManualReviewBankGaps();
    const sql = String(execute.mock.calls.find(([s]) => String(s).includes("emp_rn"))![0]);
    expect(sql).toContain("<> 'hr_review'");
    expect(sql).toContain("ebd.is_primary = 1");
    expect(sql).toContain("account_no_encrypted");
  });
});

describe("proof document lookup", () => {
  it("reads candidate_onboarding_document by uploaded_at (the table has no created_at)", async () => {
    wire({ gaps: [{ employee_id: "emp-1", candidate_id: "cand-1", verification_status: "manual_review", onboarding_account_encrypted: "cipher:1" }] });
    await svc.getManualReviewBankGaps();
    const sql = String(execute.mock.calls.find(([s]) => String(s).includes("candidate_onboarding_document"))![0]);
    expect(sql).toContain("uploaded_at");
    expect(sql).not.toContain("created_at");
    expect(sql).toContain("deleted_at IS NULL");
  });
});
