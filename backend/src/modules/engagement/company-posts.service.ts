import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { Role, normalizeRoleInputs } from "../../platform/policy/roles.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type {
  CompanyPostDTO,
  CompanyPostCreatorAccessRowDTO,
  CompanyPostListResult,
  CompanyPostMediaDTO,
  CompanyPostModerationState,
  CompanyPostStatus,
  CreateCompanyPostInput,
  CreatorAccessGrantInput,
  CreatorAccessRevokeInput,
  ModerateCompanyPostInput,
} from "./company-posts.types.js";

type GrantInput = CreatorAccessGrantInput & {
  actorUserId: string;
  employeeId?: string;
  userId?: string;
};

type RevokeInput = CreatorAccessRevokeInput & {
  actorUserId: string;
  employeeId?: string;
};

type CreatePostInput = CreateCompanyPostInput & {
  actorUserId: string;
};

type ListMyCompanyPostsInput = {
  actorUserId: string;
  page?: number;
  limit?: number;
};

type ListCompanyPostApprovalsInput = {
  actorUserId: string;
  page?: number;
  limit?: number;
};

type DeleteCompanyPostInput = {
  postId: string;
  actorUserId: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
};

type ModerationActionInput = {
  ipAddress?: string;
  userAgent?: string;
};

type ModerationEvaluation = {
  moderationState: CompanyPostModerationState;
  status: CompanyPostStatus;
  reason: string | null;
};

type CompanyPostRow = Omit<CompanyPostDTO, "media" | "active_status"> & {
  active_status: number | boolean;
  author_name: string | null;
  author_code: string | null;
  approved_by_name: string | null;
  rejected_by_name: string | null;
};

type CompanyPostMediaRow = CompanyPostMediaDTO & RowDataPacket;

const MODERATION_ROLES = new Set(
  normalizeRoleInputs([Role.ADMIN, Role.SUPER_ADMIN, "hr_head"]),
);
const MODERATION_QUEUE_STATUSES = new Set<CompanyPostStatus>([
  "pending_approval",
  "borderline_flagged",
]);
const VIOLATION_TERMS = ["nude", "porn", "xxx", "viagra", "escort"];
const BORDERLINE_TERMS = [
  "investment scheme",
  "click here now",
  "free money",
  "limited offer",
  "guaranteed return",
];

type QueryExecutor = {
  execute<T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[]>(
    sql: string,
    params?: unknown[],
  ): Promise<[T, unknown[]]>;
};

type TransactionConnection = QueryExecutor & {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
};

function canonicalRole(role: unknown): string {
  return String(role ?? "").trim().replace(/[\s-]+/g, "_").toLowerCase();
}

function inputEmployeeId(input: { employeeId?: string; employee_id?: string }): string {
  return input.employeeId ?? input.employee_id ?? "";
}

async function userHasRole(userId: string, allowedRoles: Set<string>): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key
       FROM user_roles
      WHERE user_id = ? AND active_status = 1`,
    [userId],
  );

  const normalizedRoles = normalizeRoleInputs(
    (rows as Array<{ role_key?: unknown }>).map((row) => canonicalRole(row.role_key)),
  );
  return normalizedRoles.some((role) => allowedRoles.has(canonicalRole(role)));
}

async function hasActiveCreatorAccess(userId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1
       FROM company_post_creator_access
      WHERE user_id = ? AND active_status = 1
      LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

export async function assertCanCreateCompanyPost(userId: string): Promise<void> {
  if (!(await hasActiveCreatorAccess(userId))) {
    throw new Error("Company post creator access is required");
  }
}

export async function assertCanModerateCompanyPosts(userId: string): Promise<void> {
  if (!(await userHasRole(userId, MODERATION_ROLES))) {
    throw new Error("Access denied: company post moderation requires an authorized role");
  }
}

async function assertCanManageCreators(userId: string): Promise<void> {
  if (!(await userHasRole(userId, new Set([canonicalRole(Role.SUPER_ADMIN)])))) {
    throw new Error("Only a super administrator can manage company post creators");
  }
}

function mapCompanyPostRow(row: CompanyPostRow, media: CompanyPostMediaDTO[]): CompanyPostDTO {
  return {
    ...row,
    active_status: Boolean(row.active_status),
    media,
  };
}

function normalizeActorUserId(input: {
  actorUserId?: string;
  actor_user_id?: string;
}): string {
  return input.actorUserId ?? input.actor_user_id ?? "";
}

function evaluateCompanyPostModeration(input: {
  contentText?: string | null;
  mediaCount: number;
}): ModerationEvaluation {
  const text = String(input.contentText ?? "").trim().toLowerCase();

  if (VIOLATION_TERMS.some((term) => text.includes(term))) {
    return {
      moderationState: "violation",
      status: "auto_rejected",
      reason: "Policy-violating content detected",
    };
  }

  if (BORDERLINE_TERMS.some((term) => text.includes(term))) {
    return {
      moderationState: "borderline",
      status: "borderline_flagged",
      reason: "Borderline or spam-like content requires review",
    };
  }

  return {
    moderationState: "clean",
    status: "pending_approval",
    reason: null,
  };
}

async function resolveEmployeeIdForUser(userId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM employees
      WHERE user_id = ? AND active_status = 1
      LIMIT 1`,
    [userId],
  );

  const employeeId = String(rows[0]?.id ?? "");
  if (!employeeId) {
    throw new Error("Active employee mapping not found for company post author");
  }
  return employeeId;
}

