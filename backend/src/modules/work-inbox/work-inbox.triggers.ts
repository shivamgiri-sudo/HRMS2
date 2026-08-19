import { createWorkItemIfNotExists } from "./work-inbox.service.js";
import { resolveActionItemDef } from "./action-item-registry.js";

function ttlMs(itemType: string, fallbackHours = 24): number {
  const def = resolveActionItemDef(itemType);
  return (def?.defaultTtlHours ?? fallbackHours) * 60 * 60 * 1000;
}

function dueAt(itemType: string, fallbackHours = 24): string {
  return new Date(Date.now() + ttlMs(itemType, fallbackHours)).toISOString();
}

export async function triggerOnboardingStuck(
  candidateId: string,
  candidateName: string,
  branchId?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "ONBOARDING_STUCK",
    title: `Onboarding stuck: ${candidateName}`,
    description: "Candidate onboarding incomplete for more than 48 hours",
    moduleCode: "ats",
    entityType: "candidate",
    entityId: candidateId,
    assignedToRole: "hr",
    branchId,
    priority: "high",
    dueAt: dueAt("ONBOARDING_STUCK"),
  });
}

export async function triggerNameMismatch(
  candidateId: string,
  candidateName: string,
  mismatches: string[]
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "NAME_MISMATCH",
    title: `Name mismatch: ${candidateName}`,
    description: `Sources mismatched: ${mismatches.join(", ")}`,
    moduleCode: "ats",
    entityType: "candidate",
    entityId: candidateId,
    assignedToRole: "hr",
    priority: "high",
    dueAt: dueAt("NAME_MISMATCH"),
  });
}

export async function triggerIncentiveApproval(
  batchId: string,
  batchRef: string,
  approverRole: string,
  branchId?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "INCENTIVE_APPROVAL",
    title: `Incentive batch approval: ${batchRef}`,
    moduleCode: "payroll",
    entityType: "incentive_batch",
    entityId: batchId,
    assignedToRole: approverRole,
    branchId,
    priority: "high",
    dueAt: dueAt("INCENTIVE_APPROVAL"),
  });
}

export async function triggerDpdpWithdrawalReview(
  withdrawalId: string,
  requesterName: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "DPDP_WITHDRAWAL_REVIEW",
    title: `DPDP withdrawal review: ${requesterName}`,
    moduleCode: "compliance",
    entityType: "dpdp_withdrawal",
    entityId: withdrawalId,
    assignedToRole: "compliance",
    priority: "high",
    dueAt: dueAt("DPDP_WITHDRAWAL_REVIEW"),
  });
}

export async function triggerTatBreach(
  tatInstanceId: string,
  taskType: string,
  entityId: string,
  assignedRole?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "TAT_BREACH",
    title: `TAT breach: ${taskType}`,
    moduleCode: "governance",
    entityType: "tat_instance",
    entityId: tatInstanceId,
    assignedToRole: assignedRole ?? "admin",
    priority: "critical",
    dueAt: dueAt("TAT_BREACH"),
  });
}

export async function triggerResignationDiscussion(
  exitId: string,
  employeeName: string,
  discussionType: "manager" | "hr"
): Promise<void> {
  const itemType = discussionType === "manager"
    ? "RESIGNATION_MANAGER_DISCUSSION"
    : "RESIGNATION_HR_DISCUSSION";
  await createWorkItemIfNotExists({
    itemType,
    title: `Resignation discussion pending: ${employeeName}`,
    moduleCode: "exit",
    entityType: "exit_request",
    entityId: exitId,
    assignedToRole: discussionType === "manager" ? "branch_head" : "hr",
    priority: "high",
    dueAt: dueAt(itemType),
  });
}

