/**
 * Field-level AES-256-GCM encryption for highly sensitive PII columns.
 *
 * Key management:
 *   FIELD_ENCRYPTION_KEY  — 64-hex-char (32-byte) encryption key (env var)
 *   FIELD_BLIND_INDEX_KEY — 64-hex-char (32-byte) HMAC key for blind indexes (env var)
 *
 * Both keys are required in production.  In non-production environments, deterministic
 * dev keys are substituted so the app starts without additional configuration.
 *
 * Ciphertext format (base64-encoded JSON):
 *   { v: number; iv: string; tag: string; ct: string }
 *   v  — key version (for future rotation)
 *   iv — 12-byte AES-GCM nonce, hex
 *   tag — 16-byte GCM auth tag, hex
 *   ct  — ciphertext, hex
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const DEV_ENCRYPTION_KEY = "0000000000000000000000000000000000000000000000000000000000000000";
const DEV_BLIND_INDEX_KEY = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

function loadKey(envVar: string, devFallback: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `[fieldEncryption] ${envVar} must be set in production (64-hex-char, 32 bytes).`
      );
    }
    return Buffer.from(devFallback, "hex");
  }
  if (raw.length !== 64) {
    throw new Error(`[fieldEncryption] ${envVar} must be exactly 64 hex characters (32 bytes).`);
  }
  return Buffer.from(raw, "hex");
}

// Keys are loaded once at module init — fail fast at startup in production
const encryptionKey = loadKey("FIELD_ENCRYPTION_KEY", DEV_ENCRYPTION_KEY);
const blindIndexKey = loadKey("FIELD_BLIND_INDEX_KEY", DEV_BLIND_INDEX_KEY);

export interface EncryptedField {
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

export function encryptField(plaintext: string, keyVersion = 1): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedField = {
    v: keyVersion,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ct: ct.toString("hex"),
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** The only key version this module can read. `v` is recorded but rotation is unimplemented. */
export const SUPPORTED_KEY_VERSION = 1;

