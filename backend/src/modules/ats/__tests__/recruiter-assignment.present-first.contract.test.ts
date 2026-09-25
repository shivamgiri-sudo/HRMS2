import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(backendRoot, rel), "utf8");

/**
 * 2026-09-25: 20 still-Waiting candidates (Meta leads / online applications) had no recruiter and so
 * appeared on nobody's My Candidates. Assignment only ran in walk-in registration. Owner: every
 * candidate must be assigned to a PRESENT recruiter of their branch.
 */
describe("recruiter assignment prefers present recruiters and covers Meta leads", () => {
  const enhanced = read("src/modules/ats/ats.enhanced.service.ts");
  const meta = read("src/modules/meta-campaign/meta-campaign.service.ts");

  it("picks among present recruiters first, and only falls back to the whole branch when none are present", () => {
    expect(enhanced).toContain("Number(r.present_today) === 1");
    expect(enhanced).toMatch(/present\.length > 0 \? present : available/);
  });

  it("both assignment paths (preferred unavailable, none preferred) use the same picker", () => {
    expect(enhanced.match(/pickLeastLoadedRecruiter\(availableRecruiters\)/g)).toHaveLength(2);
  });

  it("offers a sweep that only touches active, Waiting, unowned candidates that have a branch", () => {
    const sweep = enhanced.slice(enhanced.indexOf("export async function assignUnassignedCandidates("));
    expect(sweep).toContain("status = 'Waiting'");
    expect(sweep).toContain("recruiter_assigned_name IS NULL OR recruiter_assigned_name = ''");
    expect(sweep).toContain("COALESCE(applied_for_branch, '') <> ''");
    expect(sweep).toContain("candidate_code NOT LIKE 'IDC%'");
  });

  it("assigns a Meta lead's candidate on creation and re-tries unowned ones in the heal job", () => {
    expect(meta).toMatch(/assignRecruiterToCandidate\(candidateId, null\)/);
    expect(meta).toContain("assignUnassignedCandidates(");
  });
});
