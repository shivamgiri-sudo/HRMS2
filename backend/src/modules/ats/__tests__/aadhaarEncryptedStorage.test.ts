/**
 * Aadhaar storage on the candidate KYC save (saveEmployeeDetails).
 *
 * This file was written on 2026-09-02 for an encrypted-at-rest column,
 * candidate_onboarding_profile.aadhaar_number_encrypted. That column does not exist on
 * the live database: migration 1651 was never added to MIGRATION_MANIFEST and never ran,
 * so the INSERT naming it failed ER_BAD_FIELD_ERROR and every candidate reaching KYC
 * Step 3 got a 500. 503bc60da removed the write the next day and recorded the owner's
 * decision to hold Aadhaar/PAN in plaintext for ESI (ats_candidate.aadhar_number),
 * consistent with employees.aadhaar_number. See the long comment above
 * rawAadhaarForCandidate in onboarding-full.service.ts.
 *
 * The cases therefore pin what the save does today:
 *   1. A real 12-digit Aadhaar is stored as mask + match-hash on the profile and as the
 *      genuine number on ats_candidate -- and the INSERT never names the absent column.
 *   2. The masked value the frontend seeds the field with on reload ("XXXX-XXXX-1234")
 *      is recognised as "no new Aadhaar" rather than saved as if it were real.
 *   3. A resave that omits Aadhaar entirely does not wipe a previously-stored value
 *      (SQL-side COALESCE on every Aadhaar column, in both statements).
 *
 * If encrypted Aadhaar storage is reinstated, the migration must be in the manifest
 * FIRST; then restore the two encrypted-column assertions here alongside the write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../utils/encryption.js", () => ({
  encrypt: (v: string) => `enc(${v})`,
  decrypt: (v: string) => v.replace(/^enc\(|\)$/g, ""),
}));
// decryptAadhaarForProvider reads via the format-aware resolver (decryptPii), same
// as decryptPanForProvider does -- not utils/encryption.js's decrypt directly.
vi.mock("../../../shared/piiCiphertext.js", () => ({
  decryptPii: (v: string) => v.replace(/^enc\(|\)$/g, ""),
}));

const { saveEmployeeDetails, decryptAadhaarForProvider } = await import("../onboarding-full.service.js");
const { hashPiiForMatch } = await import("../../../shared/piiHash.js");

const TOKEN = "test-onboarding-token";
const CANDIDATE_ID = "a7edfea8-fcfd-4744-9223-f109eefcadaf";

function installTokenAwareMock() {
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("ats_onboarding_bridge")) {
      return [
        [
          {
            candidate_id: CANDIDATE_ID,
            onboarding_token_expires_at: new Date(
              Date.now() + 3600_000,
            ).toISOString(),
            id: CANDIDATE_ID,
            candidate_code: "MAS63413",
            full_name: "UDAY KUMAR",
          },
        ],
        [],
      ];
    }
    if (s.trim().startsWith("INSERT") || s.trim().startsWith("UPDATE")) {
      return [{ affectedRows: 1 }, undefined];
    }
    return [[], []];
  });
}

function findProfileInsert() {
  return execute.mock.calls.find(
    ([sql]) =>
      String(sql).includes("candidate_onboarding_profile") &&
      String(sql).includes("INSERT"),
  );
}

/** Every SHA-256-shaped binding. The profile INSERT always carries one: the token hash. */
const sha256Params = (params: unknown[]) =>
  params.filter((p) => typeof p === "string" && /^[0-9a-f]{64}$/.test(p));

function findCandidateUpdate() {
  return execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE ats_candidate SET") && String(sql).includes("aadhar_number ="));
}

const AADHAAR_COALESCE_PROFILE = [
  "aadhaar_number_masked = COALESCE(VALUES(aadhaar_number_masked), aadhaar_number_masked)",
  "aadhaar_number_hash = COALESCE(VALUES(aadhaar_number_hash), aadhaar_number_hash)",
];
const AADHAAR_COALESCE_CANDIDATE = [
  "aadhar_number = COALESCE(?, aadhar_number)",
  "aadhar_number_masked = COALESCE(?, aadhar_number_masked)",
  "aadhar_number_hash = COALESCE(?, aadhar_number_hash)",
];

