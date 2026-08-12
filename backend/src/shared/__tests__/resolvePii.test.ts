import { describe, it, expect, beforeAll } from "vitest";
import { encryptField } from "../fieldEncryption.js";
import { encrypt as legacyEncrypt } from "../../utils/encryption.js";
import { resolvePii } from "../piiCiphertext.js";

/**
 * The reader-migration primitive.
 *
 * employees.aadhaar_number and pan_number are at 100% ciphertext coverage, but plaintext is
 * still what the application reads — so nothing is protected yet. Migrating 75 read sites to
 * prefer ciphertext is what makes retiring those columns possible, and retiring them is the
 * only step that actually satisfies DPDP.
 *
 * `source` is the part that matters beyond correctness. Once every reader reports which column
 * it used, "does anything still need the plaintext?" becomes measurable rather than a
 * judgement call — and that measurement is the gate on a destructive schema change.
 */

beforeAll(() => {
  process.env.BANK_ENCRYPTION_KEY ??= "resolve-pii-test-key";
});

const AADHAAR = "123456789012";

describe("resolvePii prefers ciphertext", () => {
  it("reads the encrypted column when it is present and valid", () => {
    const out = resolvePii(encryptField(AADHAAR), "plaintext-should-not-win");
    expect(out.value).toBe(AADHAAR);
    expect(out.source).toBe("ciphertext");
    expect(out.warning).toBeUndefined();
  });

  it("reads legacy AES-CBC ciphertext too, so mixed columns resolve", () => {
    const out = resolvePii(legacyEncrypt(AADHAAR), null);
    expect(out.value).toBe(AADHAAR);
    expect(out.source).toBe("ciphertext");
  });

  it("falls back to plaintext while the migration is in flight", () => {
    const out = resolvePii(null, AADHAAR);
    expect(out.value).toBe(AADHAAR);
    expect(out.source).toBe("plaintext");
    expect(out.warning).toBeUndefined();
  });

  it("reports 'none' rather than an empty string when neither exists", () => {
    for (const [c, p] of [[null, null], [undefined, undefined], ["", "   "]] as const) {
      const out = resolvePii(c, p);
      expect(out.value).toBeNull();
      expect(out.source).toBe("none");
    }
  });
});

describe("an unreadable ciphertext is never silent", () => {
  it("warns when it falls back, instead of hiding the failure", () => {
    // This is the exact shape that hid the dev-key corruption: reads kept working off the
    // plaintext, so nothing looked wrong until the plaintext was dropped.
    const out = resolvePii("deadbeef-not-ciphertext", AADHAAR);
    expect(out.value).toBe(AADHAAR);
    expect(out.source).toBe("plaintext");
    expect(out.warning).toMatch(/unreadable/);
    expect(out.warning).toMatch(/fell back to plaintext/);
  });

  it("warns when there is nothing to fall back to", () => {
    const out = resolvePii("deadbeef-not-ciphertext", null);
    expect(out.value).toBeNull();
    expect(out.source).toBe("none");
    expect(out.warning).toMatch(/no plaintext to fall back to/);
  });

  it("warns on a well-formed envelope that will not decrypt", () => {
    const tampered = JSON.parse(Buffer.from(encryptField(AADHAAR), "base64").toString("utf8")) as Record<string, string>;
    tampered.tag = "0".repeat(32);
    const corrupt = Buffer.from(JSON.stringify(tampered)).toString("base64");

    const out = resolvePii(corrupt, AADHAAR);
    expect(out.source).toBe("plaintext");
    expect(out.warning).toMatch(/FIELD_ENCRYPTION_KEY does not match/);
  });

  it("never throws — these sit on read paths that must keep working", () => {
    for (const c of [null, undefined, "", "x", "a:b", "deadbeef"]) {
      expect(() => resolvePii(c, AADHAAR)).not.toThrow();
    }
  });
});

describe("source is usable as a retirement gate", () => {
  it("distinguishes the three cases a migration audit needs to count", () => {
    const sources = [
      resolvePii(encryptField(AADHAAR), AADHAAR).source,
      resolvePii(null, AADHAAR).source,
      resolvePii(null, null).source,
    ];
    // If a production sweep of these reports zero "plaintext", the column is unused and can go.
    expect(sources).toEqual(["ciphertext", "plaintext", "none"]);
  });
});
