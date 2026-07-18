import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { grnSmartService } from "./grn-smart.service.js";

async function activeOverrides(grnId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT validation_code, override_reason, approved_by, approved_at
       FROM grn_validation_override
      WHERE grn_request_id = ? AND active_status = 1`,
    [grnId]
  );
  return new Map(rows.map((row) => [String(row.validation_code), row]));
}

async function applyOverridesToLatestResults(grnId: string) {
  const overrides = await activeOverrides(grnId);
  for (const [code, override] of overrides.entries()) {
    await db.execute(
      `UPDATE grn_validation_result
          SET validation_status = 'overridden', is_blocking = 0,
              overridden_by = ?, override_reason = ?, overridden_at = ?
        WHERE grn_request_id = ? AND validation_code = ?`,
      [
        override.approved_by,
        override.override_reason,
        override.approved_at,
        grnId,
        code,
      ]
    );
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM grn_validation_result
      WHERE grn_request_id = ?
      ORDER BY is_blocking DESC, created_at`,
    [grnId]
  );
  return rows as any[];
}

async function effectiveValidation(grnId: string) {
  const fresh = await grnSmartService.revalidate(grnId);
  const results = await applyOverridesToLatestResults(grnId);
  const blocking = results.filter(
    (item) => Number(item.is_blocking) === 1 && String(item.validation_status) === "failed"
  );
  return {
    ...fresh,
    results,
    blocking,
  };
}

async function audit(
  action: string,
  grnId: string,
  actorUserId: string,
  actorRole: string,
  details: Record<string, unknown>
) {
  await logSensitiveAction({
    actor_user_id: actorUserId,
    actor_role: actorRole,
    action_type: action,
    module_key: "FINANCE",
    entity_type: "grn_request",
    entity_id: grnId,
    change_summary: details,
  });
}

export const grnValidationControlService = {
  async overrideValidation(
    grnId: string,
    validationCode: string,
    reason: string,
    actorUserId: string,
    actorRole: string
  ) {
    const normalizedCode = validationCode.trim().toUpperCase();
    if (!normalizedCode) throw new Error("Validation code is required");
    if (!reason.trim() || reason.trim().length < 10) {
      throw new Error("A detailed override reason of at least 10 characters is required");
    }
    const [grnRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, status FROM grn_request WHERE id = ? LIMIT 1",
      [grnId]
    );
    if (!grnRows[0]) throw new Error("GRN not found");
    if (["paid", "approved", "cancelled", "rejected"].includes(String(grnRows[0].status))) {
      throw new Error("Validation overrides cannot be changed after final closure");
    }
    const [validationRows] = await db.execute<RowDataPacket[]>(
      `SELECT validation_code, validation_status, is_blocking, message
         FROM grn_validation_result
        WHERE grn_request_id = ? AND validation_code = ?
        ORDER BY created_at DESC LIMIT 1`,
      [grnId, normalizedCode]
    );
    if (!validationRows[0]) {
      throw new Error("Run GRN validation before approving an exception");
    }
    if (String(validationRows[0].validation_status) === "passed") {
      throw new Error("Passed validations do not require an override");
    }

    await db.execute(
      `INSERT INTO grn_validation_override
       (id, grn_request_id, validation_code, override_reason,
        active_status, approved_by, approved_at)
       VALUES (?,?,?,?,1,?,NOW())
       ON DUPLICATE KEY UPDATE
         override_reason = VALUES(override_reason),
         active_status = 1,
         approved_by = VALUES(approved_by),
         approved_at = NOW(),
         revoked_by = NULL,
         revoked_at = NULL,
         revoke_reason = NULL`,
      [randomUUID(), grnId, normalizedCode, reason.trim(), actorUserId]
    );
    const results = await applyOverridesToLatestResults(grnId);
    await audit("GRN_VALIDATION_OVERRIDE_APPROVED", grnId, actorUserId, actorRole, {
      validation_code: normalizedCode,
      override_reason: reason.trim(),
      original_message: validationRows[0].message,
    });
    return { success: true, validationCode: normalizedCode, results };
  },

  async revokeOverride(
    grnId: string,
    validationCode: string,
    reason: string,
    actorUserId: string,
    actorRole: string
  ) {
    if (!reason.trim()) throw new Error("Revoke reason is required");
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grn_validation_override
          SET active_status = 0, revoked_by = ?, revoked_at = NOW(), revoke_reason = ?
        WHERE grn_request_id = ? AND validation_code = ? AND active_status = 1`,
      [actorUserId, reason.trim(), grnId, validationCode.trim().toUpperCase()]
    );
    if (result.affectedRows !== 1) throw new Error("Active validation override not found");
    await audit("GRN_VALIDATION_OVERRIDE_REVOKED", grnId, actorUserId, actorRole, {
      validation_code: validationCode.trim().toUpperCase(),
      revoke_reason: reason.trim(),
    });
    return effectiveValidation(grnId);
  },

  async submit(
    grnId: string,
    actorUserId: string,
    actorRole: string,
    remarks?: string
  ) {
    const validation = await effectiveValidation(grnId);
    if (validation.blocking.length) {
      throw new Error(
        `Resolve or obtain Finance override for: ${validation.blocking
          .map((item) => item.message)
          .join("; ")}`
      );
    }
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grn_request
          SET status = 'submitted', submitted_by = ?, submitted_at = NOW(),
              remarks = COALESCE(?, remarks)
        WHERE id = ? AND status = 'draft'`,
      [actorUserId, remarks?.trim() || null, grnId]
    );
    if (result.affectedRows !== 1) {
      throw new Error("GRN status changed before submission; refresh and try again");
    }
    await audit("GRN_SUBMIT", grnId, actorUserId, actorRole, {
      validation_score: validation.score,
      effective_blocking_count: 0,
      remarks,
    });
    return { success: true, newStatus: "submitted", validation };
  },

  async review(
    grnId: string,
    decision: "approved" | "rejected",
    reviewNote: string | undefined,
    actorUserId: string,
    actorRole: string
  ) {
    if (decision === "approved") {
      const validation = await effectiveValidation(grnId);
      if (validation.blocking.length) {
        throw new Error(
          `Approval blocked by: ${validation.blocking
            .map((item) => item.message)
            .join("; ")}`
        );
      }
    }
    return grnSmartService.review(
      grnId,
      decision,
      reviewNote,
      actorUserId,
      actorRole
    );
  },

  async effectiveValidation(grnId: string) {
    return effectiveValidation(grnId);
  },
};
