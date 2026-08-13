// Statutory-details (PAN/Aadhaar/UAN/ESI/PF) change-request review.
//
// PUT /me/statutory-details (employee.routes.ts) already routes an employee's
// self-submitted change into profile_update_approval (request_type =
// 'statutory_details', routed_to_role = 'hr') via submitStatutoryDetailsForApproval
// (profile-approval.service.ts). Until this file, nothing could ever action that
// row: profile-approval.routes.ts's reviewer is never mounted in app.ts and is
// hardcoded to request_type = 'bank_details' anyway, and payroll-window.routes.ts's
// bank-change reviewer is likewise bank_details-only. Submitted statutory-detail
// requests sat in 'pending' permanently, with no route to see or act on them.
//
// Mirrors rm-change.routes.ts's POST /:id/action pattern (transaction + row lock +
// pending-status guard) — the one pending-change workflow in this module that was
// already fully wired end to end.
import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { encryptPanForSync, blindIndexPan } from "../../shared/syncPiiEncryption.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { validateStatutoryFields } from "../../shared/statutoryFormat.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

const REVIEWER_ROLES = ["admin", "super_admin", "hr"];

// GET /api/statutory-change-requests/pending
router.get("/pending", requireRole(...REVIEWER_ROLES), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pua.id, pua.employee_id, pua.old_values, pua.new_values, pua.status, pua.requested_at,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code, b.branch_name
       FROM profile_update_approval pua
       JOIN employees e ON e.id = pua.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE pua.request_type = 'statutory_details' AND pua.status = 'pending'
      ORDER BY pua.requested_at ASC`
  );
  return res.json({ success: true, data: rows });
}));

// Never surface a raw PAN/Aadhaar/UAN/ESI number in an audit-log entry.
function maskStatutoryValues(values: Record<string, any> | undefined | null): Record<string, unknown> {
  if (!values) return {};
  const mask = (v: unknown) => (v == null || v === "" ? null : `${"*".repeat(Math.max(0, String(v).length - 4))}${String(v).slice(-4)}`);
  const out: Record<string, unknown> = { ...values };
  for (const key of ["pan_number", "aadhaar_id", "uan_number", "esi_number", "epf_number"]) {
    if (key in out) out[key] = mask(out[key]);
  }
  return out;
}

// PATCH /api/statutory-change-requests/:id
router.patch("/:id", requireRole(...REVIEWER_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const actorUserId = req.authUser!.id;
  const { decision, note } = req.body as { decision: "approved" | "rejected"; note?: string };

  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ success: false, message: "decision must be 'approved' or 'rejected'" });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT * FROM profile_update_approval WHERE id = ? AND request_type = 'statutory_details' LIMIT 1 FOR UPDATE`,
      [req.params.id]
    );
    const rec = rows[0] as any;
    if (!rec) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Request not found" });
    }
    if (rec.status !== "pending") {
      await connection.rollback();
      return res.status(409).json({ success: false, message: `Request already ${rec.status}` });
    }

    const newValues: Record<string, any> = typeof rec.new_values === "string" ? JSON.parse(rec.new_values || "{}") : (rec.new_values ?? {});
    const oldValues: Record<string, any> = typeof rec.old_values === "string" ? JSON.parse(rec.old_values || "{}") : (rec.old_values ?? {});

    if (decision === "approved") {
      // Same write shape as PUT /:employeeId/statutory-details (HR direct entry,
      // employee.routes.ts) — same columns, same PAN dual-write (plaintext +
      // encrypted + blind index), same employees.uan_number sync. Kept in
      // parallel deliberately rather than sharing a helper, so this file stays
      // readable against the route it mirrors without an extra indirection layer.
      const {
        epf_number, esi_number, uan_number, aadhaar_id,
        pf_eligible, esi_eligible, epf_date,
      } = newValues;
      const pan_number = typeof newValues.pan_number === "string" ? newValues.pan_number.trim().toUpperCase() : newValues.pan_number;

      // Neither the employee's original submission (PUT /me/statutory-details)
      // nor this approve step validated format before this fix — an employee
      // could submit, and HR could approve, a malformed PAN/Aadhaar/UAN/ESI that
      // would then be silently stored. Same check as the HR-direct-entry route
      // (employee.routes.ts PUT /:employeeId/statutory-details).
      const formatErrors = validateStatutoryFields({ pan_number, aadhaar_id, uan_number, esi_number, epf_number });
      if (formatErrors.length) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: "Invalid format in submitted values", details: formatErrors });
      }

      const STAT_FIELDS: string[] = ["employee_id"];
      const statVals: any[] = [rec.employee_id];
      const statOnDup: string[] = [];
      const addStat = (col: string, val: any) => {
        if (val !== undefined) {
          STAT_FIELDS.push(col);
          statVals.push(val);
          statOnDup.push(`${col} = VALUES(${col})`);
        }
      };
      addStat("epf_number", epf_number);
      addStat("esi_number", esi_number);
      addStat("uan_number", uan_number);
      addStat("pan_number", pan_number);
      if (pan_number !== undefined) {
        addStat("pan_number_encrypted", encryptPanForSync(pan_number, "statutory-approval"));
        addStat("pan_blind_index", blindIndexPan(pan_number, "statutory-approval"));
      }
      addStat("aadhaar_id", aadhaar_id);
      addStat("pf_eligible", pf_eligible);
      addStat("esi_eligible", esi_eligible);
      addStat("epf_date", epf_date);

      if (STAT_FIELDS.length > 1) {
        const placeholders = STAT_FIELDS.map(() => "?").join(", ");
        const dupClause = statOnDup.length ? `ON DUPLICATE KEY UPDATE ${statOnDup.join(", ")}` : "";
        await connection.execute(
          `INSERT INTO employee_statutory_info (${STAT_FIELDS.join(", ")}) VALUES (${placeholders}) ${dupClause}`,
          statVals
        );
      }
      if (uan_number !== undefined) {
        await connection.execute("UPDATE employees SET uan_number = ? WHERE id = ?", [uan_number, rec.employee_id]);
      }
    }

    await connection.execute(
      `UPDATE profile_update_approval
          SET status = ?, reviewed_by = ?, reviewed_at = NOW(), reviewer_note = ?
        WHERE id = ?`,
      [decision, actorUserId, note ?? null, req.params.id]
    );

    await connection.commit();

    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: decision === "approved" ? "STATUTORY_DETAILS_APPROVED" : "STATUTORY_DETAILS_REJECTED",
      module_key: "EMPLOYEE_PROFILE",
      entity_type: "profile_update_approval",
      entity_id: req.params.id,
      employee_id: rec.employee_id,
      reason: note ?? undefined,
      old_value_json: maskStatutoryValues(oldValues),
      new_value_json: maskStatutoryValues(newValues),
    });

    return res.json({ success: true, message: `Statutory details request ${decision}` });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}));

export { router as statutoryApprovalRouter };