async function loadCompanyPostMedia(postIds: string[]): Promise<Map<string, CompanyPostMediaDTO[]>> {
  if (postIds.length === 0) return new Map();

  const placeholders = postIds.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, post_id, file_id, media_type, sort_order,
            moderation_state, moderation_reason
       FROM company_post_media
      WHERE post_id IN (${placeholders}) AND active_status = 1
      ORDER BY post_id ASC, sort_order ASC`,
    postIds,
  );

  const mediaMap = new Map<string, CompanyPostMediaDTO[]>();
  for (const row of rows as CompanyPostMediaRow[]) {
    const current = mediaMap.get(String((row as { post_id?: unknown }).post_id ?? "")) ?? [];
    current.push({
      id: row.id,
      file_id: row.file_id,
      media_type: row.media_type,
      sort_order: row.sort_order,
      moderation_state: row.moderation_state,
      moderation_reason: row.moderation_reason ?? null,
    });
    mediaMap.set(String((row as { post_id?: unknown }).post_id ?? ""), current);
  }

  return mediaMap;
}

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

async function listCompanyPosts(
  whereClause: string,
  params: unknown[],
  paginationOpts: { page?: number; limit?: number } = {},
  executor: QueryExecutor = db,
): Promise<CompanyPostListResult> {
  const page = Math.max(1, paginationOpts.page ?? 1);
  const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, paginationOpts.limit ?? DEFAULT_PAGE_LIMIT));
  const offset = (page - 1) * limit;

  const [countRows] = await executor.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM company_posts WHERE ${whereClause}`,
    params,
  );
  const total = Number((countRows[0] as { total?: unknown })?.total ?? 0);

  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT cp.id, cp.author_user_id, cp.author_employee_id,
            e.full_name AS author_name, e.employee_code AS author_code,
            cp.content_text, cp.status,
            cp.moderation_state, cp.moderation_score, cp.auto_reject_reason, cp.review_notes,
            cp.submitted_at, cp.approved_at, cp.approved_by,
            ea.full_name AS approved_by_name,
            cp.rejected_at, cp.rejected_by,
            er.full_name AS rejected_by_name,
            cp.rejection_reason, cp.deleted_at, cp.deleted_by, cp.active_status,
            cp.created_at, cp.updated_at
       FROM company_posts cp
       LEFT JOIN employees e  ON e.id  = cp.author_employee_id
       LEFT JOIN employees ea ON ea.user_id = cp.approved_by
       LEFT JOIN employees er ON er.user_id = cp.rejected_by
      WHERE ${whereClause}
      ORDER BY cp.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const postRows = rows as CompanyPostRow[];
  const mediaMap = await loadCompanyPostMedia(postRows.map((row) => row.id));
  const posts = postRows.map((row) => mapCompanyPostRow(row, mediaMap.get(row.id) ?? []));
  return { posts, total, page, limit };
}

