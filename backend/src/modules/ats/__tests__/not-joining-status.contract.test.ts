/**
 * "Mark candidate as not joining" — HR needs to stop every automated and
 * manual follow-up (email, SMS, in-app reminder) for a candidate who has
 * told them they're not joining, without anyone having to remember to
 * individually silence the nightly reminder cron, the "Send Reminder"
 * button and the "Resend Onboarding Link" button.
 *
 * Written to ats_candidate.candidate_status (free-text VARCHAR(50)) rather
 * than a new ENUM value on ats_onboarding_request.status or
 * ats_candidate.profile_status — both of those are strict ENUMs with no
 * "not joining" value and would need a schema migration to add one; this
 * needed none.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

vi.mock("../../../config/env.js", () => ({ env: { FRONTEND_URL: "https://hrms.test" } }));

const {
  markCandidateNotJoining,
  clearCandidateNotJoining,
  sendOnboardingProgressReminder,
  sendOnboardingToken,
} = await import("../ats.onboarding.service.js");

beforeEach(() => {
  execute.mockReset();
  logSensitiveAction.mockReset().mockResolvedValue(undefined);
});

describe("markCandidateNotJoining", () => {
  it("requires a non-empty reason", async () => {
    await expect(markCandidateNotJoining("cand-1", "actor-1", "")).rejects.toMatchObject({ statusCode: 400 });
    await expect(markCandidateNotJoining("cand-1", "actor-1", "   ")).rejects.toMatchObject({ statusCode: 400 });
    expect(execute).not.toHaveBeenCalled();
  });

  it("404s when the candidate doesn't exist", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(markCandidateNotJoining("cand-1", "actor-1", "Took another offer")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("sets candidate_status to not_joining and logs the reason", async () => {
    execute
      .mockResolvedValueOnce([[{ id: "cand-1", candidate_status: "selected" }], []]) // existence check
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]); // the UPDATE

    const result = await markCandidateNotJoining("cand-1", "actor-1", "Took another offer");

    expect(result).toEqual({ candidateId: "cand-1", candidateStatus: "not_joining" });
    const updateCall = execute.mock.calls[1];
    expect(String(updateCall[0])).toMatch(/UPDATE ats_candidate SET candidate_status = 'not_joining'/);
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "CANDIDATE_MARKED_NOT_JOINING",
        entity_id: "cand-1",
        reason: "Took another offer",
      }),
    );
  });
});

describe("clearCandidateNotJoining", () => {
  it("reverts candidate_status back to selected and logs it", async () => {
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    await clearCandidateNotJoining("cand-1", "actor-1");
    expect(String(execute.mock.calls[0][0])).toMatch(/candidate_status = IF\(candidate_status = 'not_joining', 'selected'/);
    expect(logSensitiveAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "CANDIDATE_NOT_JOINING_CLEARED", entity_id: "cand-1" }),
    );
  });
});

describe("sendOnboardingProgressReminder — respects the not-joining flag", () => {
  it("refuses to send when candidate_status is not_joining", async () => {
    execute.mockResolvedValueOnce([[{
      full_name: "Test Candidate", mobile: "9999999999", email: "t@example.com",
      candidate_status: "not_joining",
      onboarding_token: "tok", current_step_idx: 2, bgv_consent: 1, dpdp_consent: 1,
    }], []]);

    await expect(sendOnboardingProgressReminder("cand-1", "actor-1")).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("sendOnboardingToken (send/resend link) — respects the not-joining flag", () => {
  it("refuses to (re)send a link when candidate_status is not_joining", async () => {
    execute.mockResolvedValueOnce([[{
      id: "cand-1", full_name: "Test Candidate", email: "t@example.com", mobile: "9999999999",
      applied_for_branch: "NOIDA", candidate_status: "not_joining",
      resolved_branch_id: "branch-1", branch_name: "Noida",
    }], []]);

    await expect(sendOnboardingToken("cand-1", "actor-1")).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("nightly reminder cron — excludes not_joining candidates", () => {
  it("the eligibility query checks candidate_status <> 'not_joining'", () => {
    const cron = readFileSync(resolve(process.cwd(), "src/modules/ats/ats-reminders.cron.ts"), "utf8");
    expect(cron).toMatch(/candidate_status,\s*''\)\s*<>\s*'not_joining'/);
  });
});

describe("PATCH .../not-joining route — gated narrower than resend/reminder", () => {
  it("requires admin/super_admin/hr, not the broader recruiter/payroll_hr/branch_hr set", () => {
    const routes = readFileSync(resolve(process.cwd(), "src/modules/ats/ats.onboarding.routes.ts"), "utf8");
    const handler = routes.slice(routes.indexOf("'/candidates/:id/not-joining'"), routes.indexOf("'/candidates/:id/not-joining/clear'"));
    expect(handler).toContain("requireRole('admin', 'super_admin', 'hr')");
    expect(handler).toContain("markCandidateNotJoining");
  });
});
