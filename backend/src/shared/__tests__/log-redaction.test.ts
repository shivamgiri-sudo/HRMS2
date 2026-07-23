import { describe, it, expect } from "vitest";
import { redactSensitive, redactObject, safeStringify } from "../logRedaction.js";

describe("Log Redaction", () => {
  describe("redactSensitive", () => {
    it("should redact JWT tokens", () => {
      const input = "Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const result = redactSensitive(input);
      expect(result).toBe("Token: [REDACTED_JWT]");
    });

    it("should redact Bearer tokens", () => {
      const input = "Authorization: Bearer abc123def456";
      const result = redactSensitive(input);
      expect(result).toBe("Authorization: Bearer [REDACTED]");
    });

    it("should redact refreshToken in JSON", () => {
      const input = '{"refreshToken": "secret-token-value"}';
      const result = redactSensitive(input);
      expect(result).toBe('{"refreshToken": "[REDACTED]"}');
    });

    it("should redact accessToken in JSON", () => {
      const input = '{"accessToken": "secret-access-token"}';
      const result = redactSensitive(input);
      expect(result).toBe('{"accessToken": "[REDACTED]"}');
    });

    it("should redact OTP codes", () => {
      const input = '{"otp": "123456"}';
      const result = redactSensitive(input);
      expect(result).toBe('{"otp": "[REDACTED]"}');
    });

    it("should redact passwords", () => {
      const input = '{"password": "mysecretpassword"}';
      const result = redactSensitive(input);
      expect(result).toBe('{"password": "[REDACTED]"}');
    });

    it("should redact PAN numbers", () => {
      const input = "PAN: ABCDE1234F";
      const result = redactSensitive(input);
      expect(result).toBe("PAN: [REDACTED_PAN]");
    });

    it("should redact Aadhaar numbers", () => {
      const input = "Aadhaar: 1234 5678 9012";
      const result = redactSensitive(input);
      expect(result).toBe("Aadhaar: [REDACTED_AADHAAR]");
    });

    it("should handle multiple sensitive values", () => {
      const input = '{"password": "secret", "otp": "123456"}';
      const result = redactSensitive(input);
      expect(result).toContain('"password": "[REDACTED]"');
      expect(result).toContain('"otp": "[REDACTED]"');
    });
  });

  describe("redactObject", () => {
    it("should redact password field", () => {
      const obj = { username: "user", password: "secret123" };
      const result = redactObject(obj);
      expect(result.username).toBe("user");
      expect(result.password).toBe("[REDACTED]");
    });

    it("should redact token fields", () => {
      const obj = { refreshToken: "abc123", accessToken: "def456", userId: "user1" };
      const result = redactObject(obj);
      expect(result.refreshToken).toBe("[REDACTED]");
      expect(result.accessToken).toBe("[REDACTED]");
      expect(result.userId).toBe("user1");
    });

    it("should handle nested objects", () => {
      const obj = {
        user: { name: "John", password: "secret" },
        data: { value: 123 },
      };
      const result = redactObject(obj);
      expect((result.user as any).name).toBe("John");
      expect((result.user as any).password).toBe("[REDACTED]");
      expect((result.data as any).value).toBe(123);
    });

    it("should preserve non-sensitive fields", () => {
      const obj = { email: "test@example.com", name: "Test User", id: 123 };
      const result = redactObject(obj);
      expect(result).toEqual(obj);
    });
  });

  describe("safeStringify", () => {
    it("should stringify and redact objects", () => {
      const obj = { password: "secret", name: "test" };
      const result = safeStringify(obj);
      expect(result).toContain('"password":"[REDACTED]"');
      expect(result).toContain('"name":"test"');
    });

    it("should handle strings", () => {
      const input = "Bearer token123";
      const result = safeStringify(input);
      expect(result).toBe("Bearer [REDACTED]");
    });

    it("should handle null", () => {
      const result = safeStringify(null);
      expect(result).toBe("null");
    });
  });
});
