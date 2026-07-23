import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, Request } from "express";
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
  isLegacyRefreshTokenTransport,
  COOKIE_NAME,
} from "../auth-cookie.js";

describe("Auth Cookie Security", () => {
  let mockRes: Partial<Response>;
  let cookieArgs: any[];
  let clearCookieArgs: any[];

  beforeEach(() => {
    cookieArgs = [];
    clearCookieArgs = [];
    mockRes = {
      cookie: vi.fn((...args) => {
        cookieArgs.push(args);
      }),
      clearCookie: vi.fn((...args) => {
        clearCookieArgs.push(args);
      }),
    };
  });

  describe("setRefreshTokenCookie", () => {
    it("should set httpOnly flag to prevent JavaScript access", () => {
      setRefreshTokenCookie(mockRes as Response, "test-token");

      expect(cookieArgs.length).toBe(1);
      const [_name, _value, options] = cookieArgs[0];
      expect(options.httpOnly).toBe(true);
    });

    it("should set sameSite to lax for CSRF protection", () => {
      setRefreshTokenCookie(mockRes as Response, "test-token");

      const [_name, _value, options] = cookieArgs[0];
      expect(options.sameSite).toBe("lax");
    });

    it("should limit cookie path to auth endpoints only", () => {
      setRefreshTokenCookie(mockRes as Response, "test-token");

      const [_name, _value, options] = cookieArgs[0];
      expect(options.path).toBe("/api/auth");
    });

    it("should set secure flag based on environment", () => {
      // In test environment (not production), secure should be false
      setRefreshTokenCookie(mockRes as Response, "test-token");

      const [_name, _value, options] = cookieArgs[0];
      // In test env, secure is false unless FORCE_SECURE_COOKIES is set
      expect(typeof options.secure).toBe("boolean");
    });

    it("should set correct cookie name", () => {
      setRefreshTokenCookie(mockRes as Response, "test-token");

      const [name] = cookieArgs[0];
      expect(name).toBe(COOKIE_NAME);
      expect(name).toBe("hrms_refresh");
    });

    it("should set the token value correctly", () => {
      const testToken = "my-secure-refresh-token";
      setRefreshTokenCookie(mockRes as Response, testToken);

      const [_name, value] = cookieArgs[0];
      expect(value).toBe(testToken);
    });

    it("should set maxAge for 7 days by default", () => {
      setRefreshTokenCookie(mockRes as Response, "test-token");

      const [_name, _value, options] = cookieArgs[0];
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(options.maxAge).toBe(sevenDaysMs);
    });

    it("should allow custom maxAge", () => {
      const customMaxAge = 60 * 1000; // 1 minute
      setRefreshTokenCookie(mockRes as Response, "test-token", { maxAgeMs: customMaxAge });

      const [_name, _value, options] = cookieArgs[0];
      expect(options.maxAge).toBe(customMaxAge);
    });
  });

  describe("clearRefreshTokenCookie", () => {
    it("should clear the correct cookie name", () => {
      clearRefreshTokenCookie(mockRes as Response);

      expect(clearCookieArgs.length).toBe(1);
      const [name] = clearCookieArgs[0];
      expect(name).toBe(COOKIE_NAME);
    });

    it("should use same options for clearing", () => {
      clearRefreshTokenCookie(mockRes as Response);

      const [_name, options] = clearCookieArgs[0];
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.path).toBe("/api/auth");
    });
  });

  describe("getRefreshTokenFromRequest", () => {
    it("should prefer cookie over body", () => {
      const mockReq: Partial<Request> = {
        cookies: { [COOKIE_NAME]: "cookie-token" },
        body: { refreshToken: "body-token" },
      };

      const result = getRefreshTokenFromRequest(mockReq as Request);
      expect(result).toBe("cookie-token");
    });

    it("should read from body as fallback (legacy)", () => {
      const mockReq: Partial<Request> = {
        cookies: {},
        body: { refreshToken: "body-token" },
      };

      const result = getRefreshTokenFromRequest(mockReq as Request);
      expect(result).toBe("body-token");
    });

    it("should return null when no token present", () => {
      const mockReq: Partial<Request> = {
        cookies: {},
        body: {},
      };

      const result = getRefreshTokenFromRequest(mockReq as Request);
      expect(result).toBeNull();
    });

    it("should handle missing cookies object", () => {
      const mockReq: Partial<Request> = {
        body: { refreshToken: "body-token" },
      };

      const result = getRefreshTokenFromRequest(mockReq as Request);
      expect(result).toBe("body-token");
    });
  });

  describe("isLegacyRefreshTokenTransport", () => {
    it("should return true when token is only in body", () => {
      const mockReq: Partial<Request> = {
        cookies: {},
        body: { refreshToken: "body-token" },
      };

      expect(isLegacyRefreshTokenTransport(mockReq as Request)).toBe(true);
    });

    it("should return false when token is in cookie", () => {
      const mockReq: Partial<Request> = {
        cookies: { [COOKIE_NAME]: "cookie-token" },
        body: { refreshToken: "body-token" },
      };

      expect(isLegacyRefreshTokenTransport(mockReq as Request)).toBe(false);
    });

    it("should return false when no token present", () => {
      const mockReq: Partial<Request> = {
        cookies: {},
        body: {},
      };

      // No body token means not legacy transport
      expect(isLegacyRefreshTokenTransport(mockReq as Request)).toBeFalsy();
    });
  });

  describe("Security Properties", () => {
    it("should document that httpOnly prevents document.cookie access", () => {
      // When httpOnly is true, the cookie cannot be accessed via:
      // - document.cookie
      // - JavaScript Cookie APIs
      // - XSS attacks reading cookies
      // This is a documentation test proving the security property
      setRefreshTokenCookie(mockRes as Response, "test-token");
      const [_name, _value, options] = cookieArgs[0];

      // This is the critical security property
      expect(options.httpOnly).toBe(true);
    });

    it("should document that sameSite=lax prevents CSRF on cross-origin POST", () => {
      // SameSite=Lax means:
      // - Cookie is sent on same-site requests
      // - Cookie is sent on cross-site GET navigations
      // - Cookie is NOT sent on cross-site POST/PUT/DELETE
      // This prevents CSRF attacks on state-changing operations
      setRefreshTokenCookie(mockRes as Response, "test-token");
      const [_name, _value, options] = cookieArgs[0];

      expect(options.sameSite).toBe("lax");
    });

    it("should document path restriction limits cookie exposure", () => {
      // Path=/api/auth means the cookie is only sent to:
      // - /api/auth/refresh
      // - /api/auth/logout
      // - /api/auth/login (for setting)
      // NOT sent to other API endpoints, reducing exposure
      setRefreshTokenCookie(mockRes as Response, "test-token");
      const [_name, _value, options] = cookieArgs[0];

      expect(options.path).toBe("/api/auth");
    });
  });
});
