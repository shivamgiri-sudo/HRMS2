import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONBOARDING_STUCK was a registered Work Inbox item_type with a fully-written trigger
 * function (triggerOnboardingStuck in work-inbox.triggers.ts) that nothing ever called —
 * confirmed live, zero work_item rows of this type ever existed (delta-audit 2026-08-14,
 * Stage 7b, user-approved: wire up the producers that already have code, leave the rest as
 * a known gap). runOnboardingIncompleteReminders is already the canonical detector for this
 * exact population (candidates 3+ days past selection with an unsubmitted onboarding
 * portal), so it's the correct trigger point — additional to, not instead of, the existing
 * inboxService recruiter nudge.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { createItem } = vi.hoisted(() => ({ createItem: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem } }));

const { sendOnboardingTokenEmail } = vi.hoisted(() => ({ sendOnboardingTokenEmail: vi.fn() }));
vi.mock("../ats.email.service.js", () => ({ sendOnboardingTokenEmail }));

vi.mock("../../../config/env.js", () => ({ env: { FRONTEND_URL: "https://hrms.test" } }));

const { triggerOnboardingStuck } = vi.hoisted(() => ({ triggerOnboardingStuck: vi.fn() }));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({ triggerOnboardingStuck }));

const { runOnboardingIncompleteReminders } = await import("../ats-reminders.cron.js");

const CANDIDATE_ROW = {
  candidate_id: "cand-1",
  full_name: "Test Candidate",
  email: "candidate@example.com",
  applied_for_branch: "NOIDA",
  branch_display_name: "Noida",
  bridge_id: "bridge-1",
  onboarding_token: "tok-abc",
  bridge_created: new Date("2026-08-10T00:00:00Z"),
  recruiter_employee_id: "recruiter-emp-1",
};

beforeEach(() => {
  execute.mockReset();
  createItem.mockReset().mockResolvedValue(undefined);
  sendOnboardingTokenEmail.mockReset().mockResolvedValue(undefined);
  triggerOnboardingStuck.mockReset().mockResolvedValue(undefined);
});

describe("runOnboardingIncompleteReminders creates a Work Inbox ONBOARDING_STUCK item", () => {
  it("calls triggerOnboardingStuck for each stuck candidate, alongside the existing inbox nudge", async () => {
    execute
      .mockResolvedValueOnce([[CANDIDATE_ROW], []]) // the stuck-candidate query
      .mockResolvedValueOnce([{}, []])              // reminder_sent_at UPDATE
      .mockResolvedValueOnce([[{ id: "user-1" }], []]); // recruiter user lookup

    await runOnboardingIncompleteReminders();

    expect(triggerOnboardingStuck).toHaveBeenCalledWith("cand-1", "Test Candidate");
    expect(createItem).toHaveBeenCalledTimes(1); // the pre-existing recruiter nudge still fires too
  });

  it("does not skip the recruiter nudge or the reminder email when triggerOnboardingStuck fails", async () => {
    triggerOnboardingStuck.mockRejectedValue(new Error("db down"));
    execute
      .mockResolvedValueOnce([[CANDIDATE_ROW], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([[{ id: "user-1" }], []]);

    await runOnboardingIncompleteReminders();

    expect(sendOnboardingTokenEmail).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there are no stuck candidates", async () => {
    execute.mockResolvedValueOnce([[], []]);

    await runOnboardingIncompleteReminders();

    expect(triggerOnboardingStuck).not.toHaveBeenCalled();
  });
});
