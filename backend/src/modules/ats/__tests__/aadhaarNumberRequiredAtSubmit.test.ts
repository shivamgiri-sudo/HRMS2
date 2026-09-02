/**
 * submitFullOnboarding() now hard-requires an Aadhaar number, not just the
 * Aadhaar card document (which findMissingMandatoryDocuments already covers
 * separately -- a candidate can satisfy that via DigiLocker without ever
 * typing the number). Step 3 (Address & KYC) already marks the field
 * `required` in the UI (OnboardingSteps1to5V2.tsx); this closes the same
 * client/server parity gap the pre-existing MISSING_QUALIFICATIONS check
 * was added to close for education records.
 *
 * Decided explicitly 2026-09-02, tradeoff accepted: a candidate who verified
 * via DigiLocker without ever typing the number manually is blocked here
 * until they do.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { submitFullOnboarding } = await import("../onboarding-full.service.js");

const TOKEN = "test-onboarding-token";
const CANDIDATE_ID = "a7edfea8-fcfd-4744-9223-f109eefcadaf";

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    employee_name: "UDAY KUMAR",
    mobile_number: "8873447555",
    personal_email_id: "udaykumar8441132@gmail.com",
    pan_number_hash: null,
    aadhaar_number_hash: null,
    bgv_consent: 1,
    dpdp_consent: 1,
    marital_status: "single",
    ...overrides,
  };
}

function installMock(profile: ReturnType<typeof baseProfile>) {
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("ats_onboarding_bridge") && s.includes("SELECT b.candidate_id")) {
      return [[{
        candidate_id: CANDIDATE_ID,
        onboarding_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        id: CANDIDATE_ID, candidate_code: "MAS63413", full_name: "UDAY KUMAR",
      }], []];
    }
    if (s.includes("FROM candidate_onboarding_profile") && s.includes("pan_number_hash")) {
      return [[profile], []];
    }
    if (s.includes("candidate_bgv_check")) return [[{ check_type: "aadhaar" }, { check_type: "pan" }], []];
    if (s.includes("candidate_onboarding_document")) return [[
      { doc_type: "Address Proof", doc_name: "Address Proof" },
      { doc_type: "Passport Photo", doc_name: "Passport Photo" },
      { doc_type: "Live Selfie", doc_name: "Live Selfie" },
      { doc_type: "10th Marksheet", doc_name: "10th Marksheet" },
      { doc_type: "12th Marksheet", doc_name: "12th Marksheet" },
    ], []];
    if (s.includes("candidate_onboarding_qualification")) return [[{ id: "q1" }], []];
    if (s.trim().startsWith("UPDATE") || s.trim().startsWith("INSERT")) return [{ affectedRows: 1 }, undefined];
    return [[], []];
  });
}

describe("submitFullOnboarding — Aadhaar number required", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("rejects submission when aadhaar_number_hash is empty, even with the card document on file", async () => {
    installMock(baseProfile({ aadhaar_number_hash: null }));

    await expect(submitFullOnboarding(TOKEN)).rejects.toMatchObject({
      statusCode: 400,
      code: "MISSING_AADHAAR_NUMBER",
    });
  });

  it("does not block on this specific gate once a real Aadhaar number was captured", async () => {
    installMock(baseProfile({ aadhaar_number_hash: "deadbeef".repeat(8) }));

    // Should get past the Aadhaar gate -- if it throws, it must not be this code.
    await submitFullOnboarding(TOKEN).catch((err: any) => {
      expect(err.code).not.toBe("MISSING_AADHAAR_NUMBER");
    });
  });
});
