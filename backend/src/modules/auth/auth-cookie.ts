/**
 * HttpOnly Refresh Token Cookie Management
 *
 * SECURITY: Refresh tokens must never be accessible to browser JavaScript.
 * This module provides utilities for setting and clearing httpOnly cookies.
 */

import type { Response, Request } from "express";
import { env } from "../../config/env.js";

// Cookie configuration
const REFRESH_TOKEN_COOKIE_NAME = "hrms_refresh";
const REFRESH_TOKEN_PATH = "/api/auth"; // Limit cookie to auth endpoints only
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Determine if we're in a production-like environment
 * Secure cookies require HTTPS
 */
function isSecureContext(): boolean {
  return env.NODE_ENV === "production" || process.env.FORCE_SECURE_COOKIES === "true";
}

/**
 * Get the cookie domain from environment or derive from frontend URL
 */
function getCookieDomain(): string | undefined {
  // Explicit domain override
  if (process.env.COOKIE_DOMAIN) {
    return process.env.COOKIE_DOMAIN;
  }

  // In production, extract domain from FRONTEND_URL if set
  if (env.NODE_ENV === "production" && env.FRONTEND_URL) {
    try {
      const url = new URL(env.FRONTEND_URL);
      // Return domain without leading dot for most browsers
      return url.hostname;
    } catch {
      // Invalid URL, don't set domain
      return undefined;
    }
  }

  // Development: don't set domain (allows localhost)
  return undefined;
}

export interface RefreshTokenCookieOptions {
  maxAgeMs?: number;
}

/**
 * Set the refresh token as an httpOnly cookie.
 *
 * Cookie attributes:
 * - HttpOnly: Prevents JavaScript access (XSS protection)
 * - Secure: Only sent over HTTPS in production
 * - SameSite=Lax: Prevents CSRF while allowing navigation
 * - Path=/api/auth: Limits cookie to auth endpoints
 * - Controlled expiration matching server-side token lifetime
 */
export function setRefreshTokenCookie(
  res: Response,
  refreshToken: string,
  options?: RefreshTokenCookieOptions
): void {
  const maxAge = options?.maxAgeMs ?? REFRESH_TOKEN_MAX_AGE_MS;
  const secure = isSecureContext();
  const domain = getCookieDomain();

  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: REFRESH_TOKEN_PATH,
    maxAge,
    ...(domain ? { domain } : {}),
  });
}

/**
 * Clear the refresh token cookie.
 * Used on logout, password change, and session revocation.
 */
export function clearRefreshTokenCookie(res: Response): void {
  const secure = isSecureContext();
  const domain = getCookieDomain();

  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: REFRESH_TOKEN_PATH,
    ...(domain ? { domain } : {}),
  });
}

/**
 * Extract refresh token from httpOnly cookie.
 * Falls back to request body for backward compatibility during transition.
 *
 * SECURITY: After transition period, remove body fallback to enforce cookie-only.
 */
export function getRefreshTokenFromRequest(req: Request): string | null {
  // Primary: httpOnly cookie (secure)
  const cookieToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  if (cookieToken && typeof cookieToken === "string") {
    return cookieToken;
  }

  // Fallback: request body (legacy - to be removed after transition)
  // TODO: Remove this fallback after all clients migrate to cookie-based refresh
  const bodyToken = req.body?.refreshToken;
  if (bodyToken && typeof bodyToken === "string") {
    console.warn("[auth-cookie] Legacy refresh token in body - client should migrate to cookies");
    return bodyToken;
  }

  return null;
}

/**
 * Check if refresh token is using legacy body transport.
 * Used for migration metrics and enforcement.
 */
export function isLegacyRefreshTokenTransport(req: Request): boolean {
  const hasBodyToken = req.body?.refreshToken && typeof req.body.refreshToken === "string";
  const hasCookieToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] && typeof req.cookies[REFRESH_TOKEN_COOKIE_NAME] === "string";

  return hasBodyToken && !hasCookieToken;
}

/**
 * Cookie name constant for tests and debugging
 */
export const COOKIE_NAME = REFRESH_TOKEN_COOKIE_NAME;
