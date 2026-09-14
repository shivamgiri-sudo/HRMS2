export type PrivacyDecisionVerdict =
  | "allow"
  | "allow_masked"
  | "allow_minimized"
  | "allow_with_reason"
  | "deny"
  | "deny_processing_hold"
  | "deny_retention_expired";

export interface PrivacyDecision {
  allowed: boolean;
  decision: PrivacyDecisionVerdict;
  reasonCode: string;
  policyVersion: string;
  auditRequired: boolean;
  maskedFields?: string[];
  deniedFields?: string[];
}

export type DataCategory =
  | "identity"
  | "contact"
  | "employment"
  | "financial"
  | "payroll"
  | "statutory"
  | "biometric"
  | "health"
  | "emergency_contact"
  | "family_nominee"
  | "performance"
  | "attendance"
  | "location"
  | "authentication"
  | "device"
  | "communication"
  | "recruitment"
  | "bgv"
  | "visitor"
  | "documents"
  | "audit"
  | "ai_context";

export type PrincipalType = "employee" | "candidate" | "client_user" | "portal_user";

export type PrivacyAction =
  | "read"
  | "write"
  | "delete"
  | "export"
  | "download"
  | "share"
  | "ai_context";

export interface PrivacyContext {
  actorUserId: string;
  actorRoles: string[];
  primaryRole: string;
  principalId?: string;
  principalType?: PrincipalType;
  requestedAction: PrivacyAction;
  requestedFields?: string[];
  purposeCode?: string;
  branchId?: string;
  processId?: string;
  ipAddress?: string;
  userAgent?: string;
  isSelfAccess?: boolean;
  breakGlassReason?: string;
}

export const PRIVACY_POLICY_VERSION = "privacy-policy-v1";

export const REASON_CODES = {
  ALLOWED: "DPDP_ALLOWED",
  ALLOWED_MASKED: "DPDP_ALLOWED_MASKED",
  ALLOWED_MINIMIZED: "DPDP_ALLOWED_MINIMIZED",
  SCOPE_DENIED: "DPDP_SCOPE_DENIED",
  ROLE_DENIED: "DPDP_ROLE_DENIED",
  PROCESSING_HOLD: "DPDP_PROCESSING_HOLD_ACTIVE",
  RETENTION_EXPIRED: "DPDP_RETENTION_EXPIRED",
  NOT_AUTHENTICATED: "DPDP_NOT_AUTHENTICATED",
  SHADOW_MODE: "DPDP_SHADOW_MODE_LOG_ONLY",
} as const;
