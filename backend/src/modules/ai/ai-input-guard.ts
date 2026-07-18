/**
 * PeopleOS Copilot — Input Guard
 *
 * Validates and sanitizes user-supplied strings before they enter
 * system instructions or are forwarded to an external AI provider.
 *
 * Protections:
 * 1. Length ceiling — prevents token-stuffing / cost DoS
 * 2. Prompt-injection pattern detection — blocks known override phrases
 * 3. Context-type allowlist — only registered context codes are accepted
 * 4. Role-scope gate — sensitive context types require explicit role
 */

import type { RoleKey } from "../../platform/policy/index.js";

export const QUESTION_MAX_LENGTH = 1000;
export const CONTEXT_TYPE_MAX_LENGTH = 64;
export const ENTITY_ID_MAX_LENGTH = 128;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*[^\n]{0,200}/i,
  /\bact\s+as\s+(a|an)\s+/i,
  /\bforget\s+(your|the)\s+(rules|instructions|guidelines)/i,
  /\bdo\s+not\s+follow\s+(your|the)\s+(rules|instructions)/i,
  /\brepeat\s+(your\s+)?(system\s+)?prompt/i,
  /\bwhat\s+(is|are)\s+your\s+(system\s+)?instructions/i,
  /\bprint\s+(your\s+)?(system\s+)?prompt/i,
  /\bshow\s+(me\s+)?(your\s+)?(system\s+)?prompt/i,
];

// Keys are context codes; value is an array of roles allowed to use them.
// An empty array means "any authenticated user".
export const ALLOWED_CONTEXT_TYPES: Record<string, RoleKey[]> = {
  generic:               [],
  role_insights:         [],
  payroll_readiness:     ["payroll_head", "payroll_hr", "hr", "ceo", "super_admin", "admin"],
  payroll_blockers:      ["payroll_head", "payroll_hr", "hr", "ceo", "super_admin", "admin"],
  attendance_risk:       ["wfm", "wfm_spoc", "hr", "manager", "branch_head", "super_admin", "admin"],
  roster_risk:           ["wfm", "wfm_spoc", "process_manager", "manager", "super_admin", "admin"],
  ceo_summary:           ["ceo", "super_admin", "admin"],
  people_risk:           ["ceo", "hr", "super_admin", "admin"],
  support_risk:          ["ceo", "operations_manager", "super_admin", "admin"],
  onboarding_status:     ["hr", "recruitment_hr", "branch_head", "super_admin", "admin"],
  exit_risk:             ["hr", "branch_head", "manager", "super_admin", "admin"],
  business_action:       [],
  explain_action:        [],
};

export interface InputGuardResult {
  valid: boolean;
  reason?: string;
  sanitizedQuestion?: string;
  sanitizedContextType?: string;
}

export function validateQuestion(raw: string): InputGuardResult {
  if (typeof raw !== "string") {
    return { valid: false, reason: "question must be a string" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: "question must not be empty" };
  }
  if (trimmed.length > QUESTION_MAX_LENGTH) {
    return { valid: false, reason: `question exceeds ${QUESTION_MAX_LENGTH} characters` };
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: "question contains disallowed instruction override patterns" };
    }
  }
  const sanitized = trimmed.replace(/\s+/g, " ");
  return { valid: true, sanitizedQuestion: sanitized };
}

export function validateContextType(
  raw: string | undefined,
  roleKeys: string[]
): InputGuardResult {
  if (!raw) {
    return { valid: true, sanitizedContextType: "generic" };
  }
  if (typeof raw !== "string" || raw.length > CONTEXT_TYPE_MAX_LENGTH) {
    return { valid: false, reason: "context_type must be a short string" };
  }
  const lower = raw.toLowerCase().trim();

  if (!Object.prototype.hasOwnProperty.call(ALLOWED_CONTEXT_TYPES, lower)) {
    return { valid: true, sanitizedContextType: "generic" };
  }

  const allowedRoles = ALLOWED_CONTEXT_TYPES[lower];
  if (allowedRoles.length > 0) {
    const hasRole = roleKeys.some(r => (allowedRoles as string[]).includes(r));
    if (!hasRole) {
      return {
        valid: false,
        reason: `context_type '${lower}' requires one of: ${allowedRoles.join(", ")}`,
      };
    }
  }

  return { valid: true, sanitizedContextType: lower };
}

export function validateEntityId(raw: string | undefined): InputGuardResult {
  if (!raw) return { valid: true };
  if (typeof raw !== "string") return { valid: false, reason: "entity_id must be a string" };
  if (raw.length > ENTITY_ID_MAX_LENGTH) {
    return { valid: false, reason: `entity_id exceeds ${ENTITY_ID_MAX_LENGTH} characters` };
  }
  if (!/^[\w\-]+$/.test(raw)) {
    return { valid: false, reason: "entity_id contains disallowed characters" };
  }
  return { valid: true };
}
