import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("candidate assessment runtime safeguards", () => {
  it("keeps candidate process and role selection outside the public kiosk", () => {
    const page = readRepositoryFile("backend/src/modules/ats-assessment/assessment.page.ts");
    expect(page).not.toContain('id="process"');
    expect(page).not.toContain('id="role"');
    expect(page).toContain("queueFromQuery");
    expect(page.toLowerCase()).toContain("registered mobile number");
  });

  it("preserves an active typing draft locally without revealing correction details", () => {
    const page = readRepositoryFile("backend/src/modules/ats-assessment/assessment.page.ts");
    expect(page).toContain('const draftKey="ats_typing_draft_"+typingState.id');
    expect(page).toContain("localStorage.setItem(draftKey,event.target.value)");
    expect(page).toContain('localStorage.removeItem("ats_typing_draft_"+typingState.id)');
    expect(page).toContain("No live correction guidance");
    expect(page).toContain("Detailed feedback");
  });

  it("does not show character or word correctness before typing submission", () => {
    const page = readRepositoryFile("backend/src/modules/ats-assessment/assessment.page.ts");
    const liveStart = page.indexOf("function liveMetrics()");
    const liveEnd = page.indexOf("function renderTypingActive()", liveStart);
    const liveBlock = page.slice(liveStart, liveEnd);
    expect(liveBlock).toContain("typingAccuracy");
    expect(liveBlock).toContain("typingWpm");
    expect(liveBlock).not.toContain("class=\"correct\"");
    expect(liveBlock).not.toContain("class=\"incorrect\"");
    expect(liveBlock).not.toContain("expected:");
  });

  it("enforces one assessment and two typing attempts in server code", () => {
    const service = readRepositoryFile("backend/src/modules/ats-assessment/assessment.service.ts");
    const migration = readRepositoryFile("backend/sql/408_ats_candidate_assessment_engine.sql");
    expect(service).toContain("The single assessment attempt has already been used");
    expect(service).toContain("Maximum two typing attempts are allowed");
    expect(service).toContain("FOR UPDATE");
    expect(migration).toContain("uq_candidate_assessment_cycle");
    expect(migration).toContain("uq_typing_assessment_attempt");
  });
});
