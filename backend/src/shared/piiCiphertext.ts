/**
 * Format-aware decryption for PII columns that hold more than one ciphertext shape.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Two independent encryption helpers write PII in this codebase, and at least one
 * column receives both:
 *
 *   shared/fieldEncryption.ts  AES-256-GCM, dedicated FIELD_ENCRYPTION_KEY,
 *                              stored as base64(JSON {v,iv,tag,ct}) — the canonical
 *                              DPDP path. Used by employees.*_encrypted,
 *                              legacy_payslip_snapshot.account_number_enc,
 *                              employee_bank_detail.account_number_enc, and by
 *                              scripts/statutory-identifier-encrypt-backfill.ts.
 *
 *   utils/encryption.ts        AES-256-CBC, key = sha256(BANK_ENCRYPTION_KEY || JWT_SECRET),
 *                              stored as "<ivhex>:<cthex>". Used by the ATS onboarding
 *                              bank-detail write path.
 *
 * `ats_candidate.bank_account_no_encrypted` holds 49 rows in the legacy CBC shape,
 * written by the onboarding flow. The DPDP backfill fills the remaining ~31,142 in the
 * canonical GCM shape. Neither helper can read the other's output: the CBC reader splits
 * on ":" and rejects a GCM envelope as "Invalid encrypted format", and the GCM reader
 * fails base64/JSON parsing on a CBC string.
 *
 * Without a resolver the column is unreadable for whichever half the caller was not
 * written for — and because the existing call sites catch and continue, that surfaces as
 * a silently absent bank account rather than an error. This module makes the format an
 * explicit, tested decision instead of an accident of which helper ran first.
 *
 * ── THE TWO SHAPES ARE UNAMBIGUOUS ───────────────────────────────────────────
 * A legacy value always contains ":", which is not in the base64 alphabet, so it can
 * never be a GCM envelope. A GCM envelope is base64 of a JSON object and always begins
 * "eyJ" ('{"'). Detection needs no stored discriminator column.
 *
 * ── FAILURE IS REPORTED, NOT SWALLOWED ───────────────────────────────────────
 * decryptPii() throws with a diagnostic naming the detected format. tryDecryptPii()
 * returns a discriminated result so a caller that must not fail hard can still record
 * *why* a value is unavailable, instead of treating "could not decrypt" and "no value
 * stored" as the same thing. Those two are not the same thing: the first is an incident.
 */

import { decryptField } from "./fieldEncryption.js";
import { decrypt as decryptLegacyCbc } from "../utils/encryption.js";

export type PiiCiphertextFormat = "gcm_envelope" | "legacy_cbc" | "unrecognised";

/** 16-byte IV rendered as 32 hex chars, then ":", then at least one AES block of hex. */
const LEGACY_CBC_SHAPE = /^[0-9a-f]{32}:[0-9a-f]+$/i;

/**
 * Classify a stored ciphertext by shape alone — no key material is touched, so this is
 * safe to call on a machine that holds neither key (a schema audit, a coverage report).
 */
export function detectPiiCiphertextFormat(value: string): PiiCiphertextFormat {
  const trimmed = value.trim();
  if (!trimmed) return "unrecognised";
  if (LEGACY_CBC_SHAPE.test(trimmed)) return "legacy_cbc";

  // A GCM envelope must base64-decode to a JSON object carrying all four fields. Checking
  // the fields rather than just "is it base64" keeps an arbitrary base64 blob from being
  // reported as canonical ciphertext and then failing later with an opaque error.
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.v === "number" &&
      typeof parsed.iv === "string" &&
      typeof parsed.tag === "string" &&
      typeof parsed.ct === "string"
    ) {
      return "gcm_envelope";
    }
  } catch {
    /* not a GCM envelope — fall through */
  }
  return "unrecognised";
}

export type PiiDecryptResult =
  | { ok: true; value: string; format: PiiCiphertextFormat }
  | { ok: false; reason: string; format: PiiCiphertextFormat };

