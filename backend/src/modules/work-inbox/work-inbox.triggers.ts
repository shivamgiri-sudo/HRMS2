import { createWorkItemIfNotExists } from "./work-inbox.service.js";

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
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
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
    dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
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
    dueAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
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
  });
}

export async function triggerResignationDiscussion(
  exitId: string,
  employeeName: string,
  discussionType: "manager" | "hr"
): Promise<void> {
  await createWorkItemIfNotExists({
    itemType:
      discussionType === "manager"
        ? "RESIGNATION_MANAGER_DISCUSSION"
        : "RESIGNATION_HR_DISCUSSION",
    title: `Resignation discussion pending: ${employeeName}`,
    moduleCode: "exit",
    entityType: "exit_request",
    entityId: exitId,
    assignedToRole: discussionType === "manager" ? "branch_head" : "hr",
    priority: "high",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
}