export async function triggerOfferApprovalPending(
  candidateId: string,
  candidateName: string
): Promise<void> {
  // branch_head_id on ats_branch_head_approval is an employees.id, not an auth_user id
  // (payroll-hr.service.ts:481 joins it straight to `employees e`), so it cannot be passed
  // as assignedToUserId — work_item.assigned_to_user_id is compared against the caller's
  // auth user id everywhere else in this module (see assertWorkItemAccess). Role-only
  // targeting, same as every other trigger in this file.
  await createWorkItemIfNotExists({
    itemType: "OFFER_APPROVAL_PENDING",
    title: `Offer awaiting branch-head approval: ${candidateName}`,
    description: "A candidate's offer is pending branch-head approval before onboarding can proceed.",
    moduleCode: "ats",
    entityType: "candidate",
    entityId: candidateId,
    assignedToRole: "branch_head",
    priority: "high",
    dueAt: dueAt("OFFER_APPROVAL_PENDING"),
  });
}

export async function triggerAwolSuspected(
  employeeId: string,
  employeeName: string,
  branchId?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "AWOL_SUSPECTED",
    title: `Possible AWOL: ${employeeName}`,
    description: "Marked absent for 3+ of their last 5 recorded attendance days, most recent record (within 3 days) is absent, no leave request covers the last 10 days, and no exit request is on file.",
    moduleCode: "attendance",
    entityType: "employee",
    entityId: employeeId,
    assignedToRole: "hr",
    branchId,
    priority: "high",
    dueAt: dueAt("AWOL_SUSPECTED"),
  });
}

export async function triggerJoiningDocsIncomplete(
  employeeId: string,
  employeeName: string,
  branchId?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "JOINING_DOCS_INCOMPLETE",
    title: `Joining documents incomplete: ${employeeName}`,
    description: "One or more mandatory joining documents are still pending upload, e-sign, or verification.",
    moduleCode: "employees",
    entityType: "employee",
    entityId: employeeId,
    assignedToRole: "hr",
    branchId,
    priority: "medium",
    dueAt: dueAt("JOINING_DOCS_INCOMPLETE"),
  });
}

export async function triggerPayrollBranchSignOff(
  branchId: string,
  branchName: string,
  month: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "PAYROLL_BRANCH_SIGNOFF_NOTIFY",
    title: `${branchName} signed off for ${month} — ready for payroll freeze`,
    description: `Branch Head has confirmed all payroll inputs are complete for ${branchName} (${month}). Review and freeze attendance to proceed.`,
    moduleCode: "payroll",
    entityType: "branch_readiness",
    entityId: branchId,
    assignedToRole: "payroll_head",
    branchId,
    priority: "high",
    dueAt: dueAt("PAYROLL_BRANCH_SIGNOFF_NOTIFY"),
  });
}

export async function triggerPayrollBranchReadinessIncomplete(
  branchId: string,
  branchName: string,
  month: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "PAYROLL_BRANCH_READINESS",
    title: `${branchName} payroll inputs incomplete for ${month}`,
    description: `Payroll readiness for ${branchName} (${month}) is not yet complete. Review attendance, incentives, deductions, and sign off once ready.`,
    moduleCode: "payroll",
    entityType: "branch_readiness",
    entityId: branchId,
    assignedToRole: "branch_head",
    branchId,
    priority: "high",
    dueAt: dueAt("PAYROLL_BRANCH_READINESS"),
  });
}

export async function triggerPayrollAttendanceFreezeRequest(
  branchId: string,
  branchName: string,
  month: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "PAYROLL_ATTENDANCE_FREEZE_REQUEST",
    title: `${branchName} requesting attendance freeze for ${month}`,
    description: `Branch Head / WFM has confirmed attendance data is complete for ${branchName} (${month}). Please freeze attendance in the Payroll module to unblock readiness.`,
    moduleCode: "payroll",
    entityType: "branch_readiness",
    entityId: branchId,
    assignedToRole: "payroll_head",
    branchId,
    priority: "high",
    dueAt: dueAt("PAYROLL_ATTENDANCE_FREEZE_REQUEST"),
  });
}

export async function triggerPayrollProcessSignOff(
  branchId: string,
  processId: string,
  processName: string,
  branchName: string,
  month: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "PAYROLL_PROCESS_SIGNOFF_NOTIFY",
    title: `${processName} (${branchName}) signed off for ${month}`,
    description: `Process Manager has confirmed all payroll inputs are complete for process "${processName}" in ${branchName} (${month}). Review and freeze to proceed.`,
    moduleCode: "payroll",
    entityType: "process_readiness",
    entityId: processId,
    assignedToRole: "payroll_head",
    branchId,
    priority: "high",
    dueAt: dueAt("PAYROLL_PROCESS_SIGNOFF_NOTIFY"),
  });
}

