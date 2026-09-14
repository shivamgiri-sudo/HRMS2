/**
 * At-rest crypto columns must not appear in API responses.
 *
 * Ciphertext, blind indexes, lookup hashes and key-version markers are storage internals.
 * They exist so the database can hold a value safely and still be searched; no client has
 * any use for them, and every one of them is a liability in a response body:
 *
 *   *_encrypted / *_enc   ciphertext. Handing it out converts an at-rest protection into
 *                         an offline attack that runs on someone else's machine, against
 *                         a key that is never rotated (rotation is unimplemented — see
 *                         shared/fieldEncryption.ts).
 *   *_hash                unsalted SHA-256 of the value in this codebase. For a 12-digit
 *                         Aadhaar or a bank account the whole keyspace is enumerable, so
 *                         the hash is the value.
 *   *_blind_index         same, keyed — but it is still a stable handle that links the
 *                         same person across records.
 *   *_key_version         tells an attacker which key to target and nothing useful to a client.
 *
 * This module is deliberately separate from the role-based field policies. Whether a given
 * role may see a PAN is a business decision that differs per resource; whether anyone may
 * see the PAN's ciphertext is not a decision at all. Keeping the two apart means the second
 * rule can be applied everywhere without re-litigating the first.
 *
 * Verified before adopting: no frontend code references any *_encrypted, *_hash,
 * *_blind_index or *_key_version column.
 */

/**
 * Suffixes that mark a column as storage-internal.
 *
 * `_masked` and `_last4` are deliberately absent — those are pre-computed SAFE renderings
 * and are frequently the only thing a UI should show. Stripping them would push callers
 * back to the raw column, which is the opposite of the intent.
 */
export const CRYPTO_PLUMBING_PATTERN = /(_encrypted|_enc|_blind_index|_key_version|_hash)$/;

/** True when this column name is storage plumbing rather than data a client should see. */
export function isCryptoPlumbingColumn(column: string): boolean {
  return CRYPTO_PLUMBING_PATTERN.test(column);
}

/**
 * Return a copy of `record` with every at-rest crypto column removed.
 *
 * Null and undefined pass through unchanged so this can wrap an optional row
 * (`stripCryptoPlumbing(rows[0] ?? null)`) without the caller adding a guard — the common
 * shape at these call sites, and a guard that is easy to forget is a guard that will be.
 */
export function stripCryptoPlumbing<T extends Record<string, unknown>>(record: T): Record<string, unknown>;
export function stripCryptoPlumbing(record: null | undefined): null;
export function stripCryptoPlumbing(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (record == null) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isCryptoPlumbingColumn(key)) continue;
    out[key] = value;
  }
  return out;
}
