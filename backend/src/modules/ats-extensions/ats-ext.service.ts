import { randomUUID, createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

const OFFER_TOKEN_SALT = "offer-salt";

function reqUiStatus(dbStatus: string) {
  if (dbStatus === "draft") return "pending";
  if (dbStatus === "open" || dbStatus === "in_progress") return "approved";
  if (dbStatus === "on_hold") return "rejected";
  return dbStatus;
}

function reqDbStatus(status?: string) {
  if (!status || status === "all") return null;
  if (status === "pending") return "draft";
  if (status === "approved") return "open";
  if (status === "rejected") return "on_hold";
  return status;
}

function bgvUiStatus(overall: string | null | undefined) {
  if (overall === "clear") return { status: "completed", result: "clear" };
  if (overall === "adverse") return { status: "failed", result: "discrepancy" };
  if (overall === "pending_review") return { status: "on_hold", result: "pending" };
  if (overall === "in_progress") return { status: "in_progress", result: "pending" };
  return { status: "initiated", result: "pending" };
}

function bgvDbStatus(data: Record<string, unknown>) {
  const status = String(data.overall_status ?? data.status ?? "");
  const result = String(data.result ?? "");
  if (status === "completed") return result === "discrepancy" ? "adverse" : "clear";
  if (status === "failed") return "adverse";
  if (status === "on_hold") return "pending_review";
  if (status === "initiated") return "pending";
  if (["pending", "in_progress", "clear", "adverse", "pending_review"].includes(status)) return status;
  return null;
}

function offerUiStatus(status: string) {
  if (status === "lapsed") return "expired";
  return status;
}

function rowNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

// ── Manpower Requisition ──────────────────────────────────────────────────────
export const requisitionService = {
  async list(filters: { status?: string; process_id?: string; branch_id?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    const dbStatus = reqDbStatus(filters.status);
    if (dbStatus) { conds.push("r.status = ?"); params.push(dbStatus); }
    if (filters.process_id) { conds.push("r.process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id) { conds.push("r.branch_id = ?"); params.push(filters.branch_id); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, p.process_name, b.branch_name, d.designation_name
         FROM manpower_requisition r
         LEFT JOIN process_master p ON p.id = r.process_id
         LEFT JOIN branch_master b ON b.id = r.branch_id
         LEFT JOIN designation_master d ON d.id = r.designation_id
        WHERE ${conds.join(" AND ")}
        ORDER BY r.created_at DESC
        LIMIT 200`,
      params,
    );
    return rows.map((row: any) => ({ ...row, status: reqUiStatus(String(row.status)) }));
  },

  async create(data: Record<string, unknown>, raisedBy: string, req?: Request) {
    const id = randomUUID();
    const code = `MR-${Date.now().toString(36).toUpperCase()}`;
    await db.execute(
      `INSERT INTO manpower_requisition
         (id, req_code, process_id, branch_id, department_id, designation_id, requested_count, priority, reason, expected_joining, raised_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [id, code, data.process_id ?? null, data.branch_id ?? null, data.department_id ?? null, data.designation_id ?? null, data.requested_count ?? 1, data.priority ?? "medium", data.reason ?? null, data.expected_joining ?? null, raisedBy],
    );
    await logSensitiveAction({ actor_user_id: raisedBy, action_type: "REQUISITION_CREATED", module_key: "ATS", entity_type: "manpower_requisition", entity_id: id, req });
    const list = await this.list({});
    return list.find((row: any) => row.id === id) ?? { id };
  },

  async approve(id: string, approvedBy: string, req?: Request, action: "approved" | "rejected" = "approved", remarks?: string) {
    const dbStatus = action === "approved" ? "open" : "on_hold";
    await db.execute(
      "UPDATE manpower_requisition SET status = ?, approved_by = ?, approved_at = NOW(), reason = COALESCE(CONCAT(COALESCE(reason, ''), ?), reason), updated_at = NOW() WHERE id = ?",
      [dbStatus, approvedBy, remarks ? `\nReview: ${remarks}` : null, id],
    );
    await logSensitiveAction({ actor_user_id: approvedBy, action_type: action === "approved" ? "REQUISITION_APPROVED" : "REQUISITION_REJECTED", module_key: "ATS", entity_type: "manpower_requisition", entity_id: id, change_summary: { action, remarks }, req });
  },
};

// ── BGV ───────────────────────────────────────────────────────────────────────
export const bgvService = {
  async get(candidateId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT b.*, c.full_name AS candidate_name
         FROM ats_bgv_record b
         LEFT JOIN ats_candidate c ON c.id = b.candidate_id
        WHERE b.candidate_id = ?
        LIMIT 1`,
      [candidateId],
    );
    const row = rows[0] as any;
    if (!row) return null;
    const mapped = bgvUiStatus(row.overall_status);
    return {
      id: row.id,
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      vendor_name: row.bgv_vendor ?? "",
      initiated_date: normalizeDate(row.initiated_date),
      documents_submitted: [],
      status: mapped.status,
      result: mapped.result,
      completed_date: normalizeDate(row.completed_date),
      remarks: row.remarks,
      raw_status: row.overall_status,
    };
  },

  async initiate(candidateId: string, data: Record<string, unknown>, initiatedBy: string, req?: Request) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO ats_bgv_record (id, candidate_id, bgv_vendor, initiated_date, initiated_by, overall_status)
       VALUES (?, ?, ?, ?, ?, 'in_progress')
       ON DUPLICATE KEY UPDATE bgv_vendor = VALUES(bgv_vendor), initiated_date = VALUES(initiated_date), overall_status = 'in_progress', updated_at = NOW()`,
      [id, candidateId, data.bgv_vendor ?? data.vendor_name ?? null, data.initiated_date ?? new Date().toISOString().slice(0, 10), initiatedBy],
    );
    await db.execute("UPDATE ats_candidate SET bgv_status = 'in_progress' WHERE id = ?", [candidateId]);
    await logSensitiveAction({ actor_user_id: initiatedBy, action_type: "BGV_INITIATED", module_key: "ATS", entity_type: "candidate", entity_id: candidateId, req });
    return this.get(candidateId);
  },

  async updateStatus(candidateId: string, data: Record<string, unknown>, updatedBy: string, req?: Request) {
    const overall = bgvDbStatus(data);
    await db.execute(
      `UPDATE ats_bgv_record SET
          overall_status = COALESCE(?, overall_status),
          address_check = COALESCE(?, address_check),
          education_check = COALESCE(?, education_check),
          employment_check = COALESCE(?, employment_check),
          criminal_check = COALESCE(?, criminal_check),
          remarks = COALESCE(?, remarks),
          completed_date = CASE WHEN ? IN ('clear','adverse') THEN COALESCE(?, CURDATE()) ELSE completed_date END,
          updated_at = NOW()
        WHERE candidate_id = ?`,
      [overall, data.address_check ?? null, data.education_check ?? null, data.employment_check ?? null, data.criminal_check ?? null, data.remarks ?? null, overall, data.completed_date ?? null, candidateId],
    );
    if (overall) await db.execute("UPDATE ats_candidate SET bgv_status = ? WHERE id = ?", [overall, candidateId]);
    await logSensitiveAction({ actor_user_id: updatedBy, action_type: "BGV_UPDATED", module_key: "ATS", entity_type: "candidate", entity_id: candidateId, change_summary: { overall_status: overall, ui_status: data.status, result: data.result }, req });
    return this.get(candidateId);
  },
};

// ── Offer Management ──────────────────────────────────────────────────────────
export const offerService = {
  async list(candidateId?: string, status?: string) {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (candidateId) { conds.push("o.candidate_id = ?"); params.push(candidateId); }
    if (status && status !== "all") { conds.push("o.status = ?"); params.push(status === "expired" ? "lapsed" : status); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT o.*, c.full_name AS candidate_name, c.mobile, c.email
         FROM ats_offer o
         JOIN ats_candidate c ON c.id = o.candidate_id
        ${where}
        ORDER BY o.created_at DESC
        LIMIT 100`,
      params,
    );
    return rows.map((row: any) => ({
      ...row,
      candidate_name: row.candidate_name,
      ctc_annual: rowNumber(row.offered_ctc),
      role_title: row.offered_designation ?? "Offer",
      offer_expiry: normalizeDate(row.offer_expiry_date),
      joining_date: normalizeDate(row.joining_date),
      status: offerUiStatus(String(row.status)),
    }));
  },

  generateToken(offerId: string, candidateEmail: string): string {
    return createHash("sha256").update(`${offerId}${candidateEmail}${OFFER_TOKEN_SALT}`).digest("hex");
  },

  async create(data: Record<string, unknown>, preparedBy: string, req?: Request) {
    const id = randomUUID();
    const [candRows] = await db.execute<RowDataPacket[]>(
      "SELECT email, applied_for_process, applied_for_branch FROM ats_candidate WHERE id = ? LIMIT 1",
      [data.candidate_id],
    );
    if (!candRows[0]) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });
    await db.execute(
      `INSERT INTO ats_offer (id, candidate_id, requisition_id, offered_ctc, offered_designation, offered_process, offered_branch, offer_date, offer_expiry_date, joining_date, prepared_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.candidate_id, data.requisition_id ?? null, data.offered_ctc ?? data.ctc_annual ?? null, data.offered_designation ?? data.role_title ?? null, data.offered_process ?? candRows[0].applied_for_process ?? null, data.offered_branch ?? candRows[0].applied_for_branch ?? null, data.offer_date ?? new Date().toISOString().slice(0, 10), data.offer_expiry_date ?? data.offer_expiry ?? null, data.joining_date ?? null, preparedBy],
    );
    await db.execute("UPDATE ats_candidate SET offer_status = 'draft' WHERE id = ?", [data.candidate_id]);
    await logSensitiveAction({ actor_user_id: preparedBy, action_type: "OFFER_CREATED", module_key: "ATS", entity_type: "candidate", entity_id: data.candidate_id as string, req });
    const rows = await this.list(data.candidate_id as string);
    return rows.find((row: any) => row.id === id) ?? { id };
  },

  async respondToOffer(offerId: string, action: "accepted" | "declined", token: string, candidateName: string, remarks?: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT o.id, o.status, o.candidate_id, c.email
         FROM ats_offer o
         JOIN ats_candidate c ON c.id = o.candidate_id
        WHERE o.id = ? LIMIT 1`,
      [offerId],
    );
    const offer = rows[0] as any;
    if (!offer) throw new Error("Offer not found");
    if (!["draft", "sent"].includes(String(offer.status))) throw new Error("Offer is no longer pending response");
    const expectedToken = offerService.generateToken(offerId, offer.email ?? "");
    if (token !== expectedToken) throw new Error("Invalid or expired token");
    const nextStatus = action === "accepted" ? "accepted" : "rejected";
    await db.execute("UPDATE ats_offer SET status = ?, rejection_reason = COALESCE(?, rejection_reason), updated_at = NOW() WHERE id = ?", [nextStatus, remarks ?? null, offerId]);
    await db.execute("UPDATE ats_candidate SET current_stage = ?, offer_status = ?, updated_at = NOW() WHERE id = ?", [action === "accepted" ? "offer_accepted" : "offer_declined", nextStatus, offer.candidate_id]);
    void candidateName;
  },

  async updateStatus(offerId: string, status: string, reason: string | undefined, actorId: string, req?: Request) {
    const dbStatus = status === "expired" ? "lapsed" : status;
    await db.execute("UPDATE ats_offer SET status = ?, rejection_reason = COALESCE(?, rejection_reason), updated_at = NOW() WHERE id = ?", [dbStatus, reason ?? null, offerId]);
    await db.execute("UPDATE ats_candidate c JOIN ats_offer o ON o.candidate_id = c.id SET c.offer_status = ? WHERE o.id = ?", [status, offerId]);
    await logSensitiveAction({ actor_user_id: actorId, action_type: "OFFER_STATUS_CHANGED", module_key: "ATS", entity_type: "offer", entity_id: offerId, change_summary: { status }, req });
  },
};

// ── Duplicate Detection ───────────────────────────────────────────────────────
export const duplicateService = {
  async checkDuplicates(candidateId: string, mobile: string, email?: string): Promise<RowDataPacket[]> {
    const conds = ["id != ? AND active_status = 1 AND (mobile = ?"];
    const params: unknown[] = [candidateId, mobile];
    if (email) { conds[0] += " OR email = ?"; params.push(email); }
    conds[0] += ")";
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT id, candidate_code, full_name, mobile, email, current_stage, created_at FROM ats_candidate WHERE ${conds[0]} LIMIT 10`, params);
    return rows;
  },

  async logDuplicate(candidateId: string, matchedWithId: string, reason: string, score?: number) {
    const [existing] = await db.execute<RowDataPacket[]>("SELECT id FROM ats_duplicate_log WHERE candidate_id = ? AND matched_with_id = ? AND resolved = 0 LIMIT 1", [candidateId, matchedWithId]);
    if (existing.length > 0) return;
    await db.execute("INSERT INTO ats_duplicate_log (id, candidate_id, matched_with_id, match_reason, match_score) VALUES (?, ?, ?, ?, ?)", [randomUUID(), candidateId, matchedWithId, reason, score ?? null]);
  },

  async listUnresolved() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dl.id, dl.match_score, dl.match_reason, dl.resolved, dl.detected_at,
              c1.id AS candidate_id, c1.full_name AS candidate_name, c1.email AS candidate_email, CONCAT(LEFT(c1.mobile, 3), '****', RIGHT(c1.mobile, 2)) AS candidate_mobile_masked,
              c2.id AS matched_with_id, c2.full_name AS matched_name, c2.email AS matched_email, CONCAT(LEFT(c2.mobile, 3), '****', RIGHT(c2.mobile, 2)) AS matched_mobile_masked
         FROM ats_duplicate_log dl
         JOIN ats_candidate c1 ON c1.id = dl.candidate_id
         JOIN ats_candidate c2 ON c2.id = dl.matched_with_id
        WHERE dl.resolved = 0
        ORDER BY dl.detected_at DESC
        LIMIT 100`,
    );
    return rows.map((row: any) => ({
      id: row.id,
      match_score: row.match_score != null ? Number(row.match_score) / 100 : undefined,
      created_at: row.detected_at,
      resolved: Boolean(row.resolved),
      candidates: [
        { id: row.candidate_id, name: row.candidate_name, email: row.candidate_email, phone: row.candidate_mobile_masked, is_primary: true },
        { id: row.matched_with_id, name: row.matched_name, email: row.matched_email, phone: row.matched_mobile_masked, is_primary: false },
      ],
    }));
  },

  async resolve(id: string, note: string, resolvedBy: string, req?: Request) {
    await db.execute("UPDATE ats_duplicate_log SET resolved = 1, resolution_note = ? WHERE id = ?", [note, id]);
    await logSensitiveAction({ actor_user_id: resolvedBy, action_type: "DUPLICATE_RESOLVED", module_key: "ATS", entity_type: "ats_duplicate_log", entity_id: id, change_summary: { note }, req });
  },
};

// ── Sourcing Funnel Analytics ─────────────────────────────────────────────────
export const sourcingAnalyticsService = {
  async getFunnel(filters: { from_date?: string; to_date?: string; start_date?: string; end_date?: string; process?: string; process_id?: string; branch?: string; branch_id?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    const from = filters.from_date ?? filters.start_date;
    const to = filters.to_date ?? filters.end_date;
    if (from) { conds.push("DATE(created_at) >= ?"); params.push(from); }
    if (to) { conds.push("DATE(created_at) <= ?"); params.push(to); }
    if (filters.process ?? filters.process_id) { conds.push("applied_for_process = ?"); params.push(filters.process ?? filters.process_id); }
    if (filters.branch ?? filters.branch_id) { conds.push("applied_for_branch = ?"); params.push(filters.branch ?? filters.branch_id); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(NULLIF(current_stage, ''), 'Applied') AS stage, COUNT(*) AS count
         FROM ats_candidate
        WHERE ${conds.join(" AND ")}
        GROUP BY COALESCE(NULLIF(current_stage, ''), 'Applied')
        ORDER BY count DESC`,
      params,
    );
    return rows.map((row: any) => ({ stage: row.stage, count: Number(row.count ?? 0) }));
  },

  async getStageWise(filters: { from_date?: string; to_date?: string; start_date?: string; end_date?: string; process_id?: string }) {
    const funnel = await this.getFunnel(filters as any);
    const ordered = funnel.map((row: any) => ({ stage: row.stage, count: row.count }));
    const result: Array<{ from_stage: string; to_stage: string; conversion_rate: number; count_in: number; count_out: number }> = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      result.push({ from_stage: from.stage, to_stage: to.stage, count_in: from.count, count_out: to.count, conversion_rate: from.count > 0 ? to.count / from.count : 0 });
    }
    return result;
  },
};
