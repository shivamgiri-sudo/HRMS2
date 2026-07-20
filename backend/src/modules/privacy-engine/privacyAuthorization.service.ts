import { isHoldActive } from "./privacyHold.service.js";
import {
  PRIVACY_POLICY_VERSION,
  REASON_CODES,
  type PrivacyContext,
  type PrivacyDecision,
} from "./privacyPolicy.types.js";
import { logPrivacyDecision } from "./privacyAudit.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const SUPER_ROLES = new Set(["super_admin", "admin"]);

function getDpdpPolicyShadowMode(): boolean {
  return process.env.DPDP_POLICY_SHADOW_MODE !== "false";
}

function getDpdpPolicyEnabled(): boolean {
  return process.env.DPDP_POLICY_ENGINE_ENABLED === "true";
}

/**
 * Core privacy authorization evaluator.
 *
 * When DPDP_POLICY_SHADOW_MODE=true (default), this logs decisions but always
 * returns allow so existing workflows are not disrupted.
 *
 * Set DPDP_POLICY_ENGINE_ENABLED=true and DPDP_POLICY_SHADOW_MODE=false to
 * enforce decisions.
 */
export async function evaluatePrivacyAccess(
  ctx: PrivacyContext
): Promise<PrivacyDecision> {
  const engineEnabled = getDpdpPolicyEnabled();
  const shadowMode = getDpdpPolicyShadowMode();

  // Super admin always allowed (break-glass — callers must ensure enhanced audit)
  if (SUPER_ROLES.has(ctx.primaryRole)) {
    const decision: PrivacyDecision = {
      allowed: true,
      decision: "allow",
      reasonCode: REASON_CODES.ALLOWED,
      policyVersion: PRIVACY_POLICY_VERSION,
      auditRequired: true,
    };
    if (engineEnabled) {
      await logPrivacyDecision({
        actorUserId: ctx.actorUserId,
        action: `PRIVACY_${ctx.requestedAction.toUpperCase()}`,
        moduleKey: "privacy-engine",
        entityType: ctx.principalType,
        entityId: ctx.principalId,
        decision,
      }).catch(() => {});
    }
    return decision;
  }

  // Check processing hold when a principal is specified
  if (ctx.principalId && ctx.principalType) {
    try {
      const hold = await isHoldActive(ctx.principalType, ctx.principalId);
      if (hold) {
        const decision: PrivacyDecision = {
          allowed: shadowMode, // in shadow mode: log but allow
          decision: "deny_processing_hold",
          reasonCode: REASON_CODES.PROCESSING_HOLD,
          policyVersion: PRIVACY_POLICY_VERSION,
          auditRequired: true,
        };
        if (engineEnabled) {
          await logPrivacyDecision({
            actorUserId: ctx.actorUserId,
            action: `PRIVACY_${ctx.requestedAction.toUpperCase()}`,
            moduleKey: "privacy-engine",
            entityType: ctx.principalType,
            entityId: ctx.principalId,
            decision,
            reason: `Processing hold active: ${hold.withdrawal_id}`,
          }).catch(() => {});
        }
        if (!shadowMode && engineEnabled) return decision;
      }
    } catch (_err) {
      // Hold check failure — fail closed when engine is enforcing
      if (!shadowMode && engineEnabled) {
        return {
          allowed: false,
          decision: "deny",
          reasonCode: "DPDP_HOLD_CHECK_FAILED",
          policyVersion: PRIVACY_POLICY_VERSION,
          auditRequired: true,
        };
      }
    }
  }

  // Default allow (engine is shadow/disabled, or no hold found)
  const decision: PrivacyDecision = {
    allowed: true,
    decision: shadowMode && engineEnabled ? "allow" : "allow",
    reasonCode: shadowMode ? REASON_CODES.SHADOW_MODE : REASON_CODES.ALLOWED,
    policyVersion: PRIVACY_POLICY_VERSION,
    auditRequired: ctx.requestedAction === "export" || ctx.requestedAction === "download",
  };

  if (engineEnabled && ctx.auditRequired !== false) {
    await logPrivacyDecision({
      actorUserId: ctx.actorUserId,
      action: `PRIVACY_${ctx.requestedAction.toUpperCase()}`,
      moduleKey: "privacy-engine",
      entityType: ctx.principalType,
      entityId: ctx.principalId,
      decision,
    }).catch(() => {});
  }

  return decision;
}

// Augment PrivacyContext type with optional audit flag
declare module "./privacyPolicy.types.js" {
  interface PrivacyContext {
    auditRequired?: boolean;
  }
}

/**
 * Check if a given principal has an approved data restriction order.
 * Used by endpoints that need a simple boolean check without full engine evaluation.
 */
export async function hasDataRestriction(principalId: string): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM dpdp_consent_withdrawal
       WHERE data_restriction_applied = 1 AND status = 'approved'
         AND (requester_id = ? OR requester_id IN (
           SELECT e.user_id FROM employees e WHERE e.id = ? LIMIT 1
         ))
       LIMIT 1`,
      [principalId, principalId]
    );
    return rows.length > 0;
  } catch {
    // Fail closed on error
    return true;
  }
}
