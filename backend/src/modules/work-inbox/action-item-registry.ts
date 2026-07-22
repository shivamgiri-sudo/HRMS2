/**
 * PeopleOS Action Centre — Action Item Type Registry
 *
 * Every work item type that can appear in the Action Centre must be
 * registered here. This enables:
 * - Compile-time validation of item types in triggers
 * - Structured deeplink generation for each action
 * - Role-assignment defaults without hardcoding in trigger functions
 * - UI rendering hints (icon, colour, urgency)
 */
import type { RoleKey } from "../../platform/policy/index.js";

export const ACTION_PRIORITY = {
  CRITICAL: "critical",
  HIGH:     "high",
  MEDIUM:   "medium",
  LOW:      "low",
} as const;
export type ActionPriority = typeof ACTION_PRIORITY[keyof typeof ACTION_PRIORITY];

export interface ActionItemDefinition {
  itemType:         string;
  displayName:      string;
  module:           string;           // module_code from peopleos-module-registry
  entityType:       string;           // e.g. "candidate", "employee", "payroll_run"
  defaultAssigneeRoles: RoleKey[];    // first matching role for the scope gets the item
  defaultPriority:  ActionPriority;
  defaultTtlHours:  number;           // time until auto-escalation / expiry
  deeplinkPattern:  string;           // frontend route template, e.g. /ats/walkin-queue?id={entityId}
  requiresScope:    boolean;          // if true, branchId/processId must be provided when creating
}

