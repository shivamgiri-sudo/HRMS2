import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

// ── Manpower Requisition ──────────────────────────────────────────────────────

export const requisitionService = {
  async list(filters: { status?: string; process_id?: string; branch_id?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.status)     { conds.push("r.status = ?");     params.push(filters.status); }
    if (filters.process_id) { conds.push("r.process_id = ?"); params.push(filters.process_id); }
    if (filters.branch_id)  { conds.push("r.branch_id = ?");  params.push(filters.branch_id); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, p.process_name, b.branch_name, d.designation_name
       FROM manpower_requisition r
       LEFT JOIN process_master p ON p.id = r.process_id
       LEFT JOIN branch_master b ON b.id = r.branch_id
       LEFT JOIN designation_master d ON d.id = r.designation_id
       WHERE ${conds.join(" AND ")} ORDER BY r.created_at DESC LIMIT 200`,
      params
    );
    return rows as RowDataPacket[];
  },

  async create(data: Record<string, unknown>, raisedBy: string, req?: Request) {
    const id = randomUUID();
    const code = `MR-${Date.now().toString(36).toUpperCase()}`;
    await db.execute(
      `INSERT INTO manpower_requisition
         (id, req_code, process_id, branch_id, department_id, designation_id,
          requested_count, priority, reason, expected_joining, raised_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, code, data.process_id ?? null, data.branch_id ?? null, data.department_id ?? null,
       data.designation_id ?? null, data.requested_count ?? 1, data.priority ?? "medium",
       data.reason ?? null, data.expected_joining ?? null, raisedBy]
    );
    await logSensitiveAction({ actor_user_id: raisedBy, action_type: "REQUISITION_CREATED", module_key: "ATS", entity_type: "manpower_requisition", entity_id: id, req });
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM manpower_requisition WHERE id = ? LIMIT 1", [id]);
    return (rows as RowDataPacket[])[0];
  },

  async approve(id: string, approvedBy: string, req?: Request) {
    await db.execute(
      "UPDATE manpower_requisition SET status = 'open', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?",
      [approvedBy, id]
    );
    await logSensitiveAction({ actor_user_id: approvedBy, action_type: "REQUISITION_APPROVED", module_key: "ATS", entity_type: "manpower_requisition", entity_id: id, req });
  },
};

// ── BGV ───────────────────────────────────────────────────────────────────────

export const bgvService = {
  async get(candidateId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM ats_bgv_record WHERE candidate_id = ? LIMIT 1", [candidateId]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async initiate(candidateId: string, data: Record<string, unknown>, initiatedBy: string, req?: Request) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO ats_bgv_record (id, candidate_id, bgv_vendor, initiated_date, initiated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bgv_vendor = VALUES(bgv_vendor), initiated_date = VALUES(initiated_date),
         overall_status = 'in_progress', updated_at = NOW()`,
      [id, candidateId, data.bgv_vendor ?? null, data.initiated_date ?? new Date().toISOString().slice(0, 10), initiatedBy]
    );
    await db.execute("UPDATE ats_candidate SET bgv_status = 'in_progress' WHERE id = ?", [candidateId]);
    await logSensitiveAction({ actor_user_id: initiatedBy, action_type: "BGV_INITIATED", module_key: "ATS", entity_type: "candidate", entity_id: candidateId, req });
    return this.get(candidateId);
  },

  async updateStatus(candidateId: string, data: Record<string, unknown>, updatedBy: string, req?: Request) {
    await db.execute(
      `UPDATE ats_bgv_record SET
         overall_status = COALESCE(?, overall_status),
         address_check = COALESCE(?, address_check),
         education_check = COALESCE(?, education_check),
         employment_check = COALESCE(?, employment_check),
         criminal_check = COALESCE(?, criminal_check),
         remarks = COALESCE(?, remarks),
         completed_date = IF(? IN ('clear','adverse'), CURDATE(), completed_date),
         updated_at = NOW()
       WHERE candidate_id = ?`,
      [data.overall_status ?? null, data.address_check ?? null, data.education_check ?? null,
       data.employment_check ?? null, data.criminal_check ?? null, data.remarks ?? null,
       data.overall_status ?? null, candidateId]
    );
    if (data.overall_status) {
      await db.execute("UPDATE ats_candidate SET bgv_status = ? WHERE id = ?", [data.overall_status, candidateId]);
    }
    await logSensitiveAction({ actor_user_id: updatedBy, action_type: "BGV_UPDATED", module_key: "ATS", entity_type: "candidate", entity_id: candidateId, change_summary: { overall_status: data.overall_status }, req });
    return this.get(candidateId);
  },
};

// ── Offer Management ──────────────────────────────────────────────────────────

export const offerService = {
  async list(candidateId?: string) {
    const where = candidateId ? "WHERE o.candidate_id = ?" : "";
    const params = candidateId ? [candidateId] : [];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT o.*, c.full_name, c.mobile FROM ats_offer o
       JOIN ats_candidate c ON c.id = o.candidate_id
       ${where} ORDER BY o.created_at DESC LIMIT 100`,
      params
    );
    return rows as RowDataPacket[];
  },

  async create(data: Record<string, unknown>, preparedBy: string, req?: Request) {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO ats_offer (id, candidate_id, requisition_id, offered_ctc, offered_designation,
         offered_process, offered_branch, offer_date, offer_expiry_date, joining_date, prepared_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.candidate_id, data.requisition_id ?? null, data.offered_ctc ?? null,
       data.offered_designation ?? null, data.offered_process ?? null, data.offered_branch ?? null,
       data.offer_date, data.offer_expiry_date ?? null, data.joining_date ?? null, preparedBy]
    );
    await logSensitiveAction({ actor_user_id: preparedBy, action_type: "OFFER_CREATED", module_key: "ATS", entity_type: "candidate", entity_id: data.candidate_id as string, req });
    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM ats_offer WHERE id = ? LIMIT 1", [id]);
    return (rows as RowDataPacket[])[0];
  },

  async updateStatus(offerId: string, status: string, reason: string | undefined, actorId: string, req?: Request) {
    await db.execute(
      "UPDATE ats_offer SET status = ?, rejection_reason = COALESCE(?, rejection_reason), updated_at = NOW() WHERE id = ?",
      [status, reason ?? null, offerId]
    );
    await logSensitiveAction({ actor_user_id: actorId, action_type: "OFFER_STATUS_CHANGED", module_key: "ATS", entity_type: "offer", entity_id: offerId, change_summary: { status }, req });
  },
};

