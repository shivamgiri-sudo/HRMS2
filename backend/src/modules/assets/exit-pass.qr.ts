import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'crypto';
import { env } from '../../config/env.js';

/**
 * Gate QR token for the Asset & Material Exit Pass (Phase 4, migration 1633).
 *
 * WHAT THIS TOKEN IS: proof that the PHYSICAL PRINTED PASS was presented at the
 * gate, so 'qr' in exit_pass_requests.exit_verification_method means something
 * a guard could not have produced by typing a number read off a WhatsApp
 * screenshot.
 *
 * WHAT IT IS NOT: an authorization credential. Every verify path still runs
 * requireAuth, still requires a security/admin role, and still requires
 * status='approved' (see verifyExit). Holding a token grants nothing on its
 * own — it only selects WHICH pass an already-authorised guard is acting on,
 * exactly as typing the pass number does. Do not add an unauthenticated route
 * that accepts this token.
 *
 * DERIVED, NOT STORED. The token is recomputed from the pass id on demand;
 * only its sha256 hash is columned (qr_token_hash). Two consequences worth
 * keeping straight:
 *  - A reprint yields the SAME QR, which is why derivation is used at all. The
 *    visitor module can store a hash and nothing else (409_visitor_management_
 *    foundation.sql) because its raw token is emailed to the visitor once; a
 *    gate pass gets reprinted, and a one-way-only token would make every
 *    reprint's QR dead on arrival.
 *  - A DB read or a leaked backup yields no working token, which is the
 *    property visitor.security.test.ts pins for tracking_token and the reason
 *    the raw value is not columned here either.
 *
 * SINGLE USE comes free from the existing state machine, not from this file:
 * verifying an exit moves status off 'approved', so re-scanning the same QR
 * resolves to verdict 'already_used'. There is no counter to maintain.
 */

/** Bumping this invalidates every printed QR — it changes the HMAC message. */
const TOKEN_VERSION = 'v1';

/**
 * HKDF `info` label. Domain separation lives here: changing this string yields
 * a completely unrelated key from the same JWT_SECRET, which is what stops a
 * gate token from having any relationship to a session token.
 */
const HKDF_INFO = 'hrms2/exit-pass-qr/v1';

/**
 * 16 bytes of a SHA-256 HMAC = 128 bits, base64url-encoded to 22 chars.
 *
 * Truncation is deliberate and is about SCANNABILITY, not laziness: the QR
 * encodes a full verify URL, and the token is the only variable-length part of
 * it. Measured against the real payload at error-correction level M, 16 bytes
 * keeps the symbol at version 5 (77 chars, 37 modules/side); 32 bytes takes it
 * to version 6 (98 chars, 41 modules), shrinking each module by ~10% at the
 * same printed size. The pass prints the QR at 88px ≈ 23mm, so version 5 gives
 * ~0.63mm per module against ~0.57mm — the margin a cheap gate-terminal camera
 * reads at arm's length, and the same density trade-off qrCode.api.ts's
 * compactPeriod() comment documents for payslip QRs.
 *
 * 128 bits is far past guessable, especially for a value that is useless on its
 * own without an authenticated security session.
 */
const TOKEN_BYTES = 16;

/**
 * Memoised: HKDF on every print/scan is pointless work, and env is immutable
 * for the life of the process. Not exported — nothing outside this file has a
 * reason to hold the raw key.
 */
let cachedSecret: Buffer | null = null;

function qrSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  if (env.EXIT_PASS_QR_SECRET) {
    cachedSecret = Buffer.from(env.EXIT_PASS_QR_SECRET, 'utf8');
  } else {
    // Empty salt is correct for HKDF when the IKM is already a high-entropy
    // secret; the `info` label carries the domain separation. See the
    // EXIT_PASS_QR_SECRET comment in config/env.ts for why falling back to
    // JWT_SECRET here is safe rather than the secret-sharing bug that comment
    // warns about.
    cachedSecret = Buffer.from(
      hkdfSync('sha256', Buffer.from(env.JWT_SECRET, 'utf8'), Buffer.alloc(0), Buffer.from(HKDF_INFO, 'utf8'), 32),
    );
  }
  return cachedSecret;
}

/**
 * The token printed into a pass's QR. Stable for a given pass id — a reprint
 * produces a byte-identical QR.
 */
export function deriveQrToken(passId: string): string {
  return createHmac('sha256', qrSecret())
    .update(`exitpass:${TOKEN_VERSION}:${passId}`)
    .digest()
    .subarray(0, TOKEN_BYTES)
    .toString('base64url');
}

/** sha256 hex — the only form that reaches the database. CHAR(64) in 1633. */
export function qrTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two token hashes.
 *
 * The primary lookup is an indexed WHERE on qr_token_hash, which is not
 * constant-time — that is accepted, because a timing oracle on an indexed
 * equality search leaks at most "some hash starting with X exists", and the
 * hash is not the secret (the token is, and it is never stored). This helper
 * exists for the belt-and-braces re-check after a row is fetched, so a future
 * change that swaps the query for a scan-and-compare cannot quietly introduce
 * a string=== on a credential.
 */
export function qrTokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Cheap shape guard before touching the DB. A scanned value that is not 22
 * base64url chars cannot be one of our tokens, so it is rejected without a
 * query — this is what keeps a camera pointed at an unrelated barcode (a
 * courier label, an asset sticker) from generating database load.
 */
export function looksLikeQrToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}
