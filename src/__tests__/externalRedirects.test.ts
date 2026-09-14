/**
 * External redirects must navigate the tab, not open a popup.
 *
 * window.open only survives inside the synchronous run of a user gesture. Every
 * one of these handlers awaits a network call first, so by the time it runs the
 * gesture is spent and the browser blocks the popup SILENTLY — no error, no
 * console warning, no callback. The button simply appears dead.
 *
 * This is not theoretical. It shipped three times:
 *   - the joining-document eSign button,
 *   - DigiLocker connect,
 *   - onboarding eSign.
 * Production recorded 22 DigiLocker sessions, every one still at status
 * 'created': the server always returned a valid provider URL and no candidate
 * ever arrived at the far end. Five of those rows were created within 49
 * seconds by one person clicking repeatedly.
 *
 * Headless browsers do not enforce popup gating, which is exactly why this
 * survives ordinary UI testing and needs a source-level guard.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

/** Files whose redirects follow an await and must therefore navigate the tab. */
const POST_AWAIT_REDIRECT_FILES = [
  "components/onboarding-full/useOnboardingFull.ts",
  "pages/EmployeeDocumentEsignReviewPage.tsx",
  "pages/EmployeeJoiningKitEsignPage.tsx",
];

/** A real call, not the word appearing inside an explanatory comment. */
function realWindowOpenCalls(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => {
      const code = line.split("//")[0];
      return /\bwindow\.open\s*\(/.test(code);
    })
    .map((l) => l.trim());
}

describe("post-await redirects never use window.open", () => {
  for (const rel of POST_AWAIT_REDIRECT_FILES) {
    it(`${rel} navigates instead of opening a popup`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(realWindowOpenCalls(src)).toEqual([]);
      expect(src).toMatch(/window\.location\.assign\(/);
    });
  }

  it("DigiLocker keeps the destination reachable as a plain link", () => {
    // A redirect that silently does not happen must still leave the user a way
    // through — that is the whole failure being fixed.
    const hook = fs.readFileSync(path.join(ROOT, "components/onboarding-full/useOnboardingFull.ts"), "utf8");
    expect(hook).toContain("setRedirectUrl(");
    expect(hook).toMatch(/\n\s*redirectUrl,/);

    const steps = fs.readFileSync(path.join(ROOT, "components/onboarding-full/OnboardingSteps1to5.tsx"), "utf8");
    expect(steps).toContain("open DigiLocker directly");
  });

  it("both DigiLocker call sites receive the fallback url", () => {
    const page = fs.readFileSync(path.join(ROOT, "pages/CandidateOnboardingFullPage.tsx"), "utf8");
    const handlers = (page.match(/onDigilocker=\{onb\.startDigilocker\}/g) ?? []).length;
    const fallbacks = (page.match(/digilockerRedirectUrl=\{onb\.redirectUrl\}/g) ?? []).length;
    expect(handlers).toBeGreaterThan(0);
    expect(fallbacks).toBe(handlers);
  });
});
