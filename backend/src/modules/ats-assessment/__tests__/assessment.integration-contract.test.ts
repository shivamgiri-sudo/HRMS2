import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("ATS assessment integration contracts", () => {
  it("keeps assessment route mounting additive around the existing auth boundary", () => {
    const routes = readRepositoryFile("backend/src/modules/ats-extensions/ats-ext.routes.ts");
    const publicMount = routes.indexOf("router.use(assessmentPublicRouter)");
    const authBoundary = routes.indexOf("router.use(requireAuth)");
    const protectedMount = routes.indexOf("router.use(assessmentProtectedRouter)");

    expect(publicMount).toBeGreaterThan(-1);
    expect(authBoundary).toBeGreaterThan(publicMount);
    expect(protectedMount).toBeGreaterThan(authBoundary);
    expect(routes).toContain('router.post("/offers/:id/respond"');
    expect(routes).toContain('router.get("/requisitions"');
  });

  it("adds the registration launch only when a queue token exists and the feature is enabled", () => {
    const registration = readRepositoryFile("src/pages/NativeATSCandidateRegistration.tsx");
    expect(registration).toContain("tokenNumber?: string");
    expect(registration).toContain("apiRes.tokenNumber ?? apiRes.data?.tokenNumber");
    expect(registration).toContain("const [assessmentEnabled, setAssessmentEnabled] = useState(false)");
    expect(registration).toContain('/api/ats-ext/assessment/health');
    expect(registration).toContain('health.data?.status === "enabled"');
    expect(registration).toContain("{result?.tokenNumber && assessmentEnabled && (");
    expect(registration).toContain("/api/ats-ext/assessment?queueToken=");
    expect(registration).toContain('setScreen("success")');
    expect(registration).toContain("Consent logging failure must not block successful registration");
  });

  it("keeps recruiter assessment data read-only and separate from interview submission fields", () => {
    const workspace = readRepositoryFile("src/pages/NativeATSRecruiterWorkspace.tsx");
    expect(workspace).toContain("Pre-employment Assessment — Read Only");
    expect(workspace).toContain("assessment-admin/candidates/${encodeURIComponent(c.candidateId)}/summary");
    expect(workspace).toContain("Assessment information is advisory");
    expect(workspace).toContain("No assessment is assigned or the assessment feature is disabled");

    const assessmentFetchBlock = workspace.slice(
      workspace.indexOf("setAssessmentSummary(null)"),
      workspace.indexOf("setSubstituteMode(isSubstitute)"),
    );
    expect(assessmentFetchBlock).not.toContain("setForm(");
    expect(assessmentFetchBlock).not.toContain("skillTypingScore");
    expect(assessmentFetchBlock).not.toContain("skillAiScore");

    // Existing canonical interview submission remains present and unchanged in purpose.
    expect(workspace).toContain('/api/ats-full-parity/recruiter-submission');
    expect(workspace).toContain("skillTestTyping: form.skillTypingScore");
    expect(workspace).toContain("skillTestAi: form.skillAiScore");
  });

  it("keeps migration 408 isolated to assessment-owned tables", () => {
    const migration = readRepositoryFile("backend/sql/408_ats_candidate_assessment_engine.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS ats_candidate_assessment");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS ats_typing_test_attempt");
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+ats_candidate\b/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+ats_queue_token\b/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+ats_interview_submission\b/i);
    expect(migration).not.toMatch(/UPDATE\s+ats_candidate\b/i);
    expect(migration).not.toMatch(/UPDATE\s+ats_queue_token\b/i);
  });

  it("does not write assessment scores into existing candidate or interview skill fields", () => {
    const service = readRepositoryFile("backend/src/modules/ats-assessment/assessment.service.ts");
    expect(service).not.toMatch(/UPDATE\s+ats_candidate\s+SET\s+skilltest_/i);
    expect(service).not.toMatch(/UPDATE\s+ats_interview_submission/i);
    expect(service).not.toContain("skilltest_typing =");
    expect(service).not.toContain("skilltest_ai =");
  });
});
