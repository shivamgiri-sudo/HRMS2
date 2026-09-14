/**
 * Guards when candidate-portal credentials are issued.
 *
 * Selection used to generate a temp password and mail it immediately, writing
 * it to ats_candidate_portal_login — a table the login check never reads (it
 * reads ats_candidate_portal_access, whose only writer had zero callers). So
 * every selected candidate was mailed a password that could never work, often
 * before BGV or an offer even existed.
 *
 * Credentials are now issued once an employee code exists, from
 * employee-creation-orchestrator.service.ts, using the same
 * createPortalAccess() that already wrote the table login actually checks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const created: Array<{ candidateId: string; tempPassword: string }> = [];
const emailed: Array<{ to: string; tempPassword: string }> = [];

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn() },
}));
vi.mock("../src/modules/ats/candidate-portal.service.js", () => ({
  createPortalAccess: vi.fn(async (candidateId: string, tempPassword: string) => {
    created.push({ candidateId, tempPassword });
  }),
}));
vi.mock("../src/modules/ats/ats.email.service.js", () => ({
  sendSelectionCongratulationsEmail: vi.fn(async (params: { to: string; tempPassword: string }) => {
    emailed.push({ to: params.to, tempPassword: params.tempPassword });
    return { success: true };
  }),
}));
vi.mock("../src/modules/ats/ats.onboarding.service.js", () => ({
  sendOnboardingToken: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/shared/roleResolver.js", () => ({
  getUserRoleKeys: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/modules/inbox/inbox.service.js", () => ({
  inboxService: { create: vi.fn() },
}));

import { db } from "../src/db/mysql.js";
import { createPortalAccess } from "../src/modules/ats/candidate-portal.service.js";
import { sendSelectionCongratulationsEmail } from "../src/modules/ats/ats.email.service.js";
import { issueCandidatePortalAccess } from "../src/modules/ats/interview.service.js";

describe("issueCandidatePortalAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    created.length = 0;
    emailed.length = 0;
  });

  it("TC-PORTAL-01: writes to the table login actually reads, not the orphaned one", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[{
      id: "cand-1", full_name: "Test Candidate", email: "test@example.com",
      applied_for_branch: "Noida", branch_display_name: "NOIDA-2", applied_for_role: "Executive",
    }], []] as never);
    // Second SELECT: issueCandidatePortalAccess now looks up a live onboarding token on
    // ats_onboarding_bridge so the email carries one link rather than two. Without a value here
    // the bare vi.fn() resolves undefined and the service's .catch() throws on it.
    vi.mocked(db.execute).mockResolvedValueOnce([[], []] as never);

    await issueCandidatePortalAccess("cand-1");

    expect(createPortalAccess).toHaveBeenCalledTimes(1);
    expect(created[0]?.candidateId).toBe("cand-1");
    // No plaintext password should ever be persisted anywhere by this
    // function — the string only ever reaches createPortalAccess (which
    // hashes it) and the outbound email.
    // Two calls, both SELECTs - the candidate row and the onboarding-token lookup. The point of
    // this assertion is that nothing WRITES, so the count moves with the reads but no INSERT or
    // UPDATE may appear.
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(2);
  });

  it("TC-PORTAL-02: the emailed password matches the one that was hashed and stored", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[{
      id: "cand-1", full_name: "Test Candidate", email: "test@example.com",
      applied_for_branch: "Noida", branch_display_name: "NOIDA-2", applied_for_role: "Executive",
    }], []] as never);
    // Second SELECT: issueCandidatePortalAccess now looks up a live onboarding token on
    // ats_onboarding_bridge so the email carries one link rather than two. Without a value here
    // the bare vi.fn() resolves undefined and the service's .catch() throws on it.
    vi.mocked(db.execute).mockResolvedValueOnce([[], []] as never);

    await issueCandidatePortalAccess("cand-1");

    expect(sendSelectionCongratulationsEmail).toHaveBeenCalledTimes(1);
    expect(emailed[0]?.tempPassword, "the emailed password and the stored one diverged")
      .toBe(created[0]?.tempPassword);
    expect(emailed[0]?.tempPassword.length).toBeGreaterThanOrEqual(8);
  });

  it("TC-PORTAL-03: does nothing for a candidate with no email on file", async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[{
      id: "cand-1", full_name: "Test Candidate", email: null,
      applied_for_branch: "Noida", branch_display_name: "NOIDA-2", applied_for_role: "Executive",
    }], []] as never);

    await issueCandidatePortalAccess("cand-1");

    expect(createPortalAccess).not.toHaveBeenCalled();
    expect(sendSelectionCongratulationsEmail).not.toHaveBeenCalled();
  });

  it("TC-PORTAL-04: selection no longer issues credentials directly", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync(
      new URL("../src/modules/ats/interview.service.ts", import.meta.url),
      "utf8",
    );
    const selectionFn = source
      .slice(
        source.indexOf("async function handleCandidateSelection"),
        // The next declaration after handleCandidateSelection in the file —
        // ends the slice before generateTempPassword's own definition, whose
        // signature otherwise satisfies the "generateTempPassword()" pattern
        // below just as a call would.
        source.indexOf("\nfunction generateTempPassword"),
      )
      // The explanatory comment legitimately names the old table/call for
      // context — assert against the executable code, not the commentary.
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(selectionFn, "handleCandidateSelection still generates a temp password directly")
      .not.toMatch(/generateTempPassword\(\)/);
    expect(selectionFn, "handleCandidateSelection still writes the orphaned login table")
      .not.toMatch(/ats_candidate_portal_login/);
  });
});
