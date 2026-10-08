import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const service = fs.readFileSync(path.resolve(__dirname, "../auth.service.ts"), "utf8");

/**
 * Temporary lockout rules: 5 failures lock the account for 10 minutes, and a completed
 * forgot-password reset (email token or OTP) clears the lock so the new password works at once.
 * Source-contract style, like auth-security.test.ts, because the logic is plain SQL in the service.
 */
describe("account lockout", () => {
  it("locks for 10 minutes after 5 consecutive failures", () => {
    expect(service).toMatch(/failed_login_attempts \+ 1 >= 5,\s*DATE_ADD\(NOW\(\), INTERVAL 10 MINUTE\)/);
    expect(service).not.toMatch(/locked_until[\s\S]{0,120}INTERVAL 15 MINUTE/);
  });

  it("resetPassword (email token) clears failed attempts and the lock together with the new hash", () => {
    const body = service.slice(service.indexOf("async resetPassword("), service.indexOf("async changePassword("));
    expect(body).toContain("failed_login_attempts = 0, locked_until = NULL");
    expect(body).not.toMatch(/is_blocked\s*=/);
  });

  it("verifyOtpAndResetPassword clears failed attempts and the lock, and never touches is_blocked", () => {
    const body = service.slice(service.indexOf("async verifyOtpAndResetPassword("));
    expect(body).toContain("failed_login_attempts = 0, locked_until = NULL");
    expect(body).not.toMatch(/is_blocked\s*=/);
  });

  it("changePassword (needs the current password) does not clear a lock", () => {
    const body = service.slice(service.indexOf("async changePassword("), service.indexOf("async forgotPasswordOtp("));
    expect(body).not.toContain("locked_until");
  });
});
