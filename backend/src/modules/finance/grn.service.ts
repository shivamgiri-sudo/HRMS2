import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { vendorPaymentService } from "./vendor-payment.service.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type GrnType = "vendor" | "imprest";
export type GrnStatus = "draft" | "submitted" | "approved" | "rejected" | "cancelled";

export interface CreateGrnPayload {
  grnType: GrnType;
  branchId: string;
  processId?: string;
  costCentreId?: string;
  costClass?: "direct" | "indirect";
  vendorId?: string;
  vendorName?: string;
  head: string;
  subHead?: string;
  amount: number;
  billDate?: string;
  paymentTermsDays?: number;
  remarks?: string;
  attachmentPath?: string;
  attachmentOriginalName?: string;
  financialYear?: string;
}

export interface SubmitGrnPayload {
  remarks?: string;
}

export interface ReviewGrnPayload {
  decision: "approved" | "rejected";
  reviewNote?: string;
}

// ── GRN number generator: Mas/{branch_seq}/{YY}/{seq} ─────────────────────────

async function generateGrnNumber(branchId: string, financialYear: string): Promise<string> {
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_seq FROM branch_master WHERE id = ? LIMIT 1`,
    [branchId]
  );
  const branchSeq: number = branchRows[0]?.branch_seq ?? 0;

  const yy = financialYear.slice(2, 4); // "2526" → "25"

  const [seqRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM grn_request WHERE branch_id = ? AND financial_year = ?`,
    [branchId, financialYear]
  );
  const seq = ((seqRows[0]?.cnt as number) ?? 0) + 1;

  return `Mas/${branchSeq}/${yy}/${seq}`;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const grnService = {
  async createDraft(payload: CreateGrnPayload, actorUserId: string, actorRole: string) {
    const id = randomUUID();
    const fy = payload.financialYear ?? getCurrentFinancialYear();
    const grnNumber = await generateGrnNumber(payload.branchId, fy);
    const attribution = await resolveFinanceAttribution(
      payload.processId ?? null,
      payload.costCentreId ?? null,
      payload.costClass
    );

    const dueDate = payload.billDate && payload.paymentTermsDays != null
      ? addDays(payload.billDate, payload.paymentTermsDays)
      : null;

    await db.execute(
      `INSERT INTO grn_request
         (id, grn_number, grn_type, branch_id, process_id, cost_centre_id, cost_class, vendor_id, vendor_name, head, sub_head,
          amount, bill_date, payment_terms_days, due_date, remarks,
          attachment_path, attachment_original_name, attachment_mime, status, financial_year,
          created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        id,
        grnNumber,
        payload.grnType,
        payload.branchId,
        attribution.processId,
        attribution.costCentreId,
        attribution.costClass,
        payload.vendorId ?? null,
        payload.vendorName ?? null,
        payload.head,
        payload.subHead ?? null,
        payload.amount,
        payload.billDate ?? null,
        payload.paymentTermsDays ?? null,
        dueDate,
        payload.remarks ?? null,
        payload.attachmentPath ?? null,
        payload.attachmentOriginalName ?? null,
        null,
        "draft",
        fy,
        actorUserId,
      ]
    );

    await writeGrnAudit("CREATE_DRAFT", id, actorUserId, actorRole, {
      grn_number: grnNumber,
      status: "draft",
      process_id: attribution.processId,
      cost_centre_id: attribution.costCentreId,
      cost_class: attribution.costClass,
    });

    return { id, grnNumber };
  },

  async submitForApproval(grnId: string, payload: SubmitGrnPayload, actorUserId: string, actorRole: string) {
    const grn = await getGrnOrThrow(grnId);
    if (grn.status !== "draft") {
      throw new Error(`GRN is already ${grn.status}, cannot submit`);
    }

    await db.execute(
      `UPDATE grn_request SET status = 'submitted', submitted_by = ?, submitted_at = NOW(), remarks = COALESCE(?,remarks) WHERE id = ?`,
      [actorUserId, payload.remarks ?? null, grnId]
    );

    await writeGrnAudit("SUBMIT", grnId, actorUserId, actorRole, { remarks: payload.remarks });
    return { success: true };
  },

  async reviewGrn(grnId: string, payload: ReviewGrnPayload, actorUserId: string, actorRole: string) {
    const grn = await getGrnOrThrow(grnId);
    if (grn.status !== "submitted") {
      throw new Error(`GRN must be 'submitted' to review. Current status: ${grn.status}`);
    }

    const newStatus: GrnStatus = payload.decision === "approved" ? "approved" : "rejected";

    await db.execute(
      `UPDATE grn_request
         SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
       WHERE id = ?`,
      [newStatus, actorUserId, payload.reviewNote ?? null, grnId]
    );

    await writeGrnAudit(payload.decision.toUpperCase(), grnId, actorUserId, actorRole, {
      review_note: payload.reviewNote,
    });

    // On approval of vendor GRN, auto-create vendor payment tracking entry
    if (newStatus === "approved" && grn.grn_type === "vendor") {
      try {
        await vendorPaymentService.createFromGrn(grnId, actorUserId);
      } catch (err) {
        // Non-blocking — payment tracking failure should not roll back the GRN approval
        console.error("[GRN] vendor payment tracking creation failed:", err);
      }
    }

    return { success: true, newStatus };
  },

  async cancelGrn(grnId: string, actorUserId: string, actorRole: string) {
    const grn = await getGrnOrThrow(grnId);
    if (["approved", "cancelled"].includes(grn.status)) {
      throw new Error(`Cannot cancel a GRN with status '${grn.status}'`);
    }

    await db.execute(
      `UPDATE grn_request SET status = 'cancelled', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [actorUserId, grnId]
    );

    await writeGrnAudit("CANCEL", grnId, actorUserId, actorRole, {});
    return { success: true };
  },

  async listGrns(filters: {
    branchId?: string;
    processId?: string;
    costCentreId?: string;
    costClass?: string;
    status?: string;
    financialYear?: string;
    grnType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.branchId) { conditions.push("g.branch_id = ?"); params.push(filters.branchId); }
    if (filters.processId) { conditions.push("g.process_id = ?"); params.push(filters.processId); }
    if (filters.costCentreId) { conditions.push("g.cost_centre_id = ?"); params.push(filters.costCentreId); }
    if (filters.costClass) { conditions.push("g.cost_class = ?"); params.push(filters.costClass); }
    if (filters.status) { conditions.push("g.status = ?"); params.push(filters.status); }
    if (filters.financialYear) { conditions.push("g.financial_year = ?"); params.push(filters.financialYear); }
    if (filters.grnType) { conditions.push("g.grn_type = ?"); params.push(filters.grnType); }
    if (filters.search) {
      conditions.push("(g.grn_number LIKE ? OR g.vendor_name LIKE ? OR g.head LIKE ?)");
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const page  = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, filters.limit ?? 30);
    const offset = (page - 1) * limit;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.*,
              bm.branch_name AS branch_name,
              pm.process_name,
              ccm.cost_centre_name,
              CONCAT(cb.first_name,' ',cb.last_name) AS created_by_name,
              CONCAT(rb.first_name,' ',rb.last_name) AS reviewed_by_name
       FROM grn_request g
       LEFT JOIN branch_master bm ON bm.id = g.branch_id
       LEFT JOIN process_master pm ON pm.id = g.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
       LEFT JOIN auth_user cb ON cb.id = g.created_by
       LEFT JOIN auth_user rb ON rb.id = g.reviewed_by
       ${where}
       ORDER BY g.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM grn_request g ${where}`,
      params
    );

    return {
      data: rows,
      total: countRows[0]?.total ?? 0,
      page,
      limit,
    };
  },

  async getGrn(grnId: string) {
    return getGrnOrThrow(grnId);
  },

  async saveAttachment(grnId: string, filePath: string, originalName: string, actorUserId: string) {
    await db.execute(
      `UPDATE grn_request SET attachment_path = ?, attachment_original_name = ? WHERE id = ?`,
      [filePath, originalName, grnId]
    );
    await logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "GRN_ATTACHMENT_SAVED",
      module_key: "finance",
      entity_type: "grn_request",
      entity_id: grnId,
      change_summary: { filePath },
    });
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getGrnOrThrow(grnId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM grn_request WHERE id = ? LIMIT 1`,
    [grnId]
  );
  if (!rows[0]) throw new Error("GRN not found");
  return rows[0] as RowDataPacket & {
    status: GrnStatus;
    grn_number: string;
    grn_type: GrnType;
    branch_id: string;
    process_id: string | null;
    cost_centre_id: string | null;
    cost_class: "direct" | "indirect";
    vendor_id: string | null;
    vendor_name: string | null;
    head: string;
    sub_head: string | null;
    amount: number;
    due_date: string | null;
    attachment_path: string | null;
    attachment_original_name: string | null;
    financial_year: string;
  };
}

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 4) return `${year}-${String(year + 1).slice(2)}`;
  return `${year - 1}-${String(year).slice(2)}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function resolveFinanceAttribution(
  processId: string | null,
  costCentreId: string | null,
  costClassInput: "direct" | "indirect" | undefined
) {
  let resolvedProcessId = processId?.trim() || null;
  const resolvedCostCentreId = costCentreId?.trim() || null;
  let mappedProcessId: string | null = null;

  if (resolvedCostCentreId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, process_id
         FROM cost_centre_master
        WHERE id = ?
        LIMIT 1`,
      [resolvedCostCentreId]
    );
    const costCentre = rows[0] as RowDataPacket | undefined;
    if (!costCentre) {
      throw new Error("Selected cost centre was not found");
    }
    mappedProcessId = costCentre.process_id ? String(costCentre.process_id) : null;
    if (resolvedProcessId && mappedProcessId && resolvedProcessId !== mappedProcessId) {
      throw new Error("Selected cost centre is mapped to a different process");
    }
    resolvedProcessId = resolvedProcessId ?? mappedProcessId;
  }

  const normalizedCostClass = costClassInput
    ?? (resolvedProcessId || resolvedCostCentreId ? "direct" : "indirect");

  if (normalizedCostClass === "direct" && !resolvedProcessId) {
    throw new Error("Direct GRN cost must be tagged to a process or a process-mapped cost centre");
  }

  if (normalizedCostClass === "indirect" && resolvedProcessId) {
    throw new Error("Indirect GRN cost cannot carry a direct process mapping");
  }

  return {
    processId: normalizedCostClass === "direct" ? resolvedProcessId : null,
    costCentreId: resolvedCostCentreId,
    costClass: normalizedCostClass,
  };
}

async function writeGrnAudit(
  actionType: string,
  grnId: string,
  actorUserId: string,
  actorRole: string,
  changeSummary: Record<string, unknown>
) {
  try {
    await db.execute(
      `INSERT INTO finance_action_audit_log
         (id, action_type, entity_type, entity_id, actor_user_id, actor_role, change_summary, created_at)
       VALUES (UUID(), ?, 'grn_request', ?, ?, ?, ?, NOW())`,
      [actionType, grnId, actorUserId, actorRole, JSON.stringify(changeSummary)]
    );
  } catch {
    // Non-blocking — audit failure must not break the main operation
  }
}
