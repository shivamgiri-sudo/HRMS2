/**
 * One enrolment for Live Meta, Old Meta data and Hiring Engine people (unified follow-up). One row per (mobile10, requisition_id); the
 * first source wins and later sources are appended to also_in_sources. The row tag comes from the per-source screen switch (capped by
 * QUAL_FOLLOWUP_MODE); a source that is off makes no database call. Enqueue functions never throw.
 */
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { EnqueueInput, FollowupStreamRef, MatchedDriveRef, RowTag, SourceType } from "./qualified-followup.types.js";
import { enrolTag, loadFollowupSwitches, type FollowupSwitches } from "./qualified-followup.policy.js";
import { classifySource, dueTimes, normaliseMobile10 } from "./qualified-followup.schedule.js";
import { requisitionOpenReason } from "./followup-guards.js";
import { loadRequisitionFacts } from "./followup-guards.service.js";
import { enrolIneligibility } from "./followup-enrol-eligibility.service.js";
import { addEvent } from "./he-lead.service.js";

export type EnqueueStatus = "skipped_off" | "enqueued" | "promoted" | "held" | "ineligible" | "exists" | "invalid";
export interface EnqueueResult { status: EnqueueStatus; id?: string; reason?: string; linked?: boolean }

const TAG_RANK: Record<RowTag, number> = { dry_run: 0, test: 1, canary: 2, live: 3 };

type ExistingRow = { id: string; source_type: string; also_in_sources: unknown; mode_at_enqueue: RowTag; stopped_reason: string | null; email: string | null; he_lead_id: string | null; match_id: string | null };

async function findRow(mobile10: string, requisitionId: string): Promise<ExistingRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, source_type, also_in_sources, mode_at_enqueue, stopped_reason, email, he_lead_id, match_id, drive_id FROM qualified_followup WHERE mobile10 = ? AND requisition_id = ? LIMIT 1",
    [mobile10, requisitionId]);
  return (rows[0] as ExistingRow | undefined) ?? null;
}

export async function enqueueQualifiedFollowup(input: EnqueueInput, s?: FollowupSwitches): Promise<EnqueueResult> {
  try {
    const sw = s ?? (await loadFollowupSwitches());
    const tag = enrolTag(sw, input.sourceType, input.requisitionId);
    if (!tag) return { status: "skipped_off" };
    const mobile10 = normaliseMobile10(input.phone);
    if (!mobile10 || !input.requisitionId) return { status: "invalid" };
    const closed = requisitionOpenReason(await loadRequisitionFacts(input.requisitionId));
    if (closed) return { status: "invalid", reason: closed };
    return await enrol(input, tag, mobile10);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[qualified-followup] enqueue failed");
    return { status: "invalid" };
  }
}

