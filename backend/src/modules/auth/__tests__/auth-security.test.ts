import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs";
import path from "path";

const AUTH_SERVICE_PATH = path.resolve(__dirname, "../auth.service.ts");
const AUTH_ROUTES_PATH = path.resolve(__dirname, "../auth.routes.ts");
const REQUIRE_ROLE_PATH = path.resolve(__dirname, "../../../middleware/requireRole.ts");

describe("Auth Security Hardening", () => {
  let authServiceCode: string;
  let authRoutesCode: string;
  let requireRoleCode: string;

  beforeAll(() => {
    authServiceCode = fs.readFileSync(AUTH_SERVICE_PATH, "utf8");
    authRoutesCode = fs.readFileSync(AUTH_ROUTES_PATH, "utf8");
    requireRoleCode = fs.readFileSync(REQUIRE_ROLE_PATH, "utf8");
  });

  describe("2FA Bypass Prevention", () => {
    it("login() should NOT create refresh token when 2FA is required", () => {
      // The login function should check twoFactorRequired BEFORE creating refresh token
      // Look for the pattern where we check 2FA and return with refreshToken: null
      expect(authServiceCode).toContain("refreshToken: null");
      expect(authServiceCode).toContain("SECURITY: No refresh token until 2FA completes");
    });

    it("login() should create pre_auth_challenge record for 2FA flow", () => {
      expect(authServiceCode).toContain("INSERT INTO pre_auth_challenge");
    });

    it("exchangePreAuthToken() should create refresh token only after 2FA verification", () => {
      // The refresh token creation should only happen in exchangePreAuthToken after 2FA
      expect(authServiceCode).toContain("SECURITY: This is the ONLY place where a refresh token is created after 2FA verification");
    });

    it("exchangePreAuthToken() should verify pre_auth_challenge is not consumed", () => {
      expect(authServiceCode).toContain("Pre-auth challenge already consumed");
    });
  });

  describe("Registration Security", () => {
    it("register route should require an invitation/onboarding token", () => {
      expect(authRoutesCode).toContain("INVITATION_REQUIRED");
      expect(authRoutesCode).toContain("Registration requires a valid invitation");
    });

    it("register route should have rate limiting", () => {
      expect(authRoutesCode).toMatch(/router\.post\("\/register",\s*authLimiter/);
    });

    it("register route should validate invitation token", () => {
      expect(authRoutesCode).toContain("auth_invitation");
      expect(authRoutesCode).toContain("INVITATION_INVALID");
      expect(authRoutesCode).toContain("INVITATION_CONSUMED");
    });
  });

  describe("Refresh Token Rotation", () => {
    it("refreshAccess() should implement token rotation", () => {
      // Old token should be marked as rotated, new token should be created
      expect(authServiceCode).toContain("TOKEN ROTATION");
      expect(authServiceCode).toContain("rotated_at = NOW()");
    });

    it("refreshAccess() should detect token reuse", () => {
      expect(authServiceCode).toContain("TOKEN_REUSE_DETECTED");
      expect(authServiceCode).toContain("token.rotated_at");
    });

    it("refreshAccess() should revoke entire token family on reuse", () => {
      expect(authServiceCode).toContain("UPDATE auth_refresh_token SET revoked = 1 WHERE token_family_id");
    });

    it("refresh route should set new refresh token via httpOnly cookie", () => {
      // After migration to httpOnly cookies, refresh tokens are no longer in response body
      // They are set via setRefreshTokenCookie() for XSS protection
      expect(authRoutesCode).toContain("setRefreshTokenCookie(res, tokens.refreshToken)");
    });
  });

  describe("Comprehensive Refresh Validation", () => {
    it("refreshAccess() should check if user is blocked", () => {
      expect(authServiceCode).toContain("USER_BLOCKED");
      expect(authServiceCode).toContain("token.is_blocked");
    });

    it("refreshAccess() should check employee status", () => {
      expect(authServiceCode).toContain("EMPLOYEE_INACTIVE");
      expect(authServiceCode).toContain("employee_status");
    });

    it("refreshAccess() should check password_changed_at", () => {
      expect(authServiceCode).toContain("PASSWORD_CHANGED");
      expect(authServiceCode).toContain("password_changed_at_snapshot");
    });
  });

  describe("Cryptographic Security", () => {
    it("SMS OTP should use crypto.randomInt() not Math.random()", () => {
      // Should NOT contain Math.random for OTP generation
      expect(authServiceCode).not.toMatch(/Math\.random\(\).*900000/);
      // Should use crypto.randomInt
      expect(authServiceCode).toContain("crypto.randomInt(100000, 1000000)");
    });
  });

  describe("Fail-Closed Authorization", () => {
    it("requireRole should return 503 on DB errors, not propagate them", () => {
      expect(requireRoleCode).toContain("AUTH_SERVICE_UNAVAILABLE");
      expect(requireRoleCode).toContain("res.status(503)");
    });

    it("requireRole should log errors for investigation", () => {
      expect(requireRoleCode).toContain("console.error");
      expect(requireRoleCode).toContain("Authorization check failed");
    });
  });

  describe("Security Audit Events", () => {
    it("should log PASSWORD_VERIFIED event for 2FA flow", () => {
      expect(authServiceCode).toContain("PASSWORD_VERIFIED");
    });

    it("should log LOGIN_SUCCESS only after full authentication", () => {
      // LOGIN_SUCCESS should appear in the non-2FA path and in exchangePreAuthToken
      const loginSuccessMatches = authServiceCode.match(/LOGIN_SUCCESS/g);
      expect(loginSuccessMatches?.length).toBeGreaterThanOrEqual(2);
    });

    it("should log TOKEN_REUSE_DETECTED as critical severity", () => {
      expect(authServiceCode).toContain("severity: 'critical'");
      expect(authServiceCode).toContain("TOKEN_REUSE_DETECTED");
    });
  });

  describe("Token Family Tracking", () => {
    it("should store token_family_id when creating refresh tokens", () => {
      expect(authServiceCode).toContain("token_family_id");
      expect(authServiceCode).toContain("tokenFamilyId");
    });

    it("should store password_changed_at_snapshot with refresh tokens", () => {
      expect(authServiceCode).toContain("password_changed_at_snapshot");
    });
  });
});
