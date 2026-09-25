import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { excludeUnregisteredLeadCandidatesSql } from "../ats-reporting-scope.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

describe("excludeUnregisteredLeadCandidatesSql", () => {
  const sql = excludeUnregisteredLeadCandidatesSql("ats_candidate");

  it("holds back only Social Media candidates with no registration trace", () => {
    expect(sql).toContain("ats_candidate.sourcing_channel = 'Social Media'");
    expect(sql).toContain("COALESCE(ats_candidate.profile_status, '') = ''");
    expect(sql).toContain("ats_candidate.walk_in_date IS NULL");
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM ats_queue_token lqt WHERE lqt\.candidate_id = ats_candidate\.id\)/);
  });

  it("uses whatever alias the caller passes", () => {
    const aliased = excludeUnregisteredLeadCandidatesSql("c");
    expect(aliased).toContain("c.sourcing_channel");
    expect(aliased).toContain("lqt.candidate_id = c.id");
    expect(aliased).not.toContain("ats_candidate.");
  });

  it("is applied to both recruiter pending queues", () => {
    const service = fs.readFileSync(
      path.join(backendRoot, "src/modules/ats-full-parity/recruiterInterview.service.ts"),
      "utf8",
    );
    expect(service.match(/excludeUnregisteredLeadCandidatesSql\("ats_candidate"\)/g)).toHaveLength(2);
  });
});