export function decryptField(ciphertext: string): string {
  const payload: EncryptedField = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8"));

  /**
   * Rotation is NOT implemented, despite everything around it implying otherwise: the envelope
   * carries `v`, and employees/legacy_payslip_snapshot carry *_enc_key_version columns. Nothing
   * reads either — there is one key, loaded once at module init, and it is used for every row.
   *
   * So rotating FIELD_ENCRYPTION_KEY does not produce a mixed v1/v2 table that both work; it
   * makes every existing row permanently unreadable. Reads survive only while the legacy
   * plaintext columns are still there, because resolveAccountNumber() swallows the failure and
   * falls back to them — which is exactly the kind of silent survival that hides the damage
   * until the plaintext is dropped.
   *
   * Failing explicitly here turns that into a legible error instead of an opaque GCM auth-tag
   * failure. It changes nothing today: encryptField() writes v1 and every stored row is v1.
   * Implementing real rotation means keeping the old key available and selecting by `v` — a
   * deliberate project, not a config change.
   */
  if (payload.v !== SUPPORTED_KEY_VERSION) {
    throw new Error(
      `[fieldEncryption] ciphertext declares key version ${payload.v}, but only version ` +
      `${SUPPORTED_KEY_VERSION} can be read — key rotation is not implemented.`
    );
  }

  const iv = Buffer.from(payload.iv, "hex");
  const tag = Buffer.from(payload.tag, "hex");
  const ct = Buffer.from(payload.ct, "hex");
  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Blind index for exact-match lookup without exposing plaintext. */
export function blindIndex(plaintext: string): string {
  return createHmac("sha256", blindIndexKey).update(plaintext, "utf8").digest("hex");
}

export interface KeyParityResult {
  sampled: number;
  decrypted: number;
  ok: boolean;
}

/**
 * Verify that the key currently loaded can read ciphertext that is ALREADY stored.
 *
 * Why this exists: loadKey() throws only when NODE_ENV === "production". Anywhere else it
 * silently substitutes DEV_ENCRYPTION_KEY (all zeros). A backfill run from a dev machine against
 * a production database therefore encrypts real rows with a key production cannot read — and
 * reports success, because nothing in the write path ever attempts a decrypt.
 *
 * The damage stays invisible afterwards: resolveAccountNumber() swallows the decrypt failure and
 * falls back to the legacy plaintext column, so reads keep working until that column is dropped,
 * at which point the affected rows are unrecoverable.
 *
 * Callers that write encrypted columns in bulk MUST gate on this and refuse to proceed when
 * ok === false. Requires every sample to decrypt: a partial pass means mixed keys, which is a
 * worse problem than a uniformly wrong one, not a lesser one.
 */
export function checkKeyParity(ciphertexts: string[]): KeyParityResult {
  let decrypted = 0;
  for (const ct of ciphertexts) {
    try {
      decryptField(ct);
      decrypted++;
    } catch {
      /* counted as a failure below */
    }
  }
  return {
    sampled: ciphertexts.length,
    decrypted,
    ok: ciphertexts.length > 0 && decrypted === ciphertexts.length,
  };
}

/** True when the process is running on the built-in all-zeros development key. */
export function isUsingDevEncryptionKey(): boolean {
  return encryptionKey.equals(Buffer.from(DEV_ENCRYPTION_KEY, "hex"));
}

/**
 * True when the process is running on the built-in development blind-index key.
 *
 * checkKeyParity() cannot cover this one. A blind index is a one-way HMAC, so there is nothing
 * to decrypt and compare against — and the columns start empty, so there is no existing value to
 * check a candidate key against either. The only available signal is whether the key is the dev
 * fallback.
 *
 * This matters more than it looks. An index written with the wrong key is not detectably wrong:
 * every lookup simply returns no rows. For the duplicate-employee guard that reads as "no
 * duplicate exists", so the guard would pass everything and silently reopen the hole it was
 * written to close. Any bulk writer of a blind-index column must refuse to run when this is true.
 */
export function isUsingDevBlindIndexKey(): boolean {
  return blindIndexKey.equals(Buffer.from(DEV_BLIND_INDEX_KEY, "hex"));
}

/**
 * Resolve account_number from a bank detail row that may be in the encrypted
 * column (account_number_enc), the legacy plaintext varbinary (account_number),
 * or neither. Returns null when no usable value is present.
 *
 * Used by all payroll/NEFT read paths so they transparently handle both
 * pre-backfill (plaintext) and post-backfill (encrypted) rows.
 */
export function resolveAccountNumber(row: {
  account_number_enc?: string | null;
  account_number?: Buffer | string | null;
}): string | null {
  if (row.account_number_enc) {
    try { return decryptField(row.account_number_enc); } catch { /* fall through */ }
  }
  if (row.account_number) {
    return Buffer.isBuffer(row.account_number)
      ? row.account_number.toString("utf8")
      : String(row.account_number);
  }
  return null;
}

export type AccountSourceStatus =
  | "ok"               // single source, usable value
  | "conflict"         // both sources present and decode to different values
  | "missing"          // no usable value in either source
  | "encrypt_only"     // encrypted source only (no legacy column)
  | "legacy_only";     // legacy source only (no encrypted column)

export interface AccountResolution {
  resolved: string | null;
  status: AccountSourceStatus;
  encValue: string | null;
  legacyValue: string | null;
}

/**
 * Resolve account_number with full source-conflict visibility.
 *
 * Unlike resolveAccountNumber(), this variant decodes both sources independently
 * and compares them. When both are present but differ it returns status='conflict'
 * so the bank-exception-report endpoint can enumerate the 6 known conflicts rather
 * than silently selecting the encrypted value.
 */
export function resolveAccountNumberWithConflict(row: {
  account_number_enc?: string | null;
  account_number?: Buffer | string | null;
}): AccountResolution {
  let encValue: string | null = null;
  if (row.account_number_enc) {
    try { encValue = decryptField(row.account_number_enc); } catch { /* decrypt failed */ }
  }

  let legacyValue: string | null = null;
  if (row.account_number) {
    legacyValue = Buffer.isBuffer(row.account_number)
      ? row.account_number.toString("utf8")
      : String(row.account_number);
  }

  const hasEnc = encValue !== null && encValue !== "";
  const hasLegacy = legacyValue !== null && legacyValue !== "";

  if (!hasEnc && !hasLegacy) {
    return { resolved: null, status: "missing", encValue: null, legacyValue: null };
  }
  if (hasEnc && hasLegacy) {
    if (encValue !== legacyValue) {
      return { resolved: encValue, status: "conflict", encValue, legacyValue };
    }
    return { resolved: encValue, status: "ok", encValue, legacyValue };
  }
  if (hasEnc) {
    return { resolved: encValue, status: "encrypt_only", encValue, legacyValue: null };
  }
  return { resolved: legacyValue, status: "legacy_only", encValue: null, legacyValue };
}