/**
 * Decrypt a stored PII ciphertext of either supported shape.
 *
 * Throws when the value cannot be read. The message names the detected format, because
 * the two failure causes need different responses: a `gcm_envelope` failure means the
 * process is holding the wrong FIELD_ENCRYPTION_KEY, while a `legacy_cbc` failure means
 * BANK_ENCRYPTION_KEY/JWT_SECRET has been rotated without keeping the old value.
 */
export function decryptPii(ciphertext: string): string {
  const format = detectPiiCiphertextFormat(ciphertext);
  const value = ciphertext.trim();

  switch (format) {
    case "gcm_envelope":
      try {
        return decryptField(value);
      } catch (error) {
        throw new Error(
          "[piiCiphertext] canonical (AES-GCM) ciphertext failed to decrypt — the loaded " +
            "FIELD_ENCRYPTION_KEY does not match the key it was written with. " +
            `(${error instanceof Error ? error.message : String(error)})`,
        );
      }
    case "legacy_cbc":
      try {
        return decryptLegacyCbc(value);
      } catch (error) {
        throw new Error(
          "[piiCiphertext] legacy (AES-CBC) ciphertext failed to decrypt — BANK_ENCRYPTION_KEY " +
            "or JWT_SECRET has changed and the original is no longer configured. " +
            `(${error instanceof Error ? error.message : String(error)})`,
        );
      }
    default:
      throw new Error(
        "[piiCiphertext] value matches no known ciphertext format (neither a base64 AES-GCM " +
          "envelope nor '<ivhex>:<cthex>'). It may be plaintext stored in an encrypted column.",
      );
  }
}

/**
 * Non-throwing variant for read paths that must degrade rather than fail.
 *
 * Callers must still surface `reason` — an unreadable ciphertext is an incident, and
 * reporting it as an absent value is how the two get confused.
 */
export type PiiSource = "ciphertext" | "plaintext" | "none";

export interface ResolvedPii {
  value: string | null;
  source: PiiSource;
  /**
   * Set when ciphertext existed but could not be read, and the plaintext was used instead.
   *
   * This is the field that makes the fallback safe to ship. resolveAccountNumber() in
   * fieldEncryption.ts swallows the same failure silently, and its own comment explains what
   * that cost: a backfill run with the dev key produced unreadable ciphertext, reads kept
   * working off the plaintext, and the damage stayed invisible until the plaintext was dropped.
   * A caller that ignores this field is no worse off than today; a caller that logs it finds
   * out before retirement rather than after.
   */
  warning?: string;
}

/**
 * Read a PII value that exists in both an encrypted and a plaintext column.
 *
 * Prefers ciphertext, falls back to plaintext, and says which it used. That ordering is the
 * whole point of the reader migration: once every reader prefers ciphertext and reports its
 * source, "does anything still need the plaintext column?" becomes a measurable question
 * instead of a judgement call — and the answer is what makes retiring the column safe.
 *
 * Deliberately does NOT throw. These sit on read paths that must keep working while both
 * columns exist; the diagnostic goes in `warning`, not in an exception.
 */
export function resolvePii(
  ciphertext: string | null | undefined,
  plaintext: string | null | undefined,
): ResolvedPii {
  const plain = typeof plaintext === "string" && plaintext.trim() !== "" ? plaintext : null;

  const hasCipher = typeof ciphertext === "string" && ciphertext.trim() !== "";
  if (hasCipher) {
    const attempt = tryDecryptPii(ciphertext);
    if (attempt.ok) return { value: attempt.value, source: "ciphertext" };
    return {
      value: plain,
      source: plain ? "plaintext" : "none",
      warning:
        `ciphertext present but unreadable (${attempt.reason}); ` +
        (plain ? "fell back to plaintext" : "no plaintext to fall back to"),
    };
  }

  return plain ? { value: plain, source: "plaintext" } : { value: null, source: "none" };
}

export function tryDecryptPii(ciphertext: string | null | undefined): PiiDecryptResult {
  const value = typeof ciphertext === "string" ? ciphertext.trim() : "";
  if (!value) {
    return { ok: false, reason: "no ciphertext stored", format: "unrecognised" };
  }
  const format = detectPiiCiphertextFormat(value);
  try {
    return { ok: true, value: decryptPii(value), format };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      format,
    };
  }
}
