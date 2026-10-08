/**
 * Document Vault Authorization
 *
 * Enforces access_level policy on vault items before they are served.
 * Called from files.routes.ts when DPDP_DOCUMENT_AUTH_ENABLED feature flag is true.
 *
 * Default-deny: any gap in the policy map falls back to "confidential" rules.
 * Fails closed on processing-hold DB error (returns DPDP_HOLD_CHECK_UNAVAILABLE).
 */

import type {
  VaultItem,
  VaultAccessLevel,
} from "../document-vault/documentVault.service.js";
import {
  findByStoredFilename,
  logDocumentAccess,
} from "../document-vault/documentVault.service.js";
import { isHoldActive } from "../privacy-engine/privacyHold.service.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import { isOwnerReadableDocType } from "../employees/employee-document-category.js";

/**
 * Vault categories whose owner may NOT open their own file. The employee uploads these (KYC, joining
 * documents) but HR / payroll review and open them; the profile only shows the employee a status and
 * an upload slot for what is pending. Other categories (payslips, tax forms issued to the employee)
 * keep the owner bypass below.
 */
export const OWNER_ACCESS_BLOCKED_CATEGORIES: ReadonlySet<string> = new Set(["employee-documents"]);

/** True when the stored file is the owner's tax paperwork (Form 16 etc.), which they may open. */
async function isOwnerReadableTaxFile(storedFilename: string): Promise<boolean> {
  try {
    const [rows] = await db.execute(
      "SELECT doc_type FROM employee_documents WHERE file_url LIKE ? LIMIT 1",
      [`%/${storedFilename.replace(/[%_\\]/g, "")}`],
    );
    const type = (rows as Array<{ doc_type?: string }>)[0]?.doc_type;
    return !!type && isOwnerReadableDocType(String(type));
  } catch {
    return false; // fail closed: an unreadable lookup never widens access
  }
}

export type VaultAction =
  "view" | "download" | "delete" | "token_generate" | "token_consume";

export interface DocumentAuthOptions {
  actorUserId: string;
  actorRole: string;
  storedFilename: string;
  action: VaultAction;
  purposeCode?: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  /**
   * The caller's own employees.id, if they have an employee record — NOT the same
   * value as actorUserId (users.id). owner_employee_id on the vault item is always
   * an employees.id, so without this the owner-bypass below can never match a real
   * employee, only an id that happens to collide by accident. Resolve via
   * accessGuard.getEmployeeForUser(actorUserId) at the call site; optional because
   * not every actor (e.g. a service account, or a candidate) has one.
   */
  actorEmployeeId?: string;
}

export interface DocumentAuthResult {
  allowed: boolean;
  reasonCode: string;
  item?: VaultItem;
}

// Roles considered full HRMS employees (eligible for "internal" level access)
const HRMS_EMPLOYEE_ROLES = new Set([
  "employee",
  "team_leader",
  "manager",
  "branch_head",
  "process_manager",
  "hr",
  "hr_admin",
  "payroll",
  "payroll_hr",
  "recruiter",
  "wfm",
  "wfm_analyst",
  "qa",
  "trainer",
  "finance",
  "ops_manager",
  "dpo",
  "admin",
  "super_admin",
  "ceo",
  // it/branch_it upload AD provisioning evidence (accessLevel: 'internal') via
  // /api/it-provisioning/tasks/:id/upload-evidence and need to view it back.
  "it",
  "branch_it",
]);

// Access level → roles allowed (beyond document owner)
const ACCESS_LEVEL_POLICY: Record<VaultAccessLevel, Set<string>> = {
  public: new Set([...HRMS_EMPLOYEE_ROLES]),
  internal: new Set([...HRMS_EMPLOYEE_ROLES]),
  pii: new Set(["hr", "hr_admin", "dpo", "admin", "super_admin", "ceo"]),
  payroll: new Set([
    "payroll",
    "payroll_hr",
    "hr",
    "hr_admin",
    "dpo",
    "admin",
    "super_admin",
    "ceo",
  ]),
  confidential: new Set(["dpo", "admin", "super_admin", "ceo"]),
};

function toAuditAction(action: VaultAction): "view" | "download" | "delete" {
  if (action === "delete") return "delete";
  if (action === "download" || action === "token_consume") return "download";
  return "view";
}

export async function authorizeDocumentAccess(
  opts: DocumentAuthOptions,
): Promise<DocumentAuthResult> {
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
        return {
          allowed: false,
          reasonCode: "DPDP_PROCESSING_HOLD_ACTIVE",
          item,
        };
      }
    } catch {
      // isHoldActive throws on DB error — fail closed
      return { allowed: false, reasonCode: "DPDP_HOLD_CHECK_UNAVAILABLE" };
    }
  }

  const accessLevel: VaultAccessLevel = item.access_level ?? "internal";
  const allowedRoles =
    ACCESS_LEVEL_POLICY[accessLevel] ?? ACCESS_LEVEL_POLICY.confidential;

  // Owner bypass: a document's registered owner can always access their own file
  // (candidate owner access is handled upstream in the candidate file route).
  // Must compare against the caller's employees.id (actorEmployeeId), not their
  // users.id (actorUserId) — owner_employee_id is always an employees.id, and
  // those two id spaces are distinct in this schema (employees.user_id is the FK
  // between them). Comparing against actorUserId here used to mean this bypass
  // could never actually match a real employee.
  const ownsItem = item.owner_employee_id != null && item.owner_employee_id === opts.actorEmployeeId;
  const isOwner =
    ownsItem &&
    (!OWNER_ACCESS_BLOCKED_CATEGORIES.has(String(item.category)) || (await isOwnerReadableTaxFile(opts.storedFilename)));

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
    return {
      allowed: false,
      reasonCode: "INSUFFICIENT_ROLE_FOR_ACCESS_LEVEL",
      item,
    };
  }

  // Branch scoping (owner ruling 2026-10-01): the role table above says WHICH ROLES may open a level,
  // not whose documents. hr / payroll_hr could open the pii and payroll documents of an employee in any
  // branch. For the sensitive levels a role that is not org-wide (or the DPO, who legitimately sees all)
  // must be able to see the document owner's branch. Owner access and org-wide roles are unchanged.
  const SENSITIVE_LEVELS: VaultAccessLevel[] = ["pii", "payroll", "confidential"];
  if (
    !isOwner &&
    item.owner_employee_id &&
    SENSITIVE_LEVELS.includes(accessLevel) &&
    opts.actorRole !== "dpo" &&
    !ORG_WIDE_EXEMPT_ROLES.includes(opts.actorRole)
  ) {
    let inScope = false;
    try {
      inScope = await canViewEmployee({ id: opts.actorUserId }, item.owner_employee_id);
    } catch {
      inScope = false; // fail closed
    }
    if (!inScope) {
      await logDocumentAccess({
        vaultItemId: item.id,
        storedPath: opts.storedFilename,
        actorUserId: opts.actorUserId,
        actorType: "employee",
        action: toAuditAction(opts.action),
        accessResult: "denied",
        denialReason: `Document owner is outside the caller's branch / assigned scope (access_level '${accessLevel}')`,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      }).catch(() => {});
      return { allowed: false, reasonCode: "OUTSIDE_BRANCH_SCOPE", item };
    }
  }

  return { allowed: true, reasonCode: "ALLOWED", item };
}