export const ACTION_ITEM_REGISTRY: ActionItemDefinition[] = [
  // ── ATS ─────────────────────────────────────────────────────────────────────
  {
    itemType:          "ONBOARDING_STUCK",
    displayName:       "Onboarding stuck",
    module:            "ATS",
    entityType:        "candidate",
    defaultAssigneeRoles: ["hr", "recruitment_hr"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   24,
    deeplinkPattern:   "/ats/onboarding-requests?candidateId={entityId}",
    requiresScope:     true,
  },
  {
    itemType:          "NAME_MISMATCH",
    displayName:       "Candidate name mismatch",
    module:            "ATS",
    entityType:        "candidate",
    defaultAssigneeRoles: ["hr", "recruitment_hr"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   48,
    deeplinkPattern:   "/ats/name-consistency?candidateId={entityId}",
    requiresScope:     false,
  },
  {
    itemType:          "BGV_PENDING",
    displayName:       "BGV verification pending",
    module:            "ATS",
    entityType:        "candidate",
    defaultAssigneeRoles: ["hr"],
    defaultPriority:   ACTION_PRIORITY.MEDIUM,
    defaultTtlHours:   72,
    deeplinkPattern:   "/ats/bgv?candidateId={entityId}",
    requiresScope:     true,
  },
  {
    itemType:          "OFFER_APPROVAL_PENDING",
    displayName:       "Offer awaiting branch-head approval",
    module:            "ATS",
    entityType:        "candidate",
    defaultAssigneeRoles: ["branch_head", "operations_manager"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   24,
    deeplinkPattern:   "/ats/offer-approvals?candidateId={entityId}",
    requiresScope:     true,
  },
  // ── Attendance / WFM ─────────────────────────────────────────────────────────
  {
    itemType:          "ATTENDANCE_MISMATCH",
    displayName:       "Attendance mismatch to review",
    module:            "WFM",
    entityType:        "attendance_record",
    defaultAssigneeRoles: ["wfm", "hr"],
    defaultPriority:   ACTION_PRIORITY.MEDIUM,
    defaultTtlHours:   48,
    deeplinkPattern:   "/wfm/mismatch-queue?id={entityId}",
    requiresScope:     true,
  },
  {
    itemType:          "REGULARIZATION_PENDING",
    displayName:       "Regularization awaiting approval",
    module:            "ATTENDANCE",
    entityType:        "regularization",
    defaultAssigneeRoles: ["manager", "hr", "wfm"],
    defaultPriority:   ACTION_PRIORITY.MEDIUM,
    defaultTtlHours:   24,
    deeplinkPattern:   "/attendance-regularization?id={entityId}",
    requiresScope:     true,
  },
  {
    itemType:          "ROSTER_PUBLISH_PENDING",
    displayName:       "Roster awaiting publish",
    module:            "ROSTER",
    entityType:        "roster_draft",
    defaultAssigneeRoles: ["wfm", "process_manager", "manager"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   12,
    deeplinkPattern:   "/wfm/roster?draftId={entityId}",
    requiresScope:     true,
  },
  // ── Leave ────────────────────────────────────────────────────────────────────
  {
    itemType:          "LEAVE_APPROVAL_PENDING",
    displayName:       "Leave request awaiting approval",
    module:            "LEAVE",
    entityType:        "leave_request",
    defaultAssigneeRoles: ["manager", "hr"],
    defaultPriority:   ACTION_PRIORITY.MEDIUM,
    defaultTtlHours:   24,
    deeplinkPattern:   "/leaves?requestId={entityId}",
    requiresScope:     true,
  },
  // ── Payroll ──────────────────────────────────────────────────────────────────
  {
    itemType:          "INCENTIVE_APPROVAL",
    displayName:       "Incentive batch awaiting approval",
    module:            "PAYROLL",
    entityType:        "incentive_batch",
    defaultAssigneeRoles: ["payroll_head", "finance_head"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   48,
    deeplinkPattern:   "/payroll/incentives?batchId={entityId}",
    requiresScope:     false,
  },
  {
    itemType:          "PAYROLL_SIGN_OFF_PENDING",
    displayName:       "Payroll run awaiting sign-off",
    module:            "PAYROLL",
    entityType:        "payroll_run",
    defaultAssigneeRoles: ["payroll_head", "ceo"],
    defaultPriority:   ACTION_PRIORITY.CRITICAL,
    defaultTtlHours:   24,
    deeplinkPattern:   "/payroll/sign-off?runId={entityId}",
    requiresScope:     false,
  },
  {
    itemType:          "PAYROLL_BRANCH_READINESS",
    displayName:       "Branch payroll inputs incomplete",
    module:            "PAYROLL",
    entityType:        "payroll_cycle",
    defaultAssigneeRoles: ["payroll_branch", "branch_head"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   48,
    deeplinkPattern:   "/payroll/branch-readiness?branchId={entityId}",
    requiresScope:     true,
  },
  {
    itemType:          "PAYROLL_BRANCH_SIGNOFF_NOTIFY",
    displayName:       "Branch signed off — ready for payroll freeze",
    module:            "PAYROLL",
    entityType:        "branch_readiness",
    defaultAssigneeRoles: ["payroll_head", "super_admin"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   48,
    deeplinkPattern:   "/payroll/branch-readiness",
    requiresScope:     false,
  },
  {
    itemType:          "PAYROLL_ATTENDANCE_FREEZE_REQUEST",
    displayName:       "Branch requesting attendance freeze",
    module:            "PAYROLL",
    entityType:        "branch_readiness",
    defaultAssigneeRoles: ["payroll_head", "super_admin"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   24,
    deeplinkPattern:   "/payroll/branch-readiness",
    requiresScope:     false,
  },
  // ── Exit ─────────────────────────────────────────────────────────────────────
  {
    itemType:          "RESIGNATION_PENDING_REVIEW",
    displayName:       "Resignation awaiting HR review",
    module:            "EXIT",
    entityType:        "resignation",
    defaultAssigneeRoles: ["hr", "manager"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   48,
    deeplinkPattern:   "/exit/command-center?resignationId={entityId}",
    requiresScope:     true,
  },
  {
    itemType:          "FF_CLEARANCE_PENDING",
    displayName:       "Full & final clearance pending",
    module:            "EXIT",
    entityType:        "ff_record",
    defaultAssigneeRoles: ["hr", "payroll_head", "finance"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   72,
    deeplinkPattern:   "/payroll/full-final?id={entityId}",
    requiresScope:     false,
  },
  // ── Documents ────────────────────────────────────────────────────────────────
  {
    itemType:          "JOINING_DOCS_INCOMPLETE",
    displayName:       "Joining documents incomplete",
    module:            "EMPLOYEES",
    entityType:        "employee",
    defaultAssigneeRoles: ["hr", "payroll_hr"],
    defaultPriority:   ACTION_PRIORITY.MEDIUM,
    defaultTtlHours:   72,
    deeplinkPattern:   "/employees/{entityId}/joining-documents",
    requiresScope:     false,
  },
  // ── Compliance ───────────────────────────────────────────────────────────────
  {
    itemType:          "DPDP_WITHDRAWAL_REVIEW",
    displayName:       "DPDP data withdrawal request pending review",
    module:            "COMPLIANCE",
    entityType:        "dpdp_withdrawal",
    defaultAssigneeRoles: ["hr", "admin"],
    defaultPriority:   ACTION_PRIORITY.CRITICAL,
    defaultTtlHours:   72,
    deeplinkPattern:   "/compliance/dpdp-withdrawal-admin?id={entityId}",
    requiresScope:     false,
  },
  // ── Governance / TAT ─────────────────────────────────────────────────────────
  {
    itemType:          "TAT_BREACH",
    displayName:       "TAT breach — task overdue",
    module:            "GOVERNANCE",
    entityType:        "tat_instance",
    defaultAssigneeRoles: ["admin", "hr"],
    defaultPriority:   ACTION_PRIORITY.CRITICAL,
    defaultTtlHours:   4,
    deeplinkPattern:   "/control-tower?tatId={entityId}",
    requiresScope:     false,
  },
  // ── Exit (discussion sub-types) ───────────────────────────────────────────────
  {
    itemType:          "RESIGNATION_MANAGER_DISCUSSION",
    displayName:       "Resignation manager discussion pending",
    module:            "EXIT",
    entityType:        "exit_request",
    defaultAssigneeRoles: ["branch_head", "manager"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   24,
    deeplinkPattern:   "/exit/command-center?exitId={entityId}&tab=discussion",
    requiresScope:     true,
  },
  {
    itemType:          "RESIGNATION_HR_DISCUSSION",
    displayName:       "Resignation HR discussion pending",
    module:            "EXIT",
    entityType:        "exit_request",
    defaultAssigneeRoles: ["hr"],
    defaultPriority:   ACTION_PRIORITY.HIGH,
    defaultTtlHours:   24,
    deeplinkPattern:   "/exit/command-center?exitId={entityId}&tab=discussion",
    requiresScope:     true,
  },
];

/** Lookup map for O(1) item type resolution */
export const ACTION_ITEM_MAP = new Map<string, ActionItemDefinition>(
  ACTION_ITEM_REGISTRY.map(def => [def.itemType, def])
);

/**
 * Resolve default TTL and assignee role for a given item type.
 * Returns the definition or null if unknown (caller logs and uses fallback).
 */
export function resolveActionItemDef(itemType: string): ActionItemDefinition | null {
  return ACTION_ITEM_MAP.get(itemType) ?? null;
}

/**
 * Generate the deeplink URL for a given item type and entity ID.
 * Returns undefined if the item type is not registered.
 */
export function buildActionDeeplink(itemType: string, entityId: string): string | undefined {
  const def = ACTION_ITEM_MAP.get(itemType);
  if (!def) return undefined;
  return def.deeplinkPattern.replace(/{entityId}/g, encodeURIComponent(entityId));
}
