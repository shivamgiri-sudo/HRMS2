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
 * Get the cookie domain from explicit configuration only.
 *
 * SECURITY: Do NOT derive domain from FRONTEND_URL.
 * - Host-only cookies (no domain) are the most secure default
 * - Only set domain when explicitly needed for subdomain sharing
 * - COOKIE_DOMAIN must be validated as a proper domain (no paths, no ports)
 */
function getCookieDomain(): string | undefined {
  const explicitDomain = process.env.COOKIE_DOMAIN;

  if (!explicitDomain) {
    // No domain set = host-only cookie (most secure default)
    // Cookie will only be sent to the exact host that set it
    return undefined;
  }

  // Validate the domain format
  // Must be a valid domain without protocol, path, or port
  const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
  if (!domainPattern.test(explicitDomain)) {
    console.error(`[auth-cookie] Invalid COOKIE_DOMAIN format: ${explicitDomain}`);
    console.error("[auth-cookie] COOKIE_DOMAIN must be a valid domain (e.g., 'example.com' or '.example.com')");
    return undefined;
  }

  return explicitDomain;
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
 * LEGACY TRANSPORT CONTROL
 *
 * By default, refresh tokens MUST be sent via httpOnly cookies.
 * Legacy body/header transport is DISABLED by default for security.
 *
 * Set AUTH_ALLOW_LEGACY_REFRESH_TRANSPORT=true to enable legacy transport
 * during migration period only. This should be removed once all clients
 * have migrated to cookie-based refresh.
 */
const ALLOW_LEGACY_TRANSPORT = process.env.AUTH_ALLOW_LEGACY_REFRESH_TRANSPORT === "true";

/**
 * Extract refresh token from httpOnly cookie.
 *
 * Legacy body transport is DISABLED by default.
 * Set AUTH_ALLOW_LEGACY_REFRESH_TRANSPORT=true to enable during migration.
 */
export function getRefreshTokenFromRequest(req: Request): string | null {
  // Primary: httpOnly cookie (secure)
  const cookieToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  if (cookieToken && typeof cookieToken === "string") {
    return cookieToken;
  }

  // Legacy fallback: request body (DISABLED by default)
  if (ALLOW_LEGACY_TRANSPORT) {
    const bodyToken = req.body?.refreshToken;
    if (bodyToken && typeof bodyToken === "string") {
      console.warn("[auth-cookie] LEGACY: refresh token in body - migrate to cookies");
      return bodyToken;
    }
  }

  return null;
}

/**
 * Check if refresh token is using legacy body transport.
 * Returns false if legacy transport is disabled.
 */
export function isLegacyRefreshTokenTransport(req: Request): boolean {
  if (!ALLOW_LEGACY_TRANSPORT) {
    return false;
  }

  const hasBodyToken = req.body?.refreshToken && typeof req.body.refreshToken === "string";
  const hasCookieToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME] && typeof req.cookies[REFRESH_TOKEN_COOKIE_NAME] === "string";

  return hasBodyToken && !hasCookieToken;
}

/**
 * Cookie name constant for tests and debugging
 */
export const COOKIE_NAME = REFRESH_TOKEN_COOKIE_NAME;
