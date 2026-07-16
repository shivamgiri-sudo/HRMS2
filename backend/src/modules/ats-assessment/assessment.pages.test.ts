import { describe, expect, it } from "vitest";
import { assessmentAdminPage } from "./assessment.admin.page.js";
import { candidateAssessmentPage } from "./assessment.page.js";

function scriptFrom(page: string) {
  const match = page.match(/<script>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("Inline portal script was not found");
  return match[1];
}

describe("assessment portal HTML", () => {
  it("produces a syntactically valid candidate portal script", () => {
    const page = candidateAssessmentPage();
    expect(page).toContain("Assessment attempt: 1 only");
    expect(page).toContain("Typing attempts: maximum 2");
    expect(page).not.toContain("id=\"process\"");
    expect(page).not.toContain("id=\"role\"");
    expect(() => new Function(scriptFrom(page))).not.toThrow();
  });

  it("produces a syntactically valid staff portal script", () => {
    const page = assessmentAdminPage();
    expect(page).toContain("Candidate Assessment Control");
    expect(page).toContain("Manual Review");
    expect(page).toContain("Process Mapping");
    expect(() => new Function(scriptFrom(page))).not.toThrow();
  });
});
