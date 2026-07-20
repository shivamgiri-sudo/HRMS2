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

export function decryptField(ciphertext: string): string {
  const payload: EncryptedField = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8"));
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