describe("saveEmployeeDetails — Aadhaar storage", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("stores a real 12-digit Aadhaar as mask + hash on the profile and the number on the candidate", async () => {
    installTokenAwareMock();

    await saveEmployeeDetails(TOKEN, {
      employeeName: "UDAY KUMAR",
      aadhaarNumber: "234567890123",
    });

    const call = findProfileInsert();
    expect(call).toBeDefined();
    const [sql, params] = call!;
    // The column is absent on the live database; naming it 500s every KYC save.
    expect(String(sql)).not.toContain("aadhaar_number_encrypted");
    for (const clause of AADHAAR_COALESCE_PROFILE) expect(String(sql)).toContain(clause);
    // The profile row never holds the number itself -- only the mask and a match hash.
    expect(params).toContain("XXXX-XXXX-0123");
    expect(params).not.toContain("234567890123");
    expect(params).not.toContain("enc(234567890123)");
    expect(params).toContain(hashPiiForMatch("234567890123"));
    expect(sha256Params(params)).toHaveLength(2); // the onboarding-token hash + the Aadhaar match hash

    const update = findCandidateUpdate();
    expect(update).toBeDefined();
    const [updateSql, updateParams] = update!;
    for (const clause of AADHAAR_COALESCE_CANDIDATE) expect(String(updateSql)).toContain(clause);
    expect(updateParams).toContain("234567890123");
  });

  it("treats the masked value echoed back on reload as no new Aadhaar", async () => {
    installTokenAwareMock();

    await saveEmployeeDetails(TOKEN, {
      employeeName: "UDAY KUMAR",
      aadhaarNumber: "XXXX-XXXX-0123", // maskAadhaar()'s own shape, as the frontend would seed it
    });

    const call = findProfileInsert();
    const [, params] = call!;
    // Must NOT encrypt/hash the mask itself.
    expect(params).not.toContain("enc(XXXX-XXXX-0123)");
    expect(params.some((p: unknown) => typeof p === "string" && p.startsWith("enc("))).toBe(false);
    expect(sha256Params(params)).toHaveLength(1); // the onboarding-token hash only — no Aadhaar hash
    // ...and must not land in the raw column on ats_candidate, in any form.
    const [, updateParams] = findCandidateUpdate()!;
    expect(updateParams).not.toContain("XXXX-XXXX-0123");
    expect(updateParams.some((p: unknown) => typeof p === "string" && /^\d{4,}$/.test(p))).toBe(false);
  });

  it("does not wipe a previously-stored Aadhaar on a resave that omits it", async () => {
    installTokenAwareMock();

    await saveEmployeeDetails(TOKEN, { employeeName: "UDAY KUMAR" }); // no aadhaarNumber at all

    const call = findProfileInsert();
    const [sql, params] = call!;
    expect(String(sql)).not.toContain("aadhaar_number_encrypted");
    for (const clause of AADHAAR_COALESCE_PROFILE) expect(String(sql)).toContain(clause);
    // The parameter bound for this submission is null -- SQL-side COALESCE, not JS,
    // is what preserves the existing value, matching the bank-account fix.
    expect(params).toContain(null);
    expect(params.some((p: unknown) => typeof p === "string" && /^XXXX-XXXX-/.test(p))).toBe(false);
    expect(sha256Params(params)).toHaveLength(1); // the onboarding-token hash only — no Aadhaar hash

    const [updateSql, updateParams] = findCandidateUpdate()!;
    for (const clause of AADHAAR_COALESCE_CANDIDATE) expect(String(updateSql)).toContain(clause);
    expect(updateParams.some((p: unknown) => typeof p === "string" && /^\d{12}$/.test(p))).toBe(false);
  });
});

describe("decryptAadhaarForProvider", () => {
  it("round-trips a valid 12-digit Aadhaar", () => {
    expect(decryptAadhaarForProvider("enc(234567890123)")).toBe("234567890123");
  });

  it("rejects a decrypted value that is not 12 digits", () => {
    expect(decryptAadhaarForProvider("enc(not-an-aadhaar)")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(decryptAadhaarForProvider(null)).toBeNull();
    expect(decryptAadhaarForProvider("")).toBeNull();
  });
});
