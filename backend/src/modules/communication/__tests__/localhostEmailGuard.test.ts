import { describe, it, expect, afterEach } from "vitest";
import { assertNoLocalhostLinks } from "../email.service.js";

/**
 * On 2026-08-06 an EPF review link was emailed to an employee's personal Gmail
 * pointing at http://localhost:8080. The send reported success and nothing in
 * the result showed the link was unusable — the recipient simply got a dead
 * button.
 *
 * The cause is environmental rather than local to any one sender: FRONTEND_URL
 * is schema-defaulted to localhost and about twenty call sites add their own
 * localhost fallbacks, so anything run from a developer machine can do this.
 * SMTP is the one place they all pass through.
 */

const PROD = "https://mcnhrms.teammas.in/employee/epf-compliance/review/abc123";

afterEach(() => { delete process.env.ALLOW_LOCALHOST_EMAIL_LINKS; });

describe("outbound emails may not carry localhost links", () => {
  it("refuses the exact shape that reached the employee", () => {
    expect(() => assertNoLocalhostLinks({
      to: "sofiyasultan57@gmail.com",
      html: `<a href="http://localhost:8080/employee/epf-compliance/review/abc123">Review my PF details</a>`,
    })).toThrow(/Refusing to email a http:\/\/localhost:8080 link/);
  });

  it("names the recipient so the failure is actionable", () => {
    expect(() => assertNoLocalhostLinks({
      to: "someone@example.com",
      html: `<a href="http://localhost:5173/x">go</a>`,
    })).toThrow(/someone@example\.com/);
  });

  it("catches the other loopback spellings and the text part", () => {
    for (const base of ["http://127.0.0.1:8080", "http://0.0.0.0:5173", "http://[::1]:3000"]) {
      expect(() => assertNoLocalhostLinks({ to: "a@b.com", html: `<a href="${base}/x">go</a>` }),
        `${base} not caught`).toThrow();
    }
    expect(() => assertNoLocalhostLinks({ to: "a@b.com", text: "open http://localhost:8080/x" })).toThrow();
  });

  it("allows a real link through", () => {
    expect(() => assertNoLocalhostLinks({
      to: "sofiyasultan57@gmail.com",
      html: `<a href="${PROD}">Review my PF details</a>`,
    })).not.toThrow();
  });

  it("does not trip on a hostname that merely contains the word", () => {
    expect(() => assertNoLocalhostLinks({
      to: "a@b.com",
      html: `<a href="https://localhost-tools.teammas.in/x">go</a>`,
    })).not.toThrow();
  });

  it("can be waived for a deliberate local template test", () => {
    process.env.ALLOW_LOCALHOST_EMAIL_LINKS = "true";
    expect(() => assertNoLocalhostLinks({
      to: "dev@example.com",
      html: `<a href="http://localhost:8080/x">go</a>`,
    })).not.toThrow();
  });
});
