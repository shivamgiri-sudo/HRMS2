import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { vendorService } from "../erp/erp.service.js";

export interface RaiseVendorApprovalInput {
  requestType: "create" | "update";
  vendorId: string | null;
  payload: Record<string, unknown>;
  raisedBy: string;
  branchId: string;
}

export const vendorApprovalService = {
  async raise(input: RaiseVendorApprovalInput): Promise<{ id: string; status: "pending" }> {
    if (!input.raisedBy) throw new Error("raisedBy is required");
    if (!input.branchId) throw new Error("branchId is required");
    if (!input.payload?.vendor_name) throw new Error("vendor_name is required in payload");
    if (input.requestType === "update" && !input.vendorId) {
      throw new Error("vendorId is required for update requests");
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO vendor_approval_request
         (id, request_type, vendor_id, payload, status, raised_by, branch_id, raised_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, NOW())`,
      [id, input.requestType, input.vendorId ?? null, JSON.stringify(input.payload), input.raisedBy, input.branchId]
    );

    await writeAuditLog({
      actor_user_id: input.raisedBy,
      action_type: "vendor_approval_raised",
      module_key: "vendor_master",
      entity_type: "vendor_approval_request",
      entity_id: id,
      metadata: { requestType: input.requestType, vendorId: input.vendorId, vendorName: input.payload.vendor_name },
    });

    return { id, status: "pending" };
  },

  async list(filters: { status?: string; branchId?: string; raisedBy?: string; limit?: number }) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.status)    { conds.push("r.status = ?");     params.push(filters.status); }
    if (filters.branchId)  { conds.push("r.branch_id = ?");  params.push(filters.branchId); }
    if (filters.raisedBy)  { conds.push("r.raised_by = ?");  params.push(filters.raisedBy); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const limitClause = filters.limit ? `LIMIT ${Math.min(filters.limit, 200)}` : "LIMIT 100";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*,
              CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,'')) AS raised_by_name,
              b.branch_name
         FROM vendor_approval_request r
         LEFT JOIN auth_user u ON u.id = r.raised_by
         LEFT JOIN branch_master b ON b.id = r.branch_id
         ${where}
         ORDER BY r.raised_at DESC
         ${limitClause}`,
      params
    );
    return rows;
  },

  async approve(
    id: string,
    reviewerId: string,
    editedPayload: Record<string, unknown> | null,
    reviewNotes?: string
  ): Promise<{ vendorId: string }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM vendor_approval_request WHERE id = ? LIMIT 1`,
      [id]
    );
    const request = rows[0];
    if (!request) throw Object.assign(new Error("Vendor approval request not found"), { statusCode: 404 });
    if (request.status !== "pending") {
      throw Object.assign(new Error(`Request is already ${request.status}`), { statusCode: 409 });
    }

    const storedPayload = typeof request.payload === "string"
      ? JSON.parse(request.payload)
      : request.payload;
    const effectivePayload: Record<string, unknown> = editedPayload
      ? { ...storedPayload, ...editedPayload }
      : storedPayload;

    let vendorId: string;
    if (request.request_type === "create") {
      if (!effectivePayload.vendor_code) {
        effectivePayload.vendor_code = await vendorService.generateNextCode();
      }
      const created = await vendorService.create(effectivePayload);
      vendorId = (created as { id?: string })?.id ?? String((created as Record<string, unknown>)?.id);
    } else {
      await vendorService.update(String(request.vendor_id), effectivePayload);
      vendorId = String(request.vendor_id);
    }

    await db.execute<ResultSetHeader>(
      `UPDATE vendor_approval_request
          SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
        WHERE id = ?`,
      [reviewerId, reviewNotes ?? null, id]
    );

    await writeAuditLog({
      actor_user_id: reviewerId,
      action_type: "vendor_approval_approved",
      module_key: "vendor_master",
      entity_type: "vendor_approval_request",
      entity_id: id,
      metadata: { vendorId, requestType: request.request_type, reviewNotes },
    });

    return { vendorId };
  },

  async reject(id: string, reviewerId: string, reviewNotes: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, status FROM vendor_approval_request WHERE id = ? LIMIT 1`,
      [id]
    );
    const request = rows[0];
    if (!request) throw Object.assign(new Error("Vendor approval request not found"), { statusCode: 404 });
    if (request.status !== "pending") {
      throw Object.assign(new Error(`Request is already ${request.status}`), { statusCode: 409 });
    }

    await db.execute<ResultSetHeader>(
      `UPDATE vendor_approval_request
          SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
        WHERE id = ?`,
      [reviewerId, reviewNotes ?? null, id]
    );

    await writeAuditLog({
      actor_user_id: reviewerId,
      action_type: "vendor_approval_rejected",
      module_key: "vendor_master",
      entity_type: "vendor_approval_request",
      entity_id: id,
      metadata: { reviewNotes },
    });
  },
};
