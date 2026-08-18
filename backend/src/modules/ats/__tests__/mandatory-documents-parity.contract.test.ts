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

describe("Onboarding — bank account is not mandatory to submit", () => {
  it("submitFullOnboarding no longer hard-requires a candidate_onboarding_bank_detail row", () => {
    const fn = backendService.slice(
      backendService.indexOf("export async function submitFullOnboarding"),
      backendService.indexOf("const missingDocuments = await findMissingMandatoryDocuments")
    );
    expect(fn).not.toContain("candidate_onboarding_bank_detail");
    expect(fn).not.toContain("Bank details are required before submit");
  });
});
