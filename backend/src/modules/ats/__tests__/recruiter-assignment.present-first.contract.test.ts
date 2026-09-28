import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(backendRoot, rel), "utf8");

/**
 * 2026-09-25: owner: every REGISTERED candidate must be assigned to a PRESENT recruiter of their
 * branch. A Meta lead that has not filled the registration form is not a walk-in yet — it is not
 * assigned, queued or shown on My Candidates until it registers.
 */
describe("recruiter assignment prefers present recruiters and leaves unregistered Meta leads alone", () => {
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

  it("does not assign an unregistered Meta lead: it gets its recruiter when it fills the registration form", () => {
    expect(meta).not.toMatch(/assignRecruiterToCandidate/);
    expect(meta).not.toMatch(/assignUnassignedCandidates/);
    const sweep = enhanced.slice(enhanced.indexOf("export async function assignUnassignedCandidates("));
    expect(sweep).toContain("excludeUnregisteredLeadCandidatesSql(");
  });
});
