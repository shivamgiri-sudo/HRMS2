/**
 * The token behind the appointment letter's "Review & Accept" link.
 *
 * Separate from the verification token on purpose. The verification token is
 * printed as a QR on the signed PDF and shown to third parties (a bank, a next
 * employer), so it cannot be rotated without breaking verification of letters
 * already in circulation, and it must not be the key to the accept flow for a
 * letter that has its own accept token.
 *
 * Only the SHA-256 hash is stored, so a leaked table yields no working links —
 * the same rule verify_token_hash and the joining-kit tokens follow.
 */
import { randomBytes, createHash } from "crypto";

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

/** A fresh accept token. The plaintext exists once, in the email that carries it. */
export function mintAcceptToken(): { token: string; tokenHash: string } {
  const token = randomBytes(24).toString("hex");
  return { token, tokenHash: sha256Hex(token) };
}

/** The path the SPA routes (src/config/routes/public.routes.tsx). Keep in step. */
export function acceptUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/employee/appointment-letter/${token}`;
}

/** Anything that cannot be one of our tokens is rejected before it reaches SQL. */
export function looksLikeToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(token);
}
