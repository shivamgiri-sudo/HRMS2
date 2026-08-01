import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { encrypt, decrypt } from "../src/utils/encryption.js";

/**
 * The key derivation in utils/encryption.ts guards bank account numbers and PAN.
 * These tests pin the two properties that were missing and one that must not
 * regress.
 *
 * Keys are read inside each call rather than at module load, so mutating
 * process.env between cases is enough — no vi.resetModules() dance required.
 */

const ORIGINAL = {
  bank: process.env.BANK_ENCRYPTION_KEY,
  jwt: process.env.JWT_SECRET,
};

function setKeys(bank?: string, jwt?: string) {
  if (bank === undefined) delete process.env.BANK_ENCRYPTION_KEY;
  else process.env.BANK_ENCRYPTION_KEY = bank;
  if (jwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwt;
}

beforeEach(() => setKeys(undefined, undefined));

afterAll(() => {
  if (ORIGINAL.bank === undefined) delete process.env.BANK_ENCRYPTION_KEY;
  else process.env.BANK_ENCRYPTION_KEY = ORIGINAL.bank;
  if (ORIGINAL.jwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL.jwt;
});

describe("field encryption key derivation", () => {
  it("refuses to encrypt when no key is configured", () => {
    // Previously this fell through to sha256("") — a fixed key any reader of the
    // source can derive. Silent success was the dangerous outcome, not failure.
    expect(() => encrypt("123456789012")).toThrow(/unconfigured/i);
    expect(() => decrypt("00:00")).toThrow(/unconfigured/i);
  });

  it("treats a whitespace-only key as absent rather than as key material", () => {
    setKeys("   ", undefined);
    expect(() => encrypt("123456789012")).toThrow(/unconfigured/i);
  });

  it("round-trips with only JWT_SECRET set, as production does today", () => {
    setKeys(undefined, "legacy-secret-value");
    expect(decrypt(encrypt("123456789012"))).toBe("123456789012");
  });

  it("round-trips with a dedicated BANK_ENCRYPTION_KEY", () => {
    setKeys("dedicated-bank-key", "legacy-secret-value");
    expect(decrypt(encrypt("987654321098"))).toBe("987654321098");
  });
});

describe("key rotation must not orphan stored values", () => {
  it("still reads data written under JWT_SECRET after BANK_ENCRYPTION_KEY is introduced", () => {
    // This is the exact scenario that broke nine connectors for a month: values
    // written under one key, read back after the key changed.
    setKeys(undefined, "legacy-secret-value");
    const stored = encrypt("123456789012");

    setKeys("dedicated-bank-key", "legacy-secret-value");
    expect(decrypt(stored)).toBe("123456789012");
  });

  it("writes new values under the primary key, not the legacy one", () => {
    setKeys("dedicated-bank-key", "legacy-secret-value");
    const fresh = encrypt("555555555555");

    // Drop the legacy key entirely — a value written under the primary must
    // survive, proving encrypt() did not quietly keep using JWT_SECRET.
    setKeys("dedicated-bank-key", undefined);
    expect(decrypt(fresh)).toBe("555555555555");
  });

  it("reports honestly when no configured key can read the value", () => {
    setKeys(undefined, "legacy-secret-value");
    const stored = encrypt("123456789012");

    setKeys("a-completely-different-key", undefined);
    expect(() => decrypt(stored)).toThrow(/Unable to decrypt with any configured key/);
  });
});