async function getCompanyPostById(postId: string, executor: QueryExecutor = db): Promise<CompanyPostDTO> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT id, author_user_id, author_employee_id, content_text, status,
            moderation_state, moderation_score, auto_reject_reason, review_notes,
            submitted_at, approved_at, approved_by, rejected_at, rejected_by,
            rejection_reason, deleted_at, deleted_by, active_status,
            created_at, updated_at
       FROM company_posts
      WHERE id = ?
      LIMIT 1`,
    [postId],
  );

  if (rows.length === 0) {
    throw new Error("Company post not found");
  }

  const postRow = rows[0] as CompanyPostRow;
  const mediaMap = await loadCompanyPostMedia([postRow.id]);
  return mapCompanyPostRow(postRow, mediaMap.get(postRow.id) ?? []);
}

async function auditCompanyPostAction(
  executor: QueryExecutor,
  input: {
    actorUserId: string;
    actionType:
      | "COMPANY_FEED_POST_APPROVED"
      | "COMPANY_FEED_POST_REJECTED"
      | "COMPANY_FEED_POST_DELETED"
      | "COMPANY_FEED_POST_AUTO_REJECTED";
    postId: string;
    changeSummary: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  await executor.execute(
    `INSERT INTO sensitive_action_log
       (id, actor_user_id, action_type, module_key, entity_type, entity_id,
        ip_address, user_agent, change_summary, request_id,
        actor_role, reason, old_value_json, new_value_json, employee_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.actorUserId,
      input.actionType,
      "engagement",
      "company_post",
      input.postId,
      input.ipAddress ?? null,
      input.userAgent ? String(input.userAgent).slice(0, 512) : null,
      JSON.stringify(input.changeSummary),
      null,
      null,
      null,
      null,
      null,
      null,
    ],
  );
}

function assertQueuedModerationTransition(status: CompanyPostStatus, action: "approve" | "reject"): void {
  const verb = action === "approve" ? "approved" : "rejected";
  if (!MODERATION_QUEUE_STATUSES.has(status)) {
    throw new Error(
      `Only queued company posts can be ${verb}; current status is ${status}`,
    );
  }
}

