import { describe, it, expect, beforeAll } from "vitest";
import { encryptField } from "../fieldEncryption.js";
import { encrypt as legacyEncrypt, decrypt as legacyDecrypt } from "../../utils/encryption.js";
import { detectPiiCiphertextFormat, decryptPii, tryDecryptPii } from "../piiCiphertext.js";

/**
 * Regression coverage for the two-rival-ciphertexts defect on ats_candidate.
 *
 * Measured on production 2026-08-10: ats_candidate.bank_account_no_encrypted holds 49 rows
 * in the legacy AES-CBC shape ("<ivhex>:<cthex>", written by the ATS onboarding flow via
 * utils/encryption.ts) while 31,142 rows are still plaintext-only and are to be filled by
 * the DPDP backfill in the canonical AES-GCM shape (base64 {v,iv,tag,ct}).
 *
 * Neither existing helper can read the other's output, and the live BGV read path catches
 * the failure and continues with a null account number. So a mixed column does not fail
 * loudly — it silently drops the bank account from the provider call. These tests pin the
 * format detection and prove the resolver reads both, so the column can hold both safely.
 */

// utils/encryption.ts derives its key lazily from BANK_ENCRYPTION_KEY || JWT_SECRET and
// throws when neither is set, so give it a deterministic one for this suite.
beforeAll(() => {
  process.env.BANK_ENCRYPTION_KEY ??= "pii-ciphertext-test-key";
});

const ACCOUNT = "50100234567890";
const PAN = "ABCDE1234F";

describe("detectPiiCiphertextFormat", () => {
  it("classifies a canonical AES-GCM envelope", () => {
    expect(detectPiiCiphertextFormat(encryptField(ACCOUNT))).toBe("gcm_envelope");
  });

  it("classifies a legacy AES-CBC value", () => {
    expect(detectPiiCiphertextFormat(legacyEncrypt(ACCOUNT))).toBe("legacy_cbc");
  });

  it("does not mistake plaintext in an encrypted column for ciphertext", () => {
    expect(detectPiiCiphertextFormat(ACCOUNT)).toBe("unrecognised");
    expect(detectPiiCiphertextFormat("")).toBe("unrecognised");
    expect(detectPiiCiphertextFormat("   ")).toBe("unrecognised");
  });

  it("does not report arbitrary base64 as a canonical envelope", () => {
    // Base64 that decodes to JSON, but not to the envelope contract.
    const notAnEnvelope = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64");
    expect(detectPiiCiphertextFormat(notAnEnvelope)).toBe("unrecognised");
    expect(detectPiiCiphertextFormat(Buffer.from("plain text").toString("base64"))).toBe(
      "unrecognised",
    );
  });
});

describe("the defect this resolver exists for", () => {
  it("the legacy CBC reader cannot read a canonical GCM envelope", () => {
    const canonical = encryptField(ACCOUNT);
    // This is exactly what loadAsyncBgvTriggerContext did to every backfilled row:
    // it calls utils/encryption.decrypt, which splits on ":" and rejects the envelope.
    expect(() => legacyDecrypt(canonical)).toThrow(/Invalid encrypted format/);
  });

  it("the canonical GCM reader cannot read a legacy CBC value", async () => {
    const { decryptField } = await import("../fieldEncryption.js");
    expect(() => decryptField(legacyEncrypt(ACCOUNT))).toThrow();
  });
});

describe("decryptPii", () => {
  it("round-trips a canonical AES-GCM value", () => {
    expect(decryptPii(encryptField(ACCOUNT))).toBe(ACCOUNT);
  });

  it("round-trips a legacy AES-CBC value", () => {
    expect(decryptPii(legacyEncrypt(ACCOUNT))).toBe(ACCOUNT);
  });

  it("reads both shapes from one column, which is the whole point", () => {
    const column = [encryptField(ACCOUNT), legacyEncrypt(ACCOUNT), encryptField(PAN)];
    expect(column.map(decryptPii)).toEqual([ACCOUNT, ACCOUNT, PAN]);
  });

  it("rejects a value that is in neither format instead of returning it raw", () => {
    expect(() => decryptPii(ACCOUNT)).toThrow(/matches no known ciphertext format/);
  });

  it("names the format in the diagnostic when a canonical value will not decrypt", () => {
    // A well-formed envelope whose auth tag cannot validate under the loaded key.
    const tampered = JSON.parse(
      Buffer.from(encryptField(ACCOUNT), "base64").toString("utf8"),
    ) as Record<string, string>;
    tampered.tag = "0".repeat(32);
    const corrupt = Buffer.from(JSON.stringify(tampered)).toString("base64");

    expect(detectPiiCiphertextFormat(corrupt)).toBe("gcm_envelope");
    expect(() => decryptPii(corrupt)).toThrow(/FIELD_ENCRYPTION_KEY does not match/);
  });
});

describe("tryDecryptPii", () => {
  it("returns the value and the format it came from", () => {
    expect(tryDecryptPii(encryptField(ACCOUNT))).toEqual({
      ok: true,
      value: ACCOUNT,
      format: "gcm_envelope",
    });
    expect(tryDecryptPii(legacyEncrypt(ACCOUNT))).toMatchObject({
      ok: true,
      value: ACCOUNT,
      format: "legacy_cbc",
    });
  });

  it("distinguishes 'nothing stored' from 'stored but unreadable'", () => {
    const absent = tryDecryptPii(null);
    expect(absent).toMatchObject({ ok: false, reason: "no ciphertext stored" });

    const unreadable = tryDecryptPii("deadbeef");
    expect(unreadable.ok).toBe(false);
    // The caller must be able to tell an incident from an empty field. Both are `ok:false`,
    // so the reason has to carry the difference.
    if (!unreadable.ok) {
      expect(unreadable.reason).not.toBe("no ciphertext stored");
      expect(unreadable.reason).toMatch(/no known ciphertext format/);
    }
  });

  it("never throws, whatever it is handed", () => {
    for (const input of [null, undefined, "", "   ", "x", "a:b", encryptField(ACCOUNT)]) {
      expect(() => tryDecryptPii(input)).not.toThrow();
    }
  });
});
