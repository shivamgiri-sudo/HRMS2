import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Step 10's real submit gate used to only require "any 1 document at all"
// (which even a Live Selfie capture satisfied), while the backend hard-
// requires 7 specific mandatory categories at submit time — so a candidate
// could sail past an enabled Submit button and only then get a backend
// rejection listing 6 things nobody told them were still missing.
//
// The frontend now derives its gate from a shared module
// (src/components/onboarding-full/mandatoryDocuments.ts) that must stay in
// parity with the backend's MANDATORY_DOCUMENTS list — same labels, same
// match-keyword sets — or this exact bug reappears silently.
const backendService = readFileSync(
  resolve(process.cwd(), "src/modules/ats/onboarding-full.service.ts"),
  "utf8"
);
const frontendModule = readFileSync(
  resolve(process.cwd(), "..", "src", "components", "onboarding-full", "mandatoryDocuments.ts"),
  "utf8"
);

function extractRules(source: string, arrayName: string): { label: string; matches: string[] }[] {
  const start = source.indexOf(`${arrayName}`);
  const arrayText = source.slice(start, source.indexOf("];", start) + 1);
  const rules: { label: string; matches: string[] }[] = [];
  const ruleRegex = /\{\s*label:\s*"([^"]+)",\s*matches:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(arrayText))) {
    const matches = m[2].match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
    rules.push({ label: m[1], matches });
  }
  return rules;
}

describe("Onboarding — frontend/backend mandatory-document parity", () => {
  it("MANDATORY_DOCUMENTS (backend) and MANDATORY_DOCUMENT_RULES (frontend) are identical", () => {
    const backendRules = extractRules(backendService, "const MANDATORY_DOCUMENTS");
    const frontendRules = extractRules(frontendModule, "export const MANDATORY_DOCUMENT_RULES");

    expect(backendRules.length).toBeGreaterThan(0);
    expect(frontendRules.length).toBeGreaterThan(0);
    expect(frontendRules).toEqual(backendRules);
  });

  it("findMissingMandatoryDocuments query excludes soft-deleted documents", () => {
    const fn = backendService.slice(backendService.indexOf("async function findMissingMandatoryDocuments"));
    const queryEnd = fn.indexOf("[candidateId]");
    const query = fn.slice(0, queryEnd);
    expect(query).toContain("deleted_at IS NULL");
  });

  it("neither list requires a bank/cheque document — bank is optional at onboarding", () => {
    const backendRules = extractRules(backendService, "const MANDATORY_DOCUMENTS");
    const frontendRules = extractRules(frontendModule, "export const MANDATORY_DOCUMENT_RULES");
    expect(backendRules.some((r) => r.label.toLowerCase().includes("cheque"))).toBe(false);
    expect(frontendRules.some((r) => r.label.toLowerCase().includes("cheque"))).toBe(false);
  });
});

// PAN Card stopped being a hard submit blocker on 2026-09-03 (freshers and
// candidates whose card is in re-issue were stuck at Step 10), but it is still
// collected: it stays in both MANDATORY_DOCUMENTS lists so Step 4's checklist
// keeps showing it as Required, and only the submit gate filters it out. That
// split is the whole design, so both halves are asserted here — a future edit
// that "tidies" PAN out of the rules list would silently stop asking for it.
function extractNonBlockingLabels(source: string): string[] {
  const start = source.indexOf("NON_BLOCKING_DOCUMENT_LABELS = new Set<string>(");
  const end = source.indexOf(");", start);
  const body = source.slice(start, end);
  return body.match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
}

describe("Onboarding — PAN Card is collected but does not block submission", () => {
  it("both sides declare the same non-blocking labels", () => {
    const backendLabels = extractNonBlockingLabels(backendService);
    const frontendLabels = extractNonBlockingLabels(frontendModule);

    expect(backendLabels).toEqual(["PAN Card"]);
    expect(frontendLabels).toEqual(backendLabels);
  });

  it("PAN Card is still a mandatory-document rule on both sides (still asked for)", () => {
    expect(extractRules(backendService, "const MANDATORY_DOCUMENTS").some((r) => r.label === "PAN Card")).toBe(true);
    expect(extractRules(frontendModule, "export const MANDATORY_DOCUMENT_RULES").some((r) => r.label === "PAN Card")).toBe(true);
  });

  it("submitFullOnboarding filters non-blocking labels out of its document gate", () => {
    const fn = backendService.slice(backendService.indexOf("export async function submitFullOnboarding"));
    const gate = fn.slice(
      fn.indexOf("await findMissingMandatoryDocuments(candidateId)"),
      fn.indexOf("MISSING_REQUIRED_DOCUMENTS"),
    );
    expect(gate).toContain("NON_BLOCKING_DOCUMENT_LABELS.has");
  });

  it("the frontend Submit button uses the blocking subset, not the full list", () => {
    const stepTen = readFileSync(
      resolve(process.cwd(), "..", "src", "components", "onboarding-full", "OnboardingSteps6to10.tsx"),
      "utf8",
    );
    expect(stepTen).toMatch(/const missingMandatoryDocs = findMissingBlockingDocs\(/);
    expect(stepTen).not.toMatch(/const missingMandatoryDocs = findMissingMandatoryDocs\(/);
  });
});

describe("Onboarding — bank account is not mandatory to submit", () => {
  it("submitFullOnboarding no longer hard-requires a candidate_onboarding_bank_detail row", () => {
    const fn = backendService.slice(
      backendService.indexOf("export async function submitFullOnboarding"),
      backendService.indexOf("await findMissingMandatoryDocuments(candidateId)")
    );
    expect(fn).not.toContain("candidate_onboarding_bank_detail");
    expect(fn).not.toContain("Bank details are required before submit");
  });
});
