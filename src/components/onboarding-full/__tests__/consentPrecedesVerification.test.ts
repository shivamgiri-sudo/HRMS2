/**
 * Consent must be collected before any verification control is reachable.
 *
 * This has broken twice in the same way. Background-verification consent used to
 * live on Step 5. DigiLocker was then moved to Step 3, the consent stayed behind,
 * and because startDigilockerByToken calls ensureConsent() server-side, every
 * candidate who pressed Connect before reaching Step 5 got a flat 403 — no
 * DigiLocker session was created for months. That was patched by asking for
 * consent again at the point of use on Step 3, which left the same trap set for
 * the next control to move: penny drop on Step 6 called verifyBankForCandidate,
 * which also calls ensureConsent(), while its button was gated only on the
 * account number and IFSC.
 *
 * Asking at the point of use makes correctness depend on step order. Collecting
 * consent on Step 1 removes that dependency — and matches the DPDP Act's
 * expectation that consent precedes processing rather than follows it.
 *
 * These assertions read the source because no type checker can see them: a
 * button missing `consentAccepted` in its disabled expression compiles perfectly
 * and fails only against a live provider.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const STEPS_1_5 = read("src/components/onboarding-full/OnboardingSteps1to5.tsx");
const PAGE = read("src/pages/CandidateOnboardingFullPage.tsx");
const BGV_SERVICE = read("backend/src/modules/ats/bgv-verification.service.ts");

/** The step each control lives on, for failure messages that name the screen. */
const GATED_CONTROLS = [
  { what: "DigiLocker (Step 3)", marker: "onClick={onDigilocker}" },
  { what: "Penny drop (Step 6)", marker: "<PennyDropButton" },
];

describe("consent precedes verification", () => {
  it("Step 1 collects the background-verification consent", () => {
    const step1 = STEPS_1_5.slice(
      STEPS_1_5.indexOf("export function Step1Welcome"),
      STEPS_1_5.indexOf("export function Step2Personal"),
    );
    expect(step1).toContain("onConsent");
    expect(step1).toMatch(/Background Verification Consent/i);
  });

  it("the page passes consent and its handler into Step 1", () => {
    const usage = PAGE.slice(PAGE.indexOf("<Step1Welcome"), PAGE.indexOf("<Step1Welcome") + 400);
    expect(usage).toContain("consentAccepted={onb.consentAccepted}");
    expect(usage).toContain("onConsent={onb.grantConsent}");
  });

  for (const { what, marker } of GATED_CONTROLS) {
    it(`${what} is disabled until consent is granted`, () => {
      const at = STEPS_1_5.indexOf(marker);
      expect(at, `${marker} not found — did the control move or get renamed?`).toBeGreaterThan(-1);

      // Assert against the `disabled` expression itself, not the surrounding
      // markup. Matching the whole element is what made an earlier version of
      // this test pass with the gate deleted: an adjacent "consent missing"
      // notice also mentions consentAccepted, so the element as a whole matched
      // while the button was in fact ungated.
      const element = STEPS_1_5.slice(at, at + 600);
      const disabled = element.match(/disabled=\{([^}]*)\}/)?.[1];
      expect(disabled, `${what} has no disabled expression`).toBeTruthy();
      expect(disabled, `${what} can be pressed without consent and will 403`).toContain("consentAccepted");
    });
  }

  it("Step 6 receives consentAccepted from the page", () => {
    const usage = PAGE.slice(PAGE.indexOf("<Step6Bank"), PAGE.indexOf("<Step6Bank") + 400);
    expect(usage).toContain("consentAccepted={onb.consentAccepted}");
  });

  it("the server still enforces consent, so the UI gate is a courtesy and not the boundary", () => {
    // If this ever stops being true the UI gate becomes security, which it is not.
    expect(BGV_SERVICE).toMatch(/async function ensureConsent/);
    expect(BGV_SERVICE).toMatch(/BGV consent is required before verification/);
    const callSites = (BGV_SERVICE.match(/await ensureConsent\(/g) ?? []).length;
    expect(callSites, "verification entry points lost their consent check").toBeGreaterThanOrEqual(8);
  });

  it("bank verification specifically is still consent-checked server-side", () => {
    const fn = BGV_SERVICE.slice(BGV_SERVICE.indexOf("verifyBankForCandidate"));
    expect(fn.slice(0, 1200)).toContain("ensureConsent");
  });
});
