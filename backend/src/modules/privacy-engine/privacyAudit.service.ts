import { logSensitiveAction, writeAuditLog } from "../../shared/auditLog.js";
import { PRIVACY_POLICY_VERSION } from "./privacyPolicy.types.js";
import type { PrivacyDecision } from "./privacyPolicy.types.js";
import type { Request } from "express";

interface PrivacyAuditEntry {
  actorUserId: string;
  action: string;
  moduleKey: string;
  entityType?: string;
  entityId?: string;
  decision: PrivacyDecision;
  reason?: string;
  req?: Request;
}

/**
 * Write a privacy-policy audit entry that includes the policy version
 * and decision outcome so compliance dashboards can query by reason code.
 */
export async function logPrivacyDecision(entry: PrivacyAuditEntry): Promise<void> {
  const metadata = {
    policyVersion: PRIVACY_POLICY_VERSION,
    decision: entry.decision.decision,
    reasonCode: entry.decision.reasonCode,
    allowed: entry.decision.allowed,
    maskedFields: entry.decision.maskedFields,
    deniedFields: entry.decision.deniedFields,
  };

  if (entry.decision.allowed) {
    await writeAuditLog({
      actor_user_id: entry.actorUserId,
      action_type: entry.action,
      module_key: entry.moduleKey,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      metadata: metadata,
      req: entry.req,
    });
  } else {
    // Denied accesses go to sensitive_action_log for higher-priority review
    await logSensitiveAction({
      actor_user_id: entry.actorUserId,
      action_type: `${entry.action}_DENIED`,
      module_key: entry.moduleKey,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      change_summary: metadata,
      reason: entry.reason ?? entry.decision.reasonCode,
      req: entry.req,
    });
  }
}
