import { createWorkItemIfNotExists } from "./work-inbox.service.js";
import { resolveActionItemDef } from "./action-item-registry.js";

function ttlMs(itemType: string, fallbackHours = 24): number {
  const def = resolveActionItemDef(itemType);
  return (def?.defaultTtlHours ?? fallbackHours) * 60 * 60 * 1000;
}

/**
 * MySQL DATETIME literal, not ISO-8601.
 *
 * This returned `.toISOString()` — "2026-08-30T11:38:45.248Z" — which MySQL rejects for a
 * DATETIME column with ER_TRUNCATED_WRONG_VALUE (1292) because of the "T" separator and the
 * "Z" suffix. createWorkItemIfNotExists swallows the resulting error, so every trigger in
 * this file failed silently: the caller's own work succeeded and the work item was simply
 * never created.
 *
 * Verified live 2026-08-28: 0 of 35 work_item rows have a non-NULL due_at — the column has
 * never once been populated, so anything keyed on it (SLA countdowns, escalation, overdue
 * queues) has never fired. All 19 dueAt() call sites in this file share this helper, so
 * they were all affected.
 *
 * Host-LOCAL wall clock, not UTC. work_item.created_at and due_at are both plain DATETIME
 * (no timezone), and created_at is written with NOW(), which on this database is IST.
 * Formatting UTC here stored a due date 5.5 hours EARLIER than the created_at it is
 * compared against — a 48h TTL measured as 42.5h, expiring early and silently.
 *
 * Confirm the server's wall clock with DATE_FORMAT(NOW(), ...), never by reading NOW()
 * through mysql2. The driver parses a DATETIME in the connection's timezone and hands back
 * a JS Date, so `SELECT NOW()` surfaces as "...T11:40:06.000Z" on an IST server and reads
 * exactly like proof the server is UTC. DATE_FORMAT returns the stored characters and shows
 * 17:10. This masking is what made the first attempt at this fix wrong.
 */
function dueAt(itemType: string, fallbackHours = 24): string {
  const d = new Date(Date.now() + ttlMs(itemType, fallbackHours));
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
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

/**
 * The approval queue item for a gated bulk upload, raised once per stage.
 *
 * `approverRole` is a parameter rather than a registry default because the same batch is
 * addressed to a different role at each stage — branch_head first, payroll_head after —
 * and createWorkItemIfNotExists dedupes on (entity, item type, open), so the stage-2 item
 * only appears once the stage-1 one has been completed.
 */
export async function triggerBulkBatchApproval(
  uploadBatchId: string,
  batchNo: string,
  uploadTypeCode: string,
  approverRole: string,
  branchId?: string | null,
): Promise<void> {
  const label = uploadTypeCode === "DEDUCTION_BULK" ? "Deduction" : "Incentive";
  await createWorkItemIfNotExists({
    itemType: "BULK_UPLOAD_APPROVAL",
    title: `${label} upload awaiting approval: ${batchNo}`,
    moduleCode: "payroll",
    entityType: "upload_batch",
    entityId: uploadBatchId,
    assignedToRole: approverRole,
    branchId: branchId ?? undefined,
    priority: "high",
    dueAt: dueAt("BULK_UPLOAD_APPROVAL"),
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

/**
 * Cost-centre attendance sign-off chain (payroll-cc-attendance.service.ts).
 *
 * entityId is the finalization row id, not the branch id, so each cost centre's item is distinct —
 * createWorkItemIfNotExists dedupes on (itemType, entityType, entityId), and keying on the branch
 * would have collapsed every cost centre in a branch into one notification.
 */
export async function triggerCcAttendanceFinalized(
  branchId: string,
  finalizationId: string,
  month: string,
  employeeCount: number
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "CC_ATTENDANCE_FINALIZED",
    title: `Cost-centre attendance finalized for ${month} — awaiting your approval`,
    description: `Branch Payroll HR has finalized a cost centre's attendance (${employeeCount} employees) for ${month}. Review the employee day counts and approve, or send it back with a reason.`,
    moduleCode: "payroll",
    entityType: "cc_attendance",
    entityId: finalizationId,
    assignedToRole: "branch_head",
    branchId,
    priority: "high",
    dueAt: dueAt("CC_ATTENDANCE_FINALIZED"),
  });
}

export async function triggerCcAttendanceBranchApproved(
  branchId: string,
  finalizationId: string,
  month: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "CC_ATTENDANCE_BRANCH_APPROVED",
    title: `Cost-centre attendance approved by Branch Head for ${month}`,
    description: `A cost centre's attendance for ${month} has cleared Branch Head approval and is waiting on final HO Payroll Head approval.`,
    moduleCode: "payroll",
    entityType: "cc_attendance",
    entityId: finalizationId,
    assignedToRole: "payroll_head",
    branchId,
    priority: "high",
    dueAt: dueAt("CC_ATTENDANCE_BRANCH_APPROVED"),
  });
}

export async function triggerCcAttendanceUnlockRequested(
  branchId: string,
  finalizationId: string,
  month: string
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "CC_ATTENDANCE_UNLOCK_REQUESTED",
    title: `Unlock requested for an approved cost centre — ${month}`,
    description: `A branch has found a pending attendance correction after HO approval for ${month} and is asking for the cost centre to be unlocked. Granting it sends the cost centre back through all three approval stages.`,
    moduleCode: "payroll",
    entityType: "cc_attendance",
    entityId: finalizationId,
    assignedToRole: "payroll_head",
    branchId,
    priority: "high",
    dueAt: dueAt("CC_ATTENDANCE_UNLOCK_REQUESTED"),
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

// ATTENDANCE_MISMATCH: one digest item per branch, not per attendance_reconciliation_issue
// row or per employee — see attendance-mismatch-branch-digest.service.ts for why (that
// table grows 500-990 rows/day across a near-1:1 count of distinct employees, so anything
// finer-grained floods wfm/hr). entityId is the branch id, exactly like
// triggerPayrollBranchReadinessIncomplete uses branchId as both entityId and branchId.
//
// createWorkItemIfNotExists dedups on (entityType, entityId, itemType, status='pending'),
// so once a branch has a pending digest item, later calls here (the digest re-scans daily)
// no-op rather than refresh the employee count in the title — the same "can go stale until
// the item is completed" property runPayrollBranchReadinessReminders() already has for
// PAYROLL_BRANCH_READINESS (fires once per branch per month, then no-ops while
// readiness_status stays incomplete for the rest of the month). Not a new characteristic
// introduced here.
export async function triggerAttendanceMismatchBranchBacklog(
  branchId: string,
  branchName: string,
  employeeCount: number
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType: "ATTENDANCE_MISMATCH",
    title: `${employeeCount} employee${employeeCount === 1 ? "" : "s"} in ${branchName} have unresolved attendance exceptions`,
    description: `Reconciliation against biometric, APR and payroll sources found unresolved attendance exceptions (most commonly missing biometric enrollment) for ${employeeCount} employee${employeeCount === 1 ? "" : "s"} in ${branchName}. Review in the Attendance Exception Engine.`,
    moduleCode: "attendance",
    entityType: "branch",
    entityId: branchId,
    assignedToRole: "wfm",
    branchId,
    priority: "medium",
    dueAt: dueAt("ATTENDANCE_MISMATCH"),
  });
}
