/**
 * Qualified follow-up enqueue. One row per (mobile10, requisition_id); the first source wins and a later different source is appended to
 * also_in_sources. With QUAL_FOLLOWUP_MODE off nothing touches the database. Enqueue functions never throw.
 */
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { EnqueueInput, FollowupMode, SourceType } from "./qualified-followup.types.js";
import { classifySource, dueTimes, followupMode, normaliseMobile10 } from "./qualified-followup.schedule.js";

export type EnqueueStatus = "skipped_off" | "enqueued" | "exists" | "invalid";

export async function enqueueQualifiedFollowup(input: EnqueueInput, mode: FollowupMode = followupMode()): Promise<{ status: EnqueueStatus; id?: string }> {
  if (mode === "off") return { status: "skipped_off" };
  try {
    const mobile10 = normaliseMobile10(input.phone);
    if (!mobile10 || !input.requisitionId) return { status: "invalid" };
    const qualifiedAt = input.qualifiedAt ?? new Date();
    const email = input.email?.trim() || null;
    const { emailDueAt, waDueAt } = dueTimes({ qualifiedAt, hasEmail: !!email });
    const [ins] = await db.execute<ResultSetHeader>(
      `INSERT INTO qualified_followup (source_type, meta_lead_id, he_lead_id, ats_candidate_id, requisition_id, campaign_id, drive_id, origin_id, origin_label,
         mobile10, email, full_name, branch_name, role_name, qualified_at, email_due_at, wa_due_at, call_due_at, mode_at_enqueue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [input.sourceType, input.metaLeadId ?? null, input.heLeadId ?? null, input.atsCandidateId ?? null, input.requisitionId, input.campaignId ?? null,
       input.driveId ?? null, input.originId, input.originLabel, mobile10, email, input.fullName ?? null, input.branchName ?? null, input.roleName ?? null,
       qualifiedAt, emailDueAt, waDueAt, mode]);
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, source_type, also_in_sources FROM qualified_followup WHERE mobile10 = ? AND requisition_id = ? LIMIT 1", [mobile10, input.requisitionId]);
    const row = rows[0];
    if (ins.affectedRows > 0) return { status: "enqueued", id: row?.id as string | undefined };
    if (!row) return { status: "invalid" };
    if (row.source_type !== input.sourceType) {
      let also: string[] = [];
      try { const v = typeof row.also_in_sources === "string" ? JSON.parse(row.also_in_sources) : row.also_in_sources; if (Array.isArray(v)) also = v; } catch { /* treat as empty */ }
      if (!also.includes(input.sourceType)) {
        also.push(input.sourceType);
        await db.execute("UPDATE qualified_followup SET also_in_sources = ? WHERE id = ?", [JSON.stringify(also), row.id]);
      }
    }
    return { status: "exists", id: row.id as string };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[qualified-followup] enqueue failed");
    return { status: "invalid" };
  }
}

export async function enqueueMetaLeadFollowup(metaLeadId: string, mode: FollowupMode = followupMode()): Promise<{ status: EnqueueStatus | "not_qualified" }> {
  if (mode === "off") return { status: "skipped_off" };
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.id, r.screening_result, r.parsed_name, r.parsed_phone, r.parsed_email, r.campaign_id,
              COALESCE(r.requisition_id, c.requisition_id) AS req_id, c.campaign_name, c.campaign_status, jr.id AS jr_id, jr.branch_name, jr.designation_name
         FROM meta_lead_raw r
         LEFT JOIN meta_campaign c ON c.id = r.campaign_id
         LEFT JOIN job_requisition jr ON jr.id = COALESCE(r.requisition_id, c.requisition_id)
        WHERE r.id = ? LIMIT 1`, [metaLeadId]);
    const r = rows[0];
    if (!r) return { status: "invalid" };
    if (r.screening_result !== "qualified") return { status: "not_qualified" };
    if (!r.req_id || !r.jr_id) return { status: "invalid" };
    const res = await enqueueQualifiedFollowup({
      sourceType: classifySource({ campaignStatus: r.campaign_status }),
      metaLeadId, requisitionId: r.req_id, campaignId: r.campaign_id ?? null,
      originId: String(r.campaign_id ?? ""), originLabel: String(r.campaign_name ?? ""),
      phone: r.parsed_phone, email: r.parsed_email, fullName: r.parsed_name,
      branchName: r.branch_name ?? null, roleName: r.designation_name ?? null,
    }, mode);
    return { status: res.status };
  } catch (err) {
    logger.warn({ metaLeadId, err: (err as Error).message }, "[qualified-followup] meta enqueue failed");
    return { status: "invalid" };
  }
}

export async function followupSummary(): Promise<Array<{ sourceType: SourceType; total: number; stopped: number; open: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT source_type, COUNT(*) AS total, SUM(stopped_reason IS NOT NULL) AS stopped, SUM(stopped_reason IS NULL) AS open_n
       FROM qualified_followup GROUP BY source_type`);
  return rows.map((x) => ({ sourceType: x.source_type as SourceType, total: Number(x.total), stopped: Number(x.stopped ?? 0), open: Number(x.open_n ?? 0) }));
}