/** Requisition already checked open; writes or updates the row. */
async function enrol(input: EnqueueInput, tag: RowTag, mobile10: string): Promise<EnqueueResult> {
  const found = await findRow(mobile10, input.requisitionId);
  if (found) return onExisting(found, input, tag);
  const ineligible = input.eligibilityChecked ? null : await enrolIneligibility({
    mobile10, heLeadId: input.heLeadId ?? null, atsCandidateId: input.atsCandidateId ?? null, requisitionId: input.requisitionId, location: input.location ?? null,
  });
  const held = ineligible ? null : input.heldReason ?? null;
  const now = input.qualifiedAt ?? new Date();
  const email = input.email?.trim() || null;
  const due = ineligible || held ? { emailDueAt: null, waDueAt: null } : dueTimes({ enrolledAt: now, hasEmail: !!email });
  // The id is generated here: with mysql2's default FOUND_ROWS flag affectedRows cannot tell a new row from an existing one.
  const id = randomUUID();
  await db.execute(
    `INSERT INTO qualified_followup (id, source_type, meta_lead_id, he_lead_id, ats_candidate_id, requisition_id, campaign_id, drive_id, origin_id, origin_label,
       mobile10, email, full_name, branch_name, role_name, qualified_at, email_due_at, wa_due_at, journey_state, held_reason, stopped_reason, stopped_at, match_id,
       owner, call_state, mode_at_enqueue)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [id, input.sourceType, input.metaLeadId ?? null, input.heLeadId ?? null, input.atsCandidateId ?? null, input.requisitionId, input.campaignId ?? null,
     input.driveId ?? null, input.originId, input.originLabel, mobile10, email, input.fullName ?? null, input.branchName ?? null, input.roleName ?? null,
     now, due.emailDueAt, due.waDueAt, ineligible ? "stopped" : held ? "held_manual" : "enrolled", held, ineligible ? `ineligible_${ineligible}` : null,
     ineligible ? now : null, input.matchId ?? null, "pipeline", "pending", tag]);
  const row = await findRow(mobile10, input.requisitionId);
  if (!row) return { status: "invalid" };
  if (row.id !== id) return onExisting(row, input, tag); // a concurrent enrolment won the insert
  if (ineligible) return { status: "ineligible", id, reason: ineligible };
  return { status: held ? "held" : "enqueued", id };
}

/** Existing row: record the extra source, link the line-up's booking, promote a lower open tag (never demote, never revive a stopped row). */
async function onExisting(row: ExistingRow, input: EnqueueInput, tag: RowTag): Promise<EnqueueResult> {
  if (row.source_type !== input.sourceType) {
    let also: string[] = [];
    try { const v = typeof row.also_in_sources === "string" ? JSON.parse(row.also_in_sources) : row.also_in_sources; if (Array.isArray(v)) also = v; } catch { /* treat as empty */ }
    if (!also.includes(input.sourceType)) {
      also.push(input.sourceType);
      await db.execute("UPDATE qualified_followup SET also_in_sources = ? WHERE id = ?", [JSON.stringify(also), row.id]);
    }
  }
  let linked = false;
  if (input.matchId && !row.match_id) {
    const [u] = await db.execute<ResultSetHeader>(
      "UPDATE qualified_followup SET match_id = COALESCE(match_id, ?), drive_id = COALESCE(drive_id, ?) WHERE id = ?", [input.matchId, input.driveId ?? null, row.id]);
    linked = Number(u?.affectedRows ?? 0) > 0;
  }
  if (TAG_RANK[tag] > TAG_RANK[row.mode_at_enqueue] && !row.stopped_reason) {
    // Promoted in place (the person + requisition key is unique): the journey starts fresh, from now.
    const held = input.heldReason ?? null;
    const email = row.email ?? (input.email?.trim() || null);
    const due = held ? { emailDueAt: null, waDueAt: null } : dueTimes({ enrolledAt: new Date(), hasEmail: !!email });
    const [u] = await db.execute<ResultSetHeader>(
      `UPDATE qualified_followup SET mode_at_enqueue = ?, journey_state = ?, held_reason = ?, owner = 'pipeline',
              email_due_at = ?, email_sent_at = NULL, email_status = NULL, email_error = NULL, email_attempts = 0,
              wa_due_at = ?, wa_sent_at = NULL, wa_status = NULL, wa_error = NULL, wa_attempts = 0, wa_template_key = NULL, wa_message_id = NULL,
              call_due_at = NULL, call_state = 'pending', call_attempts = 0, call_error = NULL, call_file_batch_id = NULL, called_at = NULL, call_result = NULL,
              missing_details = NULL, step_claimed_at = NULL, stage_a_ended_at = NULL, missed_call_due_at = NULL
        WHERE id = ? AND mode_at_enqueue = ? AND stopped_reason IS NULL`,
      [tag, held ? "held_manual" : "enrolled", held, due.emailDueAt, due.waDueAt, row.id, row.mode_at_enqueue]);
    if (Number(u?.affectedRows ?? 0) > 0) {
      const leadId = row.he_lead_id ?? input.heLeadId ?? null;
      if (leadId) await addEvent(leadId, "followup_promoted", { detail: `${row.mode_at_enqueue} -> ${tag}` });
      return linked ? { status: "promoted", id: row.id, linked } : { status: "promoted", id: row.id };
    }
  }
  return linked ? { status: "exists", id: row.id, linked } : { status: "exists", id: row.id };
}

const parseCfg = (v: unknown): Record<string, unknown> | null => {
  if (!v) return null;
  try { const o = typeof v === "string" ? JSON.parse(v) : v; return o && typeof o === "object" ? (o as Record<string, unknown>) : null; } catch { return null; }
};

/** Live Meta ingest (and the sync safety net): the lead's routed requisition; auto_notify off or skipOutreach -> held_manual (D13). */
export async function enqueueMetaLeadFollowup(metaLeadId: string, o: { switches?: FollowupSwitches; skipOutreach?: boolean } = {}): Promise<{ status: EnqueueStatus | "not_qualified"; id?: string }> {
  try {
    const sw = o.switches ?? (await loadFollowupSwitches());
    if (sw.sourceModes.meta_live === "off") return { status: "skipped_off" };
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.id, r.screening_result, r.parsed_name, r.parsed_phone, r.parsed_email, r.campaign_id, r.ats_candidate_id, r.parsed_location,
              r.requisition_id AS req_id, c.campaign_name, jr.id AS jr_id, jr.branch_name, jr.designation_name, jr.meta_screening_config,
              ac.current_address, ac.permanent_address, bm.city AS branch_city, bm.state AS branch_state
         FROM meta_lead_raw r
         LEFT JOIN meta_campaign c ON c.id = r.campaign_id
         LEFT JOIN job_requisition jr ON jr.id = r.requisition_id
         LEFT JOIN branch_master bm ON bm.branch_name = jr.branch_name AND bm.active_status = 1
         LEFT JOIN ats_candidate ac ON ac.id = r.ats_candidate_id
        WHERE r.id = ? LIMIT 1`, [metaLeadId]);
    const r = rows[0];
    if (!r) return { status: "invalid" };
    if (r.screening_result !== "qualified") return { status: "not_qualified" };
    if (!r.req_id || !r.jr_id) return { status: "invalid" };
    const heldReason = o.skipOutreach ? "skip_outreach" : parseCfg(r.meta_screening_config)?.auto_notify === false ? "auto_notify_off" : null;
    const res = await enqueueQualifiedFollowup({
      sourceType: "meta_live", // the ingest hook is the live path; campaign status must not reclassify it
      metaLeadId, requisitionId: r.req_id, campaignId: r.campaign_id ?? null, atsCandidateId: r.ats_candidate_id ?? null,
      originId: String(r.campaign_id ?? ""), originLabel: String(r.campaign_name ?? ""),
      phone: r.parsed_phone, email: r.parsed_email, fullName: r.parsed_name,
      branchName: r.branch_name ?? null, roleName: r.designation_name ?? null, heldReason,
      location: { text: [r.parsed_location, r.current_address, r.permanent_address].filter(Boolean).join(" ") || null, branchName: r.branch_name ?? null, branchCity: r.branch_city ?? null, branchState: r.branch_state ?? null },
    }, sw);
    return res.id ? { status: res.status, id: res.id } : { status: res.status };
  } catch (err) {
    logger.warn({ metaLeadId, err: (err as Error).message }, "[qualified-followup] meta enqueue failed");
    return { status: "invalid" };
  }
}

