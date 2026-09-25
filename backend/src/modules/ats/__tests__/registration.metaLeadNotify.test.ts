import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { recruiterNotificationEmail } from "../email.templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const data = {
  recruiterName: "MEHAR",
  candidateName: "TEST LEAD",
  candidateMobile: "9999999999",
  tokenNumber: "NOI-1",
  branchDisplayName: "NOIDA",
  roleApplied: "Inbound Agent",
};

describe("recruiter notification for a META lead that registered", () => {
  it("says the candidate came from a META lead ad and is now in the queue and My Candidates", () => {
    const html = recruiterNotificationEmail({ ...data, metaLead: true });
    expect(html).toContain("META Lead Registered");
    expect(html).toContain("META lead ad");
    expect(html).toContain("walk-in queue and on My Candidates");
  });

  it("leaves the ordinary walk-in email unchanged", () => {
    const html = recruiterNotificationEmail(data);
    expect(html).toContain("New Candidate Assigned");
    expect(html).not.toContain("META");
  });

  it("registration notifies the recruiter for a META lead even when the candidate gave no email", () => {
    const src = fs.readFileSync(
      path.join(backendRoot, "src/modules/ats/registration.enhanced.routes.ts"),
      "utf8",
    );
    expect(src).toContain("SELECT 1 FROM meta_lead_raw WHERE ats_candidate_id = ?");
    expect(src).toContain("recruiterEmail && recruiterDetails && (input.email || isMetaLead)");
    expect(src).toContain("metaLead: isMetaLead");
  });
});
