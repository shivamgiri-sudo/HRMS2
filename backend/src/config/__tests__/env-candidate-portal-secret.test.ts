import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * env.ts's CANDIDATE_PORTAL_JWT_SECRET check used to be non-fatal: an unset value fell back
 * to the shared JWT_SECRET (same secret full employee sessions are signed with) with only a
 * console.warn in candidate-portal.service.ts, so the app booted and ran normally on a real
 * audience-confusion gap indefinitely. Now fatal-checked in production, matching
 * JWT_SECRET/PORTAL_JWT_SECRET's existing treatment (delta-audit 2026-08-14, Section K item
 * 1, Option A approved; confirmed live that production already has this var set).
 *
 * No other env.ts fatal check has direct unit coverage today (only referenced indirectly
 * from no-hardcoded-credentials.contract.test.ts's own comment) — env.ts runs its validation
 * as top-level module code and calls process.exit(1) directly, so this spies on
 * process.exit, forces re-evaluation via vi.resetModules + dynamic import per case, and lets
 * every other schema field fall back to its own default (none are required — every field in
 * envSchema carries either .default(...) or .optional()).
 */

const ORIGINAL_ENV = { ...process.env };

// A production-valid baseline for every OTHER fatal check env.ts runs before reaching
// CANDIDATE_PORTAL_JWT_SECRET's — without this, OTP_HMAC_SECRET's own check (which runs
// first) would exit(1) before this file's checks are ever reached.
const VALID_PROD_BASELINE = {
  JWT_SECRET: "a-real-distinct-jwt-secret-32-characters!!",
  PORTAL_JWT_SECRET: "a-real-distinct-portal-secret-32-characters",
  OTP_HMAC_SECRET: "a-real-distinct-otp-secret-32-characters!!",
  PAYROLL_BANK_KEY: "a-real-distinct-payroll-bank-key",
  ENCRYPTION_KEY: "a".repeat(64),
  INTERNAL_DEMO_BYPASS: "false",
  PORTAL_DEMO_BYPASS: "false",
};

function resetEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ORIGINAL_ENV, ...VALID_PROD_BASELINE };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("env.ts — CANDIDATE_PORTAL_JWT_SECRET fatal check (production only)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
  });

  it("is fatal when unset in production", async () => {
    resetEnv({ NODE_ENV: "production", CANDIDATE_PORTAL_JWT_SECRET: undefined });

    await expect(import("../env.js")).rejects.toThrow("process.exit(1)");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("CANDIDATE_PORTAL_JWT_SECRET must be set"));
  });

  it("is fatal when it reuses JWT_SECRET", async () => {
    resetEnv({
      NODE_ENV: "production",
      CANDIDATE_PORTAL_JWT_SECRET: VALID_PROD_BASELINE.JWT_SECRET,
    });

    await expect(import("../env.js")).rejects.toThrow("process.exit(1)");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("must be distinct from JWT_SECRET"));
  });

  it("is fatal when it reuses PORTAL_JWT_SECRET", async () => {
    resetEnv({
      NODE_ENV: "production",
      CANDIDATE_PORTAL_JWT_SECRET: VALID_PROD_BASELINE.PORTAL_JWT_SECRET,
    });

    await expect(import("../env.js")).rejects.toThrow("process.exit(1)");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("must be distinct from JWT_SECRET"));
  });

  it("boots cleanly when set to a real, distinct value", async () => {
    resetEnv({
      NODE_ENV: "production",
      CANDIDATE_PORTAL_JWT_SECRET: "a-real-distinct-candidate-secret-32-chars!!",
    });

    const { env } = await import("../env.js");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(env.CANDIDATE_PORTAL_JWT_SECRET).toBe("a-real-distinct-candidate-secret-32-chars!!");
  });

  it("stays non-fatal (warn-only) outside production — unset is fine in dev", async () => {
    resetEnv({
      NODE_ENV: "development",
      CANDIDATE_PORTAL_JWT_SECRET: undefined,
    });

    const { env } = await import("../env.js");
    expect(exitSpy).not.toHaveBeenCalled();
    expect(env.CANDIDATE_PORTAL_JWT_SECRET).toBeUndefined();
  });
});
