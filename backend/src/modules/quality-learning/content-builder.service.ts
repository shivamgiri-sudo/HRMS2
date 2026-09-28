/**
 * quality-learning/content-builder.service.ts
 *
 * "MCN Content Builder" — Option A tooling-link tracking for OpenMAIC
 * (github.com/THU-MAIC/OpenMAIC) as a standalone external content-authoring tool.
 *
 * See backend/sql/1825_mcn_content_builder_request.sql for the full rationale. Short
 * version: this module NEVER calls out to OpenMAIC and NEVER writes to mcn_lms. It is a
 * worklist — a coordinator requests content, builds it in OpenMAIC (a separate app, run
 * separately), pastes back an informational link/note, then after manually uploading the
 * export into the LMS and creating the real skill_content_mapping row, links that mapping
 * back here to close the loop. builder_url is free text and is never fetched or validated
 * against a real host from this backend.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

export type ContentBuilderStatus = "requested" | "in_progress" | "built" | "mapped" | "cancelled";

export interface ContentBuilderRequestRow extends RowDataPacket {
  id: string;
  skill_category_id: string;
  requested_by: string;
  status: ContentBuilderStatus;
  brief: string | null;
  builder_url: string | null;
  export_reference: string | null;
  resulting_content_mapping_id: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
}

const ACTIVE_STATUSES: ContentBuilderStatus[] = ["requested", "in_progress", "built"];

/** A coordinator asking for content to be authored for a skill category. */
export async function createContentBuilderRequest(params: {
  skillCategoryId: string;
  requestedBy: string;
  brief?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO mcn_content_builder_request (id, skill_category_id, requested_by, status, brief)
     VALUES (?, ?, ?, 'requested', ?)`,
    [id, params.skillCategoryId, params.requestedBy, params.brief ?? null]
  );
  return id;
}

/** Full worklist, newest first. Optionally scoped to a single skill category. */
export async function listContentBuilderRequests(skillCategoryId?: string): Promise<ContentBuilderRequestRow[]> {
  const where = skillCategoryId ? "WHERE r.skill_category_id = ?" : "";
  const params = skillCategoryId ? [skillCategoryId] : [];
  const [rows] = await db.execute<ContentBuilderRequestRow[]>(
    `SELECT r.*, sc.category_name, COALESCE(e.full_name, au.email) AS requested_by_name
       FROM mcn_content_builder_request r
       JOIN skill_category sc ON sc.id = r.skill_category_id
       LEFT JOIN auth_user au ON au.id = r.requested_by
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
       ${where}
      ORDER BY r.created_at DESC`,
    params
  );
  return rows;
}

/** Requests still open (not mapped or cancelled) — the coordinator's active worklist. */
export async function listActiveContentBuilderRequests(): Promise<ContentBuilderRequestRow[]> {
  const [rows] = await db.execute<ContentBuilderRequestRow[]>(
    `SELECT r.*, sc.category_name, COALESCE(e.full_name, au.email) AS requested_by_name
       FROM mcn_content_builder_request r
       JOIN skill_category sc ON sc.id = r.skill_category_id
       LEFT JOIN auth_user au ON au.id = r.requested_by
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
      WHERE r.status IN (?, ?, ?)
      ORDER BY r.created_at ASC`,
    ACTIVE_STATUSES
  );
  return rows;
}

async function assertOpen(id: string): Promise<ContentBuilderRequestRow> {
  const [rows] = await db.execute<ContentBuilderRequestRow[]>(
    `SELECT * FROM mcn_content_builder_request WHERE id = ?`,
    [id]
  );
  const row = rows[0];
  if (!row) {
    throw Object.assign(new Error("Content builder request not found"), { statusCode: 404 });
  }
  if (row.status === "mapped" || row.status === "cancelled") {
    throw Object.assign(
      new Error(`Request is already ${row.status} and cannot be modified`),
      { statusCode: 409 }
    );
  }
  return row;
}

/** Coordinator marking they've started building the content in OpenMAIC. */
export async function markContentBuilderInProgress(id: string): Promise<void> {
  await assertOpen(id);
  await db.execute(
    `UPDATE mcn_content_builder_request SET status = 'in_progress', updated_at = NOW() WHERE id = ?`,
    [id]
  );
}

/**
 * Coordinator pasting back the informational OpenMAIC link/export note once content has
 * been generated there. Purely a status/note update — nothing is fetched or verified.
 */
export async function markContentBuilderBuilt(params: {
  id: string;
  builderUrl?: string | null;
  exportReference?: string | null;
}): Promise<void> {
  await assertOpen(params.id);
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE mcn_content_builder_request
        SET status = 'built',
            builder_url = COALESCE(?, builder_url),
            export_reference = COALESCE(?, export_reference),
            updated_at = NOW()
      WHERE id = ?`,
    [params.builderUrl ?? null, params.exportReference ?? null, params.id]
  );
  if (result.affectedRows === 0) {
    throw Object.assign(new Error("Content builder request not found"), { statusCode: 404 });
  }
}

/**
 * Closes the loop: links this request to the real skill_content_mapping row the
 * coordinator created after manually uploading the export into the LMS. Requires the
 * mapping to already exist and belong to the same skill category — this never creates
 * the mapping itself, that stays the existing /content-mappings admin flow.
 */
export async function markContentBuilderMapped(params: {
  id: string;
  contentMappingId: string;
}): Promise<void> {
  const request = await assertOpen(params.id);

  const [mappingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, skill_category_id FROM skill_content_mapping WHERE id = ?`,
    [params.contentMappingId]
  );
  const mapping = mappingRows[0];
  if (!mapping) {
    throw Object.assign(new Error("Content mapping not found"), { statusCode: 404 });
  }
  if (mapping.skill_category_id !== request.skill_category_id) {
    throw Object.assign(
      new Error("Content mapping belongs to a different skill category than this request"),
      { statusCode: 400 }
    );
  }

  await db.execute(
    `UPDATE mcn_content_builder_request
        SET status = 'mapped', resulting_content_mapping_id = ?, updated_at = NOW()
      WHERE id = ?`,
    [params.contentMappingId, params.id]
  );
}

/** Abandoning a request — a normal end-state, not an error. */
export async function cancelContentBuilderRequest(id: string, reason?: string | null): Promise<void> {
  await assertOpen(id);
  await db.execute(
    `UPDATE mcn_content_builder_request
        SET status = 'cancelled', cancelled_reason = ?, updated_at = NOW()
      WHERE id = ?`,
    [reason ?? null, id]
  );
}