export async function triggerRegularizationPending(
  regularizationId: string,
  employeeName: string,
  branchId?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "REGULARIZATION_PENDING",
    title: `Regularization awaiting approval: ${employeeName}`,
    description: "An attendance regularization request is waiting on manager/WFM approval.",
    moduleCode: "attendance",
    entityType: "regularization",
    entityId: regularizationId,
    assignedToRole: "manager",
    branchId,
    priority: "medium",
    dueAt: dueAt("REGULARIZATION_PENDING"),
  });
}

export async function triggerResignationPendingReview(
  exitRequestId: string,
  employeeName: string,
  branchId?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "RESIGNATION_PENDING_REVIEW",
    title: `Resignation awaiting HR review: ${employeeName}`,
    description: "A newly submitted resignation is waiting on HR/manager review.",
    moduleCode: "exit",
    entityType: "resignation",
    entityId: exitRequestId,
    assignedToRole: "hr",
    branchId,
    priority: "high",
    dueAt: dueAt("RESIGNATION_PENDING_REVIEW"),
  });
}

export async function triggerPayrollSignOffPending(
  runId: string,
  runMonth: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "PAYROLL_SIGN_OFF_PENDING",
    title: `Payroll run awaiting sign-off: ${runMonth}`,
    description: `The ${runMonth} payroll run has finished calculation and is waiting on finance sign-off.`,
    moduleCode: "payroll",
    entityType: "payroll_run",
    entityId: runId,
    assignedToRole: "payroll_head",
    priority: "critical",
    dueAt: dueAt("PAYROLL_SIGN_OFF_PENDING"),
  });
}

export async function triggerPayrollProcessFreezeRequest(
  branchId: string,
  processId: string,
  processName: string,
  branchName: string,
  month: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "PAYROLL_PROCESS_FREEZE_REQUEST",
    title: `${processName} (${branchName}) requesting attendance freeze for ${month}`,
    description: `WFM has declared attendance data complete for process "${processName}" in ${branchName} (${month}). Please freeze attendance to unblock process readiness.`,
    moduleCode: "payroll",
    entityType: "process_readiness",
    entityId: processId,
    assignedToRole: "payroll_head",
    branchId,
    priority: "high",
    dueAt: dueAt("PAYROLL_PROCESS_FREEZE_REQUEST"),
  });
}

// ROSTER_PUBLISH_PENDING: fired once, at the moment a plan's
// wfm_roster_plan_control.approval_status flips to 'approved' — the only gap in the
// lifecycle where a roster sits waiting on a *separate* action (publish()) by the same or
// another Process Manager. Deliberately not fired at plan creation (an empty just-created
// draft isn't "awaiting publish", it's awaiting building) and not a periodic scan.
//
// Verified live 2026-08-19 before wiring this: wfm_roster_plan has ZERO rows and every one
// of the 413,386 wfm_roster_assignment rows already carries publish_status='published' —
// the "412,032 synthetic rows" finding referenced from rest-policy.service.ts is a single
// bulk INSERT timestamped 2026-06-11 18:23:31 (decision_source='manual'), and the remaining
// 1,354 rows are a second bulk load timestamped 2026-07-15 (decision_source='bulk_upload').
// Both cohorts were written directly to the table, bypassing createPlan()/approve()
// entirely, and are already terminal (published) — so they can never re-enter 'approved'
// and can never reach this trigger. There is nothing to grandfather (no existing backlog
// exists in this state) and no risk of the historical bulk data ever firing it.
export async function triggerRosterPublishPending(
  planId: string,
  planName: string,
  branchId?: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "ROSTER_PUBLISH_PENDING",
    title: `Roster awaiting publish: ${planName}`,
    description: "This roster has been approved and is waiting to be published.",
    moduleCode: "wfm",
    entityType: "roster_draft",
    entityId: planId,
    assignedToRole: "process_manager",
    branchId,
    priority: "high",
    dueAt: dueAt("ROSTER_PUBLISH_PENDING"),
  });
}
