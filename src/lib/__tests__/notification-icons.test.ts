import { describe, expect, it } from "vitest";
import { resolveNotificationIcon } from "../notification-icons";

/**
 * Before this map existed, every notification rendered the exact same generic Bell icon
 * regardless of type — NotificationBell.tsx's only per-type logic matched "warning"/"error"/
 * "success", none of which any real notification type produced anywhere in the backend ever
 * uses. These are the real, currently-produced type strings (grepped from every
 * inboxService.createItem call site), so this locks in that they no longer fall through to
 * the generic default.
 */
describe("resolveNotificationIcon", () => {
  const realTypesThatMustNotBeGeneric = [
    "grn_approval_pending",
    "budget_approval_pending",
    "REIMBURSEMENT_MANAGER_PENDING",
    "REIMBURSEMENT_APPROVED",
    "REIMBURSEMENT_REJECTED",
    "VENDOR_PAYMENT_PENDING",
    "payroll_head_review_pending",
    "leave_request",
    "leave_raised_by_manager",
    "attendance_flagged_by_manager",
    "attendance_regularization",
    "week_off_preference",
    "helpdesk_ticket_assigned",
    "helpdesk_ticket_sla_breached",
    "grievance_status_changed",
    "requisition_approved",
    "requisition_rejected",
    "offer_approved",
    "offer_rejected_by_branch_head",
    "candidate_selected",
    "candidate_no_show",
    "onboarding_overdue",
    "esign_completed",
    "profile_photo_required",
    "visitor_approval_needed",
    "walkin_submission_sla",
    "interview_submission_overdue",
  ];

  it.each(realTypesThatMustNotBeGeneric)("gives %s a real icon, not the generic Bell fallback", (type) => {
    const { icon } = resolveNotificationIcon(type);
    const { icon: fallback } = resolveNotificationIcon("__unknown_type_no_one_produces__");
    expect(icon).not.toBe(fallback);
  });

  it("still falls back to Bell/info for a genuinely unrecognised type, rather than throwing", () => {
    const result = resolveNotificationIcon("some_future_type_nobody_has_written_yet");
    expect(result.tone).toBe("info");
    expect(result.icon).toBeTruthy();
  });

  it("is case- and format-insensitive, since real types mix UPPER_SNAKE and lower_snake", () => {
    expect(resolveNotificationIcon("grn_approval_pending").icon)
      .toBe(resolveNotificationIcon("GRN_APPROVAL_PENDING").icon);
  });

  it("marks a rejection as danger and an approval as success for the same finance domain", () => {
    expect(resolveNotificationIcon("REIMBURSEMENT_REJECTED").tone).toBe("danger");
    expect(resolveNotificationIcon("REIMBURSEMENT_APPROVED").tone).toBe("success");
  });

  it("handles null/undefined without throwing", () => {
    expect(() => resolveNotificationIcon(null)).not.toThrow();
    expect(() => resolveNotificationIcon(undefined)).not.toThrow();
  });
});
