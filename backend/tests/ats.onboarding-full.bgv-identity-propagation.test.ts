import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn(),
  },
}));

const { propagateIdentityVerification } = vi.hoisted(() => ({
  propagateIdentityVerification: vi.fn(),
}));
vi.mock("../src/shared/identityVerificationPropagation.js", () => ({
  propagateIdentityVerification,
}));

import { db } from "../src/db/mysql.js";
import { storeBgvCheckResult } from "../src/modules/ats/onboarding-full.service.js";

const mockDbExecute = db.execute as ReturnType<typeof vi.fn>;

// Regression guard for the 2026-08-25 fix: storeBgvCheckResult() is the REAL async onboarding
// BGV path (triggerRealBgvChecksAsync -> storeBgvCheckResult), not the manually/API-triggered
// createOrUpdateCheck() in bgv-verification.service.ts. The propagation writer was wired into
// createOrUpdateCheck on 2026-08-12 but this — the path production actually uses — never called
// it, so employees.pan_verified_on/aadhaar_verified_on stayed NULL on all 58,918 employees even
// though real 'verified' BGV checks existed. See identityVerificationPropagation.ts and
// hrms2-kyc-verification-never-set memory for the full history.
describe("storeBgvCheckResult propagates identity verification (BUG FIX 2026-08-25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates a verified pan check to the employee record", async () => {
    mockDbExecute
      .mockResolvedValueOnce([[], []])   // SELECT existing -> none, take INSERT branch
      .mockResolvedValueOnce([{}, []]);  // INSERT candidate_bgv_check

    await storeBgvCheckResult(
      "cand-1",
      "pan",
      {
        status: "verified",
        providerKey: "digio",
        providerRequestId: "req-1",
        providerReferenceId: "ref-1",
        matchScore: 95,
        matchedName: "Asha Singh",
        resultSummary: "PAN matched",
      },
      "digio",
    );

    expect(propagateIdentityVerification).toHaveBeenCalledTimes(1);
    const [candidateId, checkType, verifiedAt] = propagateIdentityVerification.mock.calls[0];
    expect(candidateId).toBe("cand-1");
    expect(checkType).toBe("pan");
    expect(verifiedAt).toBeInstanceOf(Date);
  });

  it("does not propagate when the check did not reach verified", async () => {
    mockDbExecute
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{}, []]);

    await storeBgvCheckResult(
      "cand-1",
      "aadhaar_offline",
      {
        status: "manual_review",
        providerKey: "digio",
        providerRequestId: "req-2",
        providerReferenceId: "ref-2",
        resultSummary: "Needs manual review",
      },
      "digio",
    );

    expect(propagateIdentityVerification).not.toHaveBeenCalled();
  });

  it("does not let a propagation failure block the BGV check write", async () => {
    mockDbExecute
      .mockResolvedValueOnce([[{ id: "existing-check" }], []]) // SELECT existing -> found, UPDATE branch
      .mockResolvedValueOnce([{}, []]);
    propagateIdentityVerification.mockRejectedValueOnce(new Error("db down"));

    await expect(
      storeBgvCheckResult(
        "cand-1",
        "aadhaar_offline",
        {
          status: "verified",
          providerKey: "digio",
          providerRequestId: "req-3",
          providerReferenceId: "ref-3",
          resultSummary: "Aadhaar matched",
        },
        "digio",
      ),
    ).resolves.toBeUndefined();

    // UPDATE candidate_bgv_check still happened before the propagate() call was even attempted.
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
  });
});
