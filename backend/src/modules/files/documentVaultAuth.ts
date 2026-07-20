/**
 * Document Vault Authorization
 *
 * Enforces access_level policy on vault items before they are served.
 * Called from files.routes.ts when DPDP_DOCUMENT_AUTH_ENABLED feature flag is true.
 *
 * Default-deny: any gap in the policy map falls back to "confidential" rules.
 * Fails closed on processing-hold DB error (returns DPDP_HOLD_CHECK_UNAVAILABLE).
 */

import type { VaultItem, VaultAccessLevel } from "../document-vault/documentVault.service.js";
import { findByStoredFilename, logDocumentAccess } from "../document-vault/documentVault.service.js";
import { isHoldActive } from "../privacy-engine/privacyHold.service.js";

export type VaultAction = "view" | "download" | "delete" | "token_generate" | "token_consume";

export interface DocumentAuthOptions {
  actorUserId: string;
  actorRole: string;
  storedFilename: string;
  action: VaultAction;
  purposeCode?: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface DocumentAuthResult {
  allowed: boolean;
  reasonCode: string;
  item?: VaultItem;
}

// Roles considered full HRMS employees (eligible for "internal" level access)
const HRMS_EMPLOYEE_ROLES = new Set([
  "employee", "team_leader", "manager", "branch_head", "process_manager",
  "hr", "hr_admin", "payroll", "payroll_hr", "recruiter",
  "wfm", "wfm_analyst", "qa", "trainer", "finance", "ops_manager",
  "dpo", "admin", "super_admin", "ceo",
]);

// Access level → roles allowed (beyond document owner)
const ACCESS_LEVEL_POLICY: Record<VaultAccessLevel, Set<string>> = {
  public:       new Set([...HRMS_EMPLOYEE_ROLES]),
  internal:     new Set([...HRMS_EMPLOYEE_ROLES]),
  pii:          new Set(["hr", "hr_admin", "dpo", "admin", "super_admin", "ceo"]),
  payroll:      new Set(["payroll", "payroll_hr", "hr", "hr_admin", "dpo", "admin", "super_admin", "ceo"]),
  confidential: new Set(["dpo", "admin", "super_admin", "ceo"]),
};

function toAuditAction(action: VaultAction): "view" | "download" | "delete" {
  if (action === "delete") return "delete";
  if (action === "download" || action === "token_consume") return "download";
  return "view";
}

export async function authorizeDocumentAccess(opts: DocumentAuthOptions): Promise<DocumentAuthResult> {
  const item = await findByStoredFilename(opts.storedFilename);

  if (!item) {
    return { allowed: false, reasonCode: "VAULT_ITEM_NOT_FOUND" };
  }

  if (item.is_soft_deleted) {
    return { allowed: false, reasonCode: "VAULT_ITEM_DELETED", item };
  }

  // Processing hold check — fail closed on DB error
  if (item.owner_employee_id) {
    try {
      const hold = await isHoldActive("employee", item.owner_employee_id);
      if (hold) {
        await logDocumentAccess({
          vaultItemId: item.id,
          storedPath: opts.storedFilename,
          actorUserId: opts.actorUserId,
          actorType: "employee",
          action: toAuditAction(opts.action),
          accessResult: "denied",
          denialReason: `Processing hold active: ${hold.id}`,
          ipAddress: opts.ipAddress,
          userAgent: opts.userAgent,
        }).catch(() => {});
        return { allowed: false, reasonCode: "DPDP_PROCESSING_HOLD_ACTIVE", item };
      }
    } catch {
      // isHoldActive throws on DB error — fail closed
      return { allowed: false, reasonCode: "DPDP_HOLD_CHECK_UNAVAILABLE" };
    }
  }

  const accessLevel: VaultAccessLevel = item.access_level ?? "internal";
  const allowedRoles = ACCESS_LEVEL_POLICY[accessLevel] ?? ACCESS_LEVEL_POLICY.confidential;

  // Owner bypass: a document's registered owner can always access their own file
  // (candidate owner access is handled upstream in the candidate file route)
  const isOwner = item.owner_employee_id != null && item.owner_employee_id === opts.actorUserId;

  if (!isOwner && !allowedRoles.has(opts.actorRole)) {
    await logDocumentAccess({
      vaultItemId: item.id,
      storedPath: opts.storedFilename,
      actorUserId: opts.actorUserId,
      actorType: "employee",
      action: toAuditAction(opts.action),
      accessResult: "denied",
      denialReason: `Role '${opts.actorRole}' not permitted for access_level '${accessLevel}'`,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    }).catch(() => {});
    return { allowed: false, reasonCode: "INSUFFICIENT_ROLE_FOR_ACCESS_LEVEL", item };
  }

  return { allowed: true, reasonCode: "ALLOWED", item };
}