// ── Duplicate Detection ───────────────────────────────────────────────────────

export const duplicateService = {
  /**
   * Check new candidate for duplicates by mobile or email.
   * Returns list of potential matches with match reason.
   */
  async checkDuplicates(candidateId: string, mobile: string, email?: string): Promise<RowDataPacket[]> {
    const conds = ["id != ? AND active_status = 1 AND (mobile = ?"];
    const params: unknown[] = [candidateId, mobile];
    if (email) {
      conds[0] += " OR email = ?";
      params.push(email);
    }
    conds[0] += ")";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, candidate_code, full_name, mobile, email, current_stage, created_at
       FROM ats_candidate WHERE ${conds[0]} LIMIT 10`,
      params
    );
    return rows as RowDataPacket[];
  },

  async logDuplicate(candidateId: string, matchedWithId: string, reason: string, score?: number) {
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM ats_duplicate_log WHERE candidate_id = ? AND matched_with_id = ? AND resolved = 0 LIMIT 1",
      [candidateId, matchedWithId]
    );
    if ((existing as RowDataPacket[]).length > 0) return; // already logged, skip
    const id = randomUUID();
    await db.execute(
      "INSERT INTO ats_duplicate_log (id, candidate_id, matched_with_id, match_reason, match_score) VALUES (?, ?, ?, ?, ?)",
      [id, candidateId, matchedWithId, reason, score ?? null]
    );
  },

  async listUnresolved() {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dl.*, c1.full_name AS candidate_name, c2.full_name AS matched_name,
              CONCAT(LEFT(c1.mobile, 3), '****', RIGHT(c1.mobile, 2)) AS candidate_mobile_masked,
              CONCAT(LEFT(c2.mobile, 3), '****', RIGHT(c2.mobile, 2)) AS matched_mobile_masked
       FROM ats_duplicate_log dl
       JOIN ats_candidate c1 ON c1.id = dl.candidate_id
       JOIN ats_candidate c2 ON c2.id = dl.matched_with_id
       WHERE dl.resolved = 0 ORDER BY dl.detected_at DESC LIMIT 100`
    );
    return rows as RowDataPacket[];
  },

  async resolve(id: string, note: string, resolvedBy: string, req?: Request) {
    await db.execute("UPDATE ats_duplicate_log SET resolved = 1, resolution_note = ? WHERE id = ?", [note, id]);
    await logSensitiveAction({ actor_user_id: resolvedBy, action_type: "DUPLICATE_RESOLVED", module_key: "ATS", entity_type: "ats_duplicate_log", entity_id: id, change_summary: { note }, req });
  },
};

// ── Sourcing Funnel Analytics ─────────────────────────────────────────────────

export const sourcingAnalyticsService = {
  async getFunnel(filters: { from_date?: string; to_date?: string; process?: string; branch?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.from_date)    { conds.push("DATE(created_at) >= ?");      params.push(filters.from_date); }
    if (filters.to_date)      { conds.push("DATE(created_at) <= ?");       params.push(filters.to_date); }
    if (filters.process)      { conds.push("applied_for_process = ?");     params.push(filters.process); }
    if (filters.branch)       { conds.push("applied_for_branch = ?");      params.push(filters.branch); }
    const where = conds.join(" AND ");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         sourcing_channel,
         COUNT(*) AS total_applied,
         SUM(CASE WHEN current_stage = 'Selected' THEN 1 ELSE 0 END) AS total_selected,
         SUM(CASE WHEN current_stage = 'Onboarded' THEN 1 ELSE 0 END) AS total_onboarded,
         SUM(CASE WHEN current_stage = 'Rejected' THEN 1 ELSE 0 END) AS total_rejected,
         ROUND(100.0 * SUM(CASE WHEN current_stage IN ('Selected','Onboarded') THEN 1 ELSE 0 END) / COUNT(*), 2) AS conversion_pct
       FROM ats_candidate WHERE ${where}
       GROUP BY sourcing_channel ORDER BY total_applied DESC`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getStageWise(filters: { from_date?: string; to_date?: string }) {
    const conds = ["1=1"];
    const params: unknown[] = [];
    if (filters.from_date) { conds.push("DATE(created_at) >= ?"); params.push(filters.from_date); }
    if (filters.to_date)   { conds.push("DATE(created_at) <= ?"); params.push(filters.to_date); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT current_stage, COUNT(*) AS count
       FROM ats_candidate WHERE ${conds.join(" AND ")}
       GROUP BY current_stage ORDER BY count DESC`,
      params
    );
    return rows as RowDataPacket[];
  },
};
