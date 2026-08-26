/**
 * Required onboarding data must be enforced, not merely marked with an asterisk.
 *
 * Every "required" field on this form was cosmetic except Step 2's: the footer's
 * Next button called advanceStep() directly, and submitFullOnboarding checked
 * only consents and documents. Production showed exactly what that permits —
 * of 515 onboarding requests, 15 candidates reached "profile_submitted" or
 * beyond carrying zero qualification rows (which is why the HR review page
 * reports "No education records." so often), and 51 got there with no live
 * selfie at all, including 6 of the 6 fully approved ones.
 *
 * Both halves of each gate are asserted here. The client gate is what the
 * candidate actually experiences; the server gate is what holds when someone
 * posts to the endpoint directly, and is the only one that governs the data.
 *
 * The server assertions read source because no type checker can see them: a
 * deleted guard compiles perfectly and fails only against real candidates.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateStep7Education } from "../OnboardingSteps6to10";
import { MANDATORY_DOCUMENT_RULES, findMissingMandatoryDocs } from "../mandatoryDocuments";
import type { QualForm, StatusData } from "../useOnboardingFull";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SERVICE = read("backend/src/modules/ats/onboarding-full.service.ts");
const PAGE = read("src/pages/CandidateOnboardingFullPage.tsx");

const EMPTY: QualForm = {
  qualification: "", specializationCourseName: "", institutionName: "", boardType: "",
  passedOutYear: "", passedOutPercentage: "", passedOutState: "", passedOutCity: "",
} as QualForm;
const statusWith = (n: number) =>
  ({ qualifications: Array.from({ length: n }, (_, i) => ({ id: String(i) })) } as unknown as StatusData);

describe("Education — Step 7 is gated, client and server", () => {
  it("blocks advancing when nothing has been added", () => {
    expect(validateStep7Education(statusWith(0), EMPTY)).toMatch(/add at least/i);
  });

  it("names the Add Qualification trap when the form is filled but never submitted", () => {
    // The likeliest real-world failure: the candidate types their qualification
    // and presses Next, but "Add Qualification" POSTs independently of Next, so
    // everything they typed is silently discarded on advance.
    const filled = { ...EMPTY, qualification: "10th / SSC", passedOutYear: "2015" };
    expect(validateStep7Education(statusWith(0), filled)).toMatch(/not added it yet/i);
  });

  it("still warns about an unsaved second qualification once one is added", () => {
    const filled = { ...EMPTY, qualification: "12th / HSC" };
    expect(validateStep7Education(statusWith(1), filled)).toMatch(/unsaved qualification/i);
  });

  it("passes once a qualification is added and the form is clear", () => {
    expect(validateStep7Education(statusWith(1), EMPTY)).toBeNull();
  });

  it("treats a whitespace-only leftover as clear, so Clear Form really clears the gate", () => {
    expect(validateStep7Education(statusWith(1), { ...EMPTY, institutionName: "   " })).toBeNull();
  });

  it("is wired into the page's Next handler for step 7", () => {
    expect(PAGE).toMatch(/onb\.step === 7[\s\S]{0,160}validateStep7Education/);
  });

  it("submitFullOnboarding refuses a candidate with no qualification row", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("export async function submitFullOnboarding"));
    expect(fn).toContain("MISSING_QUALIFICATIONS");
    expect(fn).toMatch(/FROM candidate_onboarding_qualification WHERE candidate_id/);
  });
});

describe("Live Selfie — mandatory, and not satisfiable by a gallery photo", () => {
  it("is a mandatory document rule of its own", () => {
    expect(MANDATORY_DOCUMENT_RULES.some((r) => r.label === "Live Selfie")).toBe(true);
  });

  it("is reported missing when the candidate has only a passport photo", () => {
    // The whole point of a *live* capture is proof of presence, so an uploaded
    // "Passport Photo" must not stand in for it.
    const missing = findMissingMandatoryDocs([{ doc_type: "Passport Photo", doc_name: "photo.jpg" }]);
    expect(missing.map((r) => r.label)).toContain("Live Selfie");
  });

  it("is satisfied by the doc_type the capture actually writes", () => {
    // Production writes exactly this pair on all 55 existing captures.
    const missing = findMissingMandatoryDocs([
      { doc_type: "Live Selfie", doc_name: "Live Selfie (Identity Verification)" },
    ]);
    expect(missing.map((r) => r.label)).not.toContain("Live Selfie");
  });

  it("does not itself satisfy the separate Passport Size Photo requirement", () => {
    const missing = findMissingMandatoryDocs([
      { doc_type: "Live Selfie", doc_name: "Live Selfie (Identity Verification)" },
    ]);
    expect(missing.map((r) => r.label)).toContain("Passport Size Photo");
  });
});

describe("Marital Status — enforced server-side too", () => {
  it("submitFullOnboarding refuses a blank marital status", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("export async function submitFullOnboarding"));
    expect(fn).toContain("MISSING_MARITAL_STATUS");
    // Must actually be selected, or the guard reads undefined and never fires.
    expect(fn).toMatch(/SELECT[\s\S]{0,300}marital_status[\s\S]{0,120}FROM candidate_onboarding_profile/);
  });

  it("carries a statusCode, since a bare throw has its message replaced in production", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("export async function submitFullOnboarding"));
    const guard = fn.slice(fn.indexOf("MISSING_MARITAL_STATUS") - 400, fn.indexOf("MISSING_MARITAL_STATUS") + 40);
    expect(guard).toContain("statusCode: 400");
  });
});
