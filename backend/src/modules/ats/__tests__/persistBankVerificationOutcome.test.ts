/**
 * The submit-time penny drop used to land only in candidate_bgv_check, so a genuinely verified
 * account (employee 63555C, 2026-09-17) never reached candidate_bank_verification -- the table
 * employee creation copies the bank account from -- and Ops Control Tower kept it "pending".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../bgv-provider.adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bgv-provider.adapter.js")>()),
  getConfiguredBgvProviderAdapter: async () => ({}),
}));
vi.mock("../onboarding-full.service.js", () => ({
  validateOnboardingToken: async () => ({}),
  loadAsyncBgvTriggerContext: async () => ({ bank: {} }),
  decryptPanForProvider: async () => null,
}));
vi.mock("../onboarding-bridge-status.js", () => ({
  syncBridgePennyDropStatus: async () => undefined,
}));
vi.mock("../../../shared/identityVerificationPropagation.js", () => ({
  propagateIdentityVerification: async () => undefined,
}));
vi.mock("../../../utils/encryption.js", () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v,
}));

import { persistBankVerificationOutcome } from "../bgv-verification.service.js";

const CANDIDATE_ID = "fccde869-474a-4f74-abf0-7e2c2d1fc0b6";

describe("persistBankVerificationOutcome", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue([[], []]);
  });

  it("writes a verified candidate_bank_verification row and marks the onboarding bank detail verified", async () => {
    await persistBankVerificationOutcome(
      CANDIDATE_ID,
      { accountNo: "1234567890", ifscCode: "CBIN0280541", accountHolderName: "ANSARI MEHJBINBANU" },
      {
        status: "verified",
        providerKey: "befisc_luckpay",
        providerReferenceId: "PDMU591L5400WW",
        matchedName: "Miss. ANSARI  MEHJBINBANU",
        matchScore: 100,
        raw: { status: "SUCCESS" },
      },
    );

    const insert = execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO candidate_bank_verification"));
    expect(insert).toBeDefined();
    const params = insert![1] as unknown[];
    expect(params).toContain(CANDIDATE_ID);
    expect(params).toContain("7890");
    expect(params).toContain("verified");
    expect(params).toContain("PDMU591L5400WW");

    const update = execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE candidate_onboarding_bank_detail"));
    expect(update).toBeDefined();
    expect(update![1]).toContain("verified");
    expect(update![1]).toContain("enc(1234567890)");
  });
});
