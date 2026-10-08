import crypto from "crypto";
import { env } from "../../config/env.js";

/**
 * Short-lived, filename-scoped signed tokens for viewing one employee photo
 * without a Bearer session token — e.g. the public employee-verify page,
 * which has no logged-in user to attach an Authorization header for.
 *
 * Stateless (HMAC, no DB row) so it's cheap to mint/verify repeatedly for a
 * page that may re-request the image a few times. Scoped to one exact
 * filename so a leaked token can never be replayed against another
 * employee's photo, and it self-expires — unlike the Bearer-token path
 * (files.routes.ts `/employee-photos/:filename`), which stays the only way
 * to view an *arbitrary* photo and is what every in-app authenticated
 * display should keep using.
 */
const SECRET = env.JWT_SECRET;
const DEFAULT_TTL_SECONDS = 15 * 60; // long enough for someone to view a verify page

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function signPhotoAccessToken(filename: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const expires = Date.now() + ttlSeconds * 1000;
  const signature = sign(`${filename}.${expires}`);
  return `${expires}.${signature}`;
}

export function verifyPhotoAccessToken(filename: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const dotIndex = token.indexOf(".");
  if (dotIndex < 0) return false;
  const expiresStr = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  if (!expiresStr || !signature) return false;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  const expected = sign(`${filename}.${expires}`);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
