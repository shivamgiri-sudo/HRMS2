/**
 * Nothing may mark a BGV check verified without a provider having verified it.
 *
 * `triggerBgvAfterOnboardingSubmit` used to write all seven checks as
 * 'verified' with provider_key 'system', and stamp the report 'clear' / score
 * 100, purely because the candidate pressed Submit. It had no caller, so it was
 * not running — but it left 6 reports at a clean 100 and 49 unverified
 * 'system'/'verified' check rows in production, and a dormant function with
 * that name is one import away from doing it again.
 *
 * This pins the removal. It is a source-level check because the danger is a
 * query nobody executes in tests.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ONBOARDING = readFileSync(
  resolve(process.cwd(), "src/modules/ats/onboarding-full.service.ts"),
  "utf8",
);

/** Strip comments — the explanation of the removal names the thing removed. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("onboarding submit does not auto-approve BGV", () => {
  const SOURCE = code(ONBOARDING);

  it("no longer defines triggerBgvAfterOnboardingSubmit", () => {
    expect(SOURCE).not.toMatch(/function\s+triggerBgvAfterOnboardingSubmit/);
  });

  it("does not call it either", () => {
    expect(SOURCE).not.toMatch(/triggerBgvAfterOnboardingSubmit\s*\(/);
  });

  it("does not insert a bgv check with a hardcoded 'verified' status", () => {
    // The literal pattern that made an unverified row look verified.
    expect(SOURCE).not.toMatch(/'system',\s*'verified'/);
  });

  it("does not stamp a report clear with a perfect score", () => {
    expect(SOURCE).not.toMatch(/'clear',\s*100/);
  });

  it("records no BGV_AUTO_APPROVED event", () => {
    expect(SOURCE).not.toContain("BGV_AUTO_APPROVED");
  });
});

describe("the dashboard does not report unavailable data as good news", () => {
  const MANAGEMENT = code(
    readFileSync(resolve(process.cwd(), "src/modules/management/management.service.ts"), "utf8"),
  );

  // Both of these query things that do not exist — auth_user has no 2FA column,
  // and there is no policy_acknowledgement table — so they always hit .catch().
  // Falling back to 0 renders as "0 users without 2FA" and "no pending
  // acknowledgements": the most reassuring possible output from a query that
  // has never once run.
  for (const [label, needle] of [
    ["the 2FA count", "FROM auth_user WHERE two_fa_enabled"],
    ["the policy acknowledgement count", "FROM policy_acknowledgement"],
  ] as const) {
    it(`${label} falls back to null, not 0`, () => {
      const at = MANAGEMENT.indexOf(needle);
      expect(at, `${needle} not found — the query moved`).toBeGreaterThan(-1);
      // The .catch() follows the query within a short window.
      const window = MANAGEMENT.slice(at, at + 260);
      expect(window).toMatch(/catch\(\(\)\s*=>\s*\[\[\{\s*count:\s*null\s*\}\]\]/);
      expect(window).not.toMatch(/catch\(\(\)\s*=>\s*\[\[\{\s*count:\s*0\s*\}\]\]/);
    });
  }
});
