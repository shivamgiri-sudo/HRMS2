/**
 * Aadhaar now gets the same encrypted-at-rest treatment PAN and bank account already
 * have (added 2026-09-02 for EPFO KYC/UAN seeding). Covers:
 *   1. A real 12-digit Aadhaar is encrypted and bound to the INSERT.
 *   2. The masked value the frontend seeds the field with on reload ("XXXX-XXXX-1234")
 *      is recognised as "no new Aadhaar" rather than saved as if it were real --
 *      the same class of bug PAN had (fixed 2026-09-01) reproduced pre-emptively here.
 *   3. A resave that omits Aadhaar entirely does not wipe a previously-stored value
 *      (COALESCE on the encrypted/masked/hash columns).
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

const TOKEN = "test-onboarding-token";
const CANDIDATE_ID = "a7edfea8-fcfd-4744-9223-f109eefcadaf";

function installTokenAwareMock() {
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
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

function findProfileInsert() {
  return execute.mock.calls.find(([sql]) => String(sql).includes("candidate_onboarding_profile") && String(sql).includes("INSERT"));
}

describe("saveEmployeeDetails — Aadhaar encrypted storage", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("encrypts a real 12-digit Aadhaar and binds it to the insert", async () => {
    installTokenAwareMock();

    await saveEmployeeDetails(TOKEN, {
      employeeName: "UDAY KUMAR",
      aadhaarNumber: "234567890123",
    });

    const call = findProfileInsert();
    expect(call).toBeDefined();
    const [sql, params] = call!;
    expect(String(sql)).toContain("aadhaar_number_encrypted = COALESCE(VALUES(aadhaar_number_encrypted), aadhaar_number_encrypted)");
    expect(params).toContain("enc(234567890123)");
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
  });

  it("does not wipe a previously-stored Aadhaar on a resave that omits it", async () => {
    installTokenAwareMock();

    await saveEmployeeDetails(TOKEN, { employeeName: "UDAY KUMAR" }); // no aadhaarNumber at all

    const call = findProfileInsert();
    const [sql, params] = call!;
    expect(String(sql)).toContain("aadhaar_number_encrypted = COALESCE(VALUES(aadhaar_number_encrypted), aadhaar_number_encrypted)");
    // The parameter bound for this submission is null -- SQL-side COALESCE, not JS,
    // is what preserves the existing ciphertext, matching the bank-account fix.
    expect(params).toContain(null);
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