async function withCompanyPostTransaction<T>(
  callback: (connection: TransactionConnection) => Promise<T>,
): Promise<T> {
  const connection = (await db.getConnection()) as TransactionConnection;
  await connection.beginTransaction();

  try {
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createCompanyPost(input: CreatePostInput): Promise<CompanyPostDTO> {
  await assertCanCreateCompanyPost(input.actorUserId);

  const authorEmployeeId = await resolveEmployeeIdForUser(input.actorUserId);
  const contentText = input.content_text?.trim() || null;
  const media = [...(input.media ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const moderation = evaluateCompanyPostModeration({
    contentText,
    mediaCount: media.length,
  });
  const postId = randomUUID();

  await withCompanyPostTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO company_posts
        (id, author_user_id, author_employee_id, content_text, status, moderation_state,
         moderation_score, auto_reject_reason, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        postId,
        input.actorUserId,
        authorEmployeeId,
        contentText,
        moderation.status,
        moderation.moderationState,
        null,
        moderation.reason,
      ],
    );

    for (const item of media) {
      await connection.execute(
        `INSERT INTO company_post_media
          (id, post_id, file_id, media_type, sort_order, moderation_state, moderation_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          postId,
          item.file_id,
          item.media_type,
          item.sort_order,
          moderation.moderationState,
          moderation.reason,
        ],
      );
    }

    if (moderation.status === "auto_rejected") {
      await auditCompanyPostAction(connection, {
        actorUserId: input.actorUserId,
        actionType: "COMPANY_FEED_POST_AUTO_REJECTED",
        postId,
        changeSummary: {
          status: moderation.status,
          moderation_state: moderation.moderationState,
          reason: moderation.reason,
        },
      });
    }
  });

  return getCompanyPostById(postId);
}

export async function listApprovedCompanyFeed(
  opts: { page?: number; limit?: number } = {},
): Promise<CompanyPostListResult> {
  return listCompanyPosts(`cp.status = 'approved' AND cp.active_status = 1`, [], opts);
}

export async function listMyCompanyPosts(input: ListMyCompanyPostsInput): Promise<CompanyPostListResult> {
  await assertCanCreateCompanyPost(input.actorUserId);
  return listCompanyPosts(
    `cp.author_user_id = ? AND cp.active_status = 1 AND cp.status <> 'deleted'`,
    [input.actorUserId],
    { page: input.page, limit: input.limit },
  );
}

export async function listCompanyPostApprovals(
  input: ListCompanyPostApprovalsInput,
): Promise<CompanyPostListResult> {
  await assertCanModerateCompanyPosts(input.actorUserId);
  return listCompanyPosts(
    `cp.status IN ('pending_approval', 'borderline_flagged') AND cp.active_status = 1`,
    [],
    { page: input.page, limit: input.limit },
  );
}

export async function listCompanyPostManagement(
  input: ListCompanyPostApprovalsInput,
): Promise<CompanyPostListResult> {
  await assertCanModerateCompanyPosts(input.actorUserId);
  return listCompanyPosts(
    `cp.status <> 'deleted' AND cp.active_status = 1`,
    [],
    { page: input.page, limit: input.limit },
  );
}

export async function approveCompanyPost(
  input: ModerateCompanyPostInput & ModerationActionInput,
): Promise<CompanyPostDTO> {
  const actorUserId = normalizeActorUserId(input);
  await assertCanModerateCompanyPosts(actorUserId);

  await withCompanyPostTransaction(async (connection) => {
    const current = await getCompanyPostById(input.post_id, connection);
    assertQueuedModerationTransition(current.status, "approve");

    const [approveResult] = await connection.execute<ResultSetHeader>(
      `UPDATE company_posts
          SET status = 'approved',
              moderation_state = 'manual_override_approved',
              approved_at = NOW(),
              approved_by = ?,
              rejected_at = NULL,
              rejected_by = NULL,
              rejection_reason = NULL,
              review_notes = ?
        WHERE id = ? AND status IN ('pending_approval', 'borderline_flagged')`,
      [actorUserId, input.review_notes ?? null, input.post_id],
    );

    if (approveResult.affectedRows === 0) {
      throw new Error("Company post approval failed because the queued state changed");
    }

    await auditCompanyPostAction(connection, {
      actorUserId,
      actionType: "COMPANY_FEED_POST_APPROVED",
      postId: input.post_id,
      changeSummary: {
        previous_status: current.status,
        status: "approved",
        review_notes: input.review_notes ?? null,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  });

  return getCompanyPostById(input.post_id);
}

export async function rejectCompanyPost(
  input: ModerateCompanyPostInput & ModerationActionInput,
): Promise<CompanyPostDTO> {
  const actorUserId = normalizeActorUserId(input);
  await assertCanModerateCompanyPosts(actorUserId);

  await withCompanyPostTransaction(async (connection) => {
    const current = await getCompanyPostById(input.post_id, connection);
    assertQueuedModerationTransition(current.status, "reject");

    const [rejectResult] = await connection.execute<ResultSetHeader>(
      `UPDATE company_posts
          SET status = 'rejected',
              moderation_state = 'manual_override_rejected',
              rejected_at = NOW(),
              rejected_by = ?,
              rejection_reason = ?,
              review_notes = ?
        WHERE id = ? AND status IN ('pending_approval', 'borderline_flagged')`,
      [
        actorUserId,
        input.reason ?? "Rejected by moderator",
        input.review_notes ?? null,
        input.post_id,
      ],
    );

    if (rejectResult.affectedRows === 0) {
      throw new Error("Company post rejection failed because the queued state changed");
    }

    await auditCompanyPostAction(connection, {
      actorUserId,
      actionType: "COMPANY_FEED_POST_REJECTED",
      postId: input.post_id,
      changeSummary: {
        previous_status: current.status,
        status: "rejected",
        reason: input.reason ?? "Rejected by moderator",
        review_notes: input.review_notes ?? null,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  });

  return getCompanyPostById(input.post_id);
}

export async function deleteCompanyPost(input: DeleteCompanyPostInput): Promise<void> {
  await assertCanModerateCompanyPosts(input.actorUserId);

  await withCompanyPostTransaction(async (connection) => {
    const current = await getCompanyPostById(input.postId, connection);
    if (current.status === "deleted") {
      throw new Error("Company post is already deleted");
    }

    const [deleteResult] = await connection.execute<ResultSetHeader>(
      `UPDATE company_posts
          SET status = 'deleted',
              deleted_at = NOW(),
              deleted_by = ?,
              review_notes = COALESCE(?, review_notes)
        WHERE id = ? AND status = ? AND active_status = 1`,
      [input.actorUserId, input.reason ?? null, input.postId, current.status],
    );

    if (deleteResult.affectedRows === 0) {
      throw new Error("Company post deletion failed because the record changed");
    }

    await auditCompanyPostAction(connection, {
      actorUserId: input.actorUserId,
      actionType: "COMPANY_FEED_POST_DELETED",
      postId: input.postId,
      changeSummary: {
        previous_status: current.status,
        status: "deleted",
        reason: input.reason ?? null,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  });
}

export async function listCompanyPostCreators(input: { actorUserId: string }): Promise<CompanyPostCreatorAccessRowDTO[]> {
  await assertCanManageCreators(input.actorUserId);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cpa.id, cpa.employee_id, cpa.user_id, cpa.active_status,
            cpa.granted_by, cpa.granted_at, cpa.revoked_by, cpa.revoked_at,
            cpa.created_at, cpa.updated_at,
            e.full_name AS employee_name, e.employee_code, e.department
       FROM company_post_creator_access cpa
       LEFT JOIN employees e ON e.id = cpa.employee_id
      WHERE cpa.active_status = 1
      ORDER BY cpa.granted_at DESC`,
  );
  return rows as CompanyPostCreatorAccessRowDTO[];
}

export async function grantCompanyPostCreator(input: GrantInput): Promise<CompanyPostCreatorAccessRowDTO> {
  await assertCanManageCreators(input.actorUserId);

  const employeeId = inputEmployeeId(input);
  const targetUserId = input.userId ?? input.user_id;
  let resolvedUserId = targetUserId;

  if (!resolvedUserId) {
    const [employeeRows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id
         FROM employees
        WHERE id = ? AND active_status = 1
        LIMIT 1`,
      [employeeId],
    );
    resolvedUserId = String(employeeRows[0]?.user_id ?? "");
  }

  if (!resolvedUserId) throw new Error("Active employee user mapping not found");

  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM company_post_creator_access
      WHERE employee_id = ?
      LIMIT 1`,
    [employeeId],
  );

  if (existingRows.length > 0) {
    await db.execute(
      `UPDATE company_post_creator_access
          SET user_id = ?, active_status = 1, granted_by = ?, granted_at = NOW(),
              revoked_by = NULL, revoked_at = NULL
        WHERE employee_id = ?`,
      [resolvedUserId, input.actorUserId, employeeId],
    );
  } else {
    await db.execute(
      `INSERT INTO company_post_creator_access
        (id, employee_id, user_id, active_status, granted_by, granted_at)
       VALUES (?, ?, ?, 1, ?, NOW())`,
      [randomUUID(), employeeId, resolvedUserId, input.actorUserId],
    );
  }

  await logSensitiveAction({
    actor_user_id: input.actorUserId,
    action_type: "COMPANY_FEED_CREATOR_GRANTED",
    module_key: "engagement",
    entity_type: "company_post_creator_access",
    entity_id: employeeId,
    change_summary: { employee_id: employeeId, user_id: resolvedUserId },
  });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cpa.id, cpa.employee_id, cpa.user_id, cpa.active_status,
            cpa.granted_by, cpa.granted_at, cpa.revoked_by, cpa.revoked_at,
            cpa.created_at, cpa.updated_at,
            e.full_name AS employee_name, e.employee_code, e.department
       FROM company_post_creator_access cpa
       LEFT JOIN employees e ON e.id = cpa.employee_id
      WHERE cpa.employee_id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] as CompanyPostCreatorAccessRowDTO;
}

export async function revokeCompanyPostCreator(input: RevokeInput): Promise<CompanyPostCreatorAccessRowDTO> {
  await assertCanManageCreators(input.actorUserId);
  const employeeId = inputEmployeeId(input);

  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE company_post_creator_access
        SET active_status = 0, revoked_by = ?, revoked_at = NOW()
      WHERE employee_id = ? AND active_status = 1`,
    [input.actorUserId, employeeId],
  );

  if (result.affectedRows === 0) {
    throw new Error("No active company post creator access found");
  }

  await logSensitiveAction({
    actor_user_id: input.actorUserId,
    action_type: "COMPANY_FEED_CREATOR_REVOKED",
    module_key: "engagement",
    entity_type: "company_post_creator_access",
    entity_id: employeeId,
    change_summary: { employee_id: employeeId, active_status: 0 },
  });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cpa.id, cpa.employee_id, cpa.user_id, cpa.active_status,
            cpa.granted_by, cpa.granted_at, cpa.revoked_by, cpa.revoked_at,
            cpa.created_at, cpa.updated_at,
            e.full_name AS employee_name, e.employee_code, e.department
       FROM company_post_creator_access cpa
       LEFT JOIN employees e ON e.id = cpa.employee_id
      WHERE cpa.employee_id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] as CompanyPostCreatorAccessRowDTO;
}
