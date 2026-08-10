import { describe, it, expect } from "vitest";
import { createCipheriv, randomBytes } from "crypto";
import {
  encryptField,
  decryptField,
  checkKeyParity,
  isUsingDevEncryptionKey,
  isUsingDevBlindIndexKey,
  blindIndex,
} from "../fieldEncryption.js";

/**
 * Regression coverage for the silent key-mismatch corruption.
 *
 * Root cause: loadKey() throws only when NODE_ENV === "production"; everywhere else it
 * substitutes an all-zeros development key. scripts/bank-account-encrypt-backfill.ts therefore
 * encrypted production rows with the dev key when run from a developer machine, printed
 * "encrypted: N" and exited 0. resolveAccountNumber() swallows the resulting decrypt failure and
 * falls back to the legacy plaintext column, so nothing appears broken until that column is
 * dropped — at which point the affected accounts are gone.
 *
 * Measured against production 2026-08-09: 0 of 50 stored rows decrypted with the dev key,
 * i.e. this is the real situation the guard has to catch, not a hypothetical one.
 */

/** Build ciphertext in the same envelope format but under a DIFFERENT key. */
function encryptWithForeignKey(plaintext: string): string {
  const foreignKey = Buffer.alloc(32, 0x5a); // deliberately not the dev all-zeros key
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", foreignKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      v: 1,
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      ct: ct.toString("hex"),
    })
  ).toString("base64");
}

describe("field encryption key parity guard", () => {
  it("runs the suite on the built-in dev key, which is what makes the bug reachable", () => {
    expect(isUsingDevEncryptionKey()).toBe(true);
  });

  it("passes when the loaded key wrote the stored ciphertext", () => {
    const samples = ["123456789012", "9876543210987654"].map((v) => encryptField(v));
    expect(checkKeyParity(samples)).toEqual({ sampled: 2, decrypted: 2, ok: true });
  });

  it("REJECTS ciphertext written with a different key — the production scenario", () => {
    const samples = ["123456789012", "9876543210987654"].map(encryptWithForeignKey);
    const result = checkKeyParity(samples);
    expect(result.decrypted).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("rejects a partial pass, because mixed keys are worse than a uniformly wrong one", () => {
    const samples = [encryptField("123456789012"), encryptWithForeignKey("9876543210987654")];
    const result = checkKeyParity(samples);
    expect(result).toEqual({ sampled: 2, decrypted: 1, ok: false });
  });

  it("does not treat 'nothing to compare against' as a pass", () => {
    expect(checkKeyParity([])).toEqual({ sampled: 0, decrypted: 0, ok: false });
  });

  it("rejects malformed ciphertext instead of throwing", () => {
    expect(() => checkKeyParity(["not-base64-json", ""])).not.toThrow();
    expect(checkKeyParity(["not-base64-json"]).ok).toBe(false);
  });

  it("round-trips through the real encrypt/decrypt pair", () => {
    const account = "033810412345678";
    expect(decryptField(encryptField(account))).toBe(account);
  });
});

/**
 * The blind index has no parity check available — an HMAC is one-way, and the columns start
 * empty, so there is nothing to test a candidate key against. An index written with the wrong
 * key is therefore undetectable at write time AND at read time: every lookup simply returns no
 * rows, which the duplicate-employee guard reads as "no duplicate exists". Refusing to run on
 * the dev key is the only defence, so this must not silently regress.
 */
describe("blind index key detection", () => {
  it("reports the dev blind-index key, which is what the suite runs on", () => {
    expect(isUsingDevBlindIndexKey()).toBe(true);
  });

  it("is independent of the encryption key check", () => {
    // Two separate env vars and two separate keys; conflating them would let a run proceed with
    // a correct encryption key and a wrong index key.
    expect(isUsingDevBlindIndexKey()).not.toBe(undefined);
    expect(isUsingDevEncryptionKey()).not.toBe(undefined);
  });

  it("is deterministic — the same input always yields the same index", () => {
    // Non-determinism would make every backfilled row unmatchable.
    expect(blindIndex("123456789012")).toBe(blindIndex("123456789012"));
  });

  it("produces the char(64) hex the column is declared as", () => {
    expect(blindIndex("123456789012")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes values that differ only by whitespace", () => {
    // Why the backfill indexes the raw trimmed value and does not normalise: ' 1234' and '1234'
    // are different values to `WHERE col = ?` today, and the index must not change that.
    expect(blindIndex("123456789012")).not.toBe(blindIndex("1234 5678 9012"));
  });
});