/**
 * People lined up on a drive (Old Meta re-runs, the pool, streams) are enrolled as pipeline-owned journeys with their booking linked;
 * the line-up already applied the eligibility gate. A person already enrolled for the requisition gets the match linked (no hand-over:
 * the engine no longer sends to enrolled people). Never throws; a source that is off makes no database call.
 */
export async function enqueueMatchedFollowups(
  drive: MatchedDriveRef, leadIds: string[], stream: FollowupStreamRef | null = null, s?: FollowupSwitches,
): Promise<{ enqueued: number; promoted: number; exists: number; linked: number }> {
  const out = { enqueued: 0, promoted: 0, exists: 0, linked: 0 };
  if (!leadIds.length) return out;
  try {
    const kind = (["pool", "meta", "campaign", "batch"] as const).find((k) => k === drive.sourceKind) ?? null;
    const sourceType: SourceType = stream ? stream.sourceType : classifySource({ launchSourceKind: kind });
    const sw = s ?? (await loadFollowupSwitches());
    const tag = enrolTag(sw, sourceType, drive.requisitionId);
    if (!tag) return out;
    if (requisitionOpenReason(await loadRequisitionFacts(drive.requisitionId))) return out;
    // Branch and role of the requisition: the journey is booked at that branch and the messages name the role.
    const [jr] = await db.execute<RowDataPacket[]>("SELECT branch_name, designation_name FROM job_requisition WHERE id = ? LIMIT 1", [drive.requisitionId]);
    const branchName = jr[0]?.branch_name ?? null, roleName = jr[0]?.designation_name ?? null;
    const originId = stream ? stream.originId : sourceType === "he" ? "pool" : drive.id;
    const originLabel = stream ? stream.originLabel : sourceType === "he" ? "Pool: ATS history" : drive.runLabel ?? `Re-run ${drive.driveDate}`;
    for (let i = 0; i < leadIds.length; i += 500) {
      const chunk = leadIds.slice(i, i + 500);
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT l.id, l.mobile10, l.full_name, l.email, l.ats_candidate_id, l.meta_lead_id, m.id AS match_id
           FROM he_lead l LEFT JOIN he_match m ON m.lead_id = l.id AND m.requisition_id = ?
          WHERE l.id IN (${chunk.map(() => "?").join(",")})`, [drive.requisitionId, ...chunk]);
      for (const r of rows) {
        const mobile10 = normaliseMobile10(String(r.mobile10 ?? ""));
        if (!mobile10) continue;
        const res = await enrol({
          sourceType, originId, originLabel, phone: mobile10, email: r.email ?? null, fullName: r.full_name ?? null,
          heLeadId: String(r.id), metaLeadId: r.meta_lead_id ?? null, atsCandidateId: r.ats_candidate_id ?? null,
          requisitionId: drive.requisitionId, driveId: drive.id, matchId: r.match_id ?? null, eligibilityChecked: true, branchName, roleName,
        }, tag, mobile10);
        if (res.status === "enqueued") out.enqueued++;
        else if (res.status === "promoted") out.promoted++;
        else if (res.status === "exists") out.exists++;
        if (res.linked) out.linked++;
      }
    }
  } catch (err) {
    logger.warn({ driveId: drive.id, err: String((err as Error).message).replace(/\d{6,}/g, "#"), ...out }, "[qualified-followup] matched enqueue failed");
  }
  return out;
}

/** HR releases a held_manual journey: enrolled, due times from now. */
export async function releaseHeldManual(followupId: string, actor: string): Promise<boolean> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT email, he_lead_id FROM qualified_followup WHERE id = ? LIMIT 1", [followupId]);
  if (!r[0]) return false;
  const due = dueTimes({ enrolledAt: new Date(), hasEmail: Boolean(String(r[0].email ?? "").trim()) });
  const [u] = await db.execute<ResultSetHeader>(
    "UPDATE qualified_followup SET journey_state = 'enrolled', held_reason = NULL, email_due_at = ?, wa_due_at = ? WHERE id = ? AND journey_state = 'held_manual' AND stopped_reason IS NULL",
    [due.emailDueAt, due.waDueAt, followupId]);
  const ok = Number(u?.affectedRows ?? 0) > 0;
  if (ok && r[0].he_lead_id) await addEvent(String(r[0].he_lead_id), "followup_released", { detail: "held_manual -> enrolled", actor });
  return ok;
}

export async function followupSummary(): Promise<Array<{ sourceType: SourceType; total: number; stopped: number; open: number }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT source_type, COUNT(*) AS total, SUM(stopped_reason IS NOT NULL) AS stopped, SUM(stopped_reason IS NULL) AS open_n
       FROM qualified_followup GROUP BY source_type`);
  return rows.map((x) => ({ sourceType: x.source_type as SourceType, total: Number(x.total), stopped: Number(x.stopped ?? 0), open: Number(x.open_n ?? 0) }));
}

/**
 * True when a live, still-open follow-up row exists for this Meta lead, or for the same mobile10 and requisition. Errors are rethrown:
 * the caller decides whether to fail closed (live mode) or open.
 */
export async function followupEnrolled(metaLeadId: string): Promise<boolean> {
  return liveRowFor(metaLeadId, true);
}

/** True when a live / canary row (open or already stopped) owns this lead's person and requisition. dry_run/test rows do not. Errors are rethrown. */
export async function followupHasLiveRow(metaLeadId: string): Promise<boolean> {
  return liveRowFor(metaLeadId, false);
}

async function liveRowFor(metaLeadId: string, openOnly: boolean): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS hit
       FROM meta_lead_raw r
       LEFT JOIN meta_campaign c ON c.id = r.campaign_id
      WHERE r.id = ?
        AND EXISTS (SELECT 1 FROM qualified_followup qf
                     WHERE qf.mode_at_enqueue IN ('live','canary')${openOnly ? " AND qf.stopped_reason IS NULL" : ""}
                       AND (qf.meta_lead_id = r.id COLLATE utf8mb4_unicode_ci
                            OR (qf.mobile10 = RIGHT(REGEXP_REPLACE(r.parsed_phone, '[^0-9]', ''), 10) COLLATE utf8mb4_unicode_ci
                                AND qf.requisition_id = COALESCE(r.requisition_id, c.requisition_id) COLLATE utf8mb4_unicode_ci)))
      LIMIT 1`, [metaLeadId]);
  return rows.length > 0;
}

/** STOP: the person's Hiring Engine lead is opted out, their WhatsApp contact consent is revoked with no active grant, or an opt-out is held on followup_person. */
export async function personOptedOut(mobile10: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS hit FROM he_lead l
      WHERE l.mobile10 = ? AND (l.status = 'opted_out'
        OR (EXISTS (SELECT 1 FROM he_consent k WHERE k.lead_id = l.id AND k.consent_type = 'whatsapp_contact' AND k.revoked_at IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM he_consent k2 WHERE k2.lead_id = l.id AND k2.consent_type = 'whatsapp_contact' AND k2.revoked_at IS NULL)))
     UNION ALL
     -- STOP from any channel is also held per person, even when the person has no Hiring Engine record
     SELECT 1 AS hit FROM followup_person fp WHERE fp.mobile10 = ? AND fp.opted_out_at IS NOT NULL
      LIMIT 1`, [mobile10, mobile10]);
  return rows.length > 0;
}
