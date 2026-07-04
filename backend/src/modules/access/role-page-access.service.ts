import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { logSensitiveAction } from "../../shared/auditLog.js";

export interface RolePageRow {
  role_key: string;
  page_code: string;
  page_name: string | null;
  module: string | null;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export interface DesignationRoleRow {
  id: string;
  designation_id: string;
  designation_name: string | null;
  role_key: string;
  active_status: number;
  created_by: string | null;
  created_at: string;
}

export interface AccessRequestRow {
  id: string;
  user_id: string;
  user_email: string | null;
  page_code: string;
  page_name: string | null;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  reviewed_by: string | null;
  reviewer_email: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

// ─── Role → Page access management ───────────────────────────────────────────

export async function listRolePageAccessByRole(roleKey: string): Promise<RolePageRow[]> {
  type DbRow = RowDataPacket & {
    role_key: string;
    page_code: string;
    page_name: string | null;
    module: string | null;
    can_view: number | boolean;
    can_create: number | boolean;
    can_edit: number | boolean;
    can_delete: number | boolean;
    can_export: number | boolean;
  };
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rpa.role_key, rpa.page_code,
            pc.page_name, pc.module,
            rpa.can_view, rpa.can_create, rpa.can_edit, rpa.can_delete, rpa.can_export
     FROM role_page_access rpa
     LEFT JOIN page_catalog pc ON pc.page_code = rpa.page_code
     WHERE rpa.role_key = ? AND rpa.active_status = 1
     ORDER BY pc.module, rpa.page_code`,
    [roleKey]
  );
  return (rows as DbRow[]).map((r) => ({
    role_key:   r.role_key,
    page_code:  r.page_code,
    page_name:  r.page_name,
    module:     r.module,
    can_view:   Boolean(r.can_view),
    can_create: Boolean(r.can_create),
    can_edit:   Boolean(r.can_edit),
    can_delete: Boolean(r.can_delete),
    can_export: Boolean(r.can_export),
  }));
}

export async function upsertRolePageAccess(
  roleKey: string,
  pageCode: string,
  perms: { can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean; can_export: boolean },
  actorId: string
): Promise<void> {
  await db.execute(
    `INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       can_view = VALUES(can_view), can_create = VALUES(can_create),
       can_edit = VALUES(can_edit), can_delete = VALUES(can_delete),
       can_export = VALUES(can_export), active_status = 1`,
    [
      roleKey, pageCode,
      perms.can_view ? 1 : 0,
      perms.can_create ? 1 : 0,
      perms.can_edit ? 1 : 0,
      perms.can_delete ? 1 : 0,
      perms.can_export ? 1 : 0,
    ]
  );
  await logSensitiveAction({
    action_type: "ROLE_PAGE_UPDATED",
    module_key: "access",
    actor_user_id: actorId,
    entity_type: "role_page_access",
    entity_id: `${roleKey}::${pageCode}`,
    change_summary: { role_key: roleKey, page_code: pageCode, permissions: perms },
  });
}

export async function deleteRolePageAccess(
  roleKey: string,
  pageCode: string,
  actorId: string
): Promise<void> {
  await db.execute(
    `UPDATE role_page_access SET active_status = 0
     WHERE role_key = ? AND page_code = ?`,
    [roleKey, pageCode]
  );
  await logSensitiveAction({
    action_type: "ROLE_PAGE_REMOVED",
    module_key: "access",
    actor_user_id: actorId,
    entity_type: "role_page_access",
    entity_id: `${roleKey}::${pageCode}`,
    change_summary: { role_key: roleKey, page_code: pageCode },
  });
}

// ─── Designation → Role map ───────────────────────────────────────────────────

export async function listDesignationRoleMap(): Promise<DesignationRoleRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT drm.id, drm.designation_id,
            dm.designation_name,
            drm.role_key, drm.active_status,
            drm.created_by, drm.created_at
     FROM designation_role_map drm
     LEFT JOIN designation_master dm ON dm.id = drm.designation_id
     WHERE drm.active_status = 1
     ORDER BY dm.designation_name, drm.role_key`
  );
  return rows as DesignationRoleRow[];
}

export async function upsertDesignationRoleMap(
  designationId: string,
  roleKey: string,
  actorId: string
): Promise<void> {
  await db.execute(
    `INSERT INTO designation_role_map (designation_id, role_key, active_status, created_by)
     VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE active_status = 1`,
    [designationId, roleKey, actorId]
  );
  await logSensitiveAction({
    action_type: "DESIGNATION_ROLE_MAPPED",
    module_key: "access",
    actor_user_id: actorId,
    entity_type: "designation_role_map",
    entity_id: `${designationId}::${roleKey}`,
    change_summary: { designation_id: designationId, role_key: roleKey },
  });
}

export async function deleteDesignationRoleMap(id: string, actorId: string): Promise<void> {
  await db.execute(
    `UPDATE designation_role_map SET active_status = 0 WHERE id = ?`,
    [id]
  );
  await logSensitiveAction({
    action_type: "DESIGNATION_ROLE_REMOVED",
    module_key: "access",
    actor_user_id: actorId,
    entity_type: "designation_role_map",
    entity_id: id,
    change_summary: { id },
  });
}

// ─── Access request workflow ──────────────────────────────────────────────────

export async function createAccessRequest(
  userId: string,
  pageCode: string,
  reason: string
): Promise<string> {
  // Prevent duplicate pending requests for the same page
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM access_requests
     WHERE user_id = ? AND page_code = ? AND status = 'pending'`,
    [userId, pageCode]
  );
  if ((existing as RowDataPacket[]).length > 0) {
    return (existing as Array<RowDataPacket & { id: string }>)[0].id;
  }

  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO access_requests (user_id, page_code, reason, status)
     VALUES (?, ?, ?, 'pending')`,
    [userId, pageCode, reason || null]
  );
  // MySQL returns insertId as number for auto-increment but we used UUID default
  // Fetch the newly created row's id
  const [newRow] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM access_requests WHERE user_id = ? AND page_code = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, pageCode]
  );
  return (newRow as Array<RowDataPacket & { id: string }>)[0]?.id ?? "";
}

export async function listAccessRequests(
  status?: "pending" | "approved" | "denied"
): Promise<AccessRequestRow[]> {
  const params: unknown[] = [];
  let where = "WHERE 1=1";
  if (status) {
    where += " AND ar.status = ?";
    params.push(status);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.id, ar.user_id, u.email AS user_email,
            ar.page_code, pc.page_name,
            ar.reason, ar.status,
            ar.reviewed_by, rv.email AS reviewer_email,
            ar.reviewed_at, ar.review_note, ar.created_at
     FROM access_requests ar
     LEFT JOIN auth_user u ON u.id = ar.user_id
     LEFT JOIN page_catalog pc ON pc.page_code = ar.page_code
     LEFT JOIN auth_user rv ON rv.id = ar.reviewed_by
     ${where}
     ORDER BY ar.created_at DESC`,
    params
  );
  return rows as AccessRequestRow[];
}

export async function approveAccessRequest(requestId: string, actorId: string): Promise<void> {
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT user_id, page_code FROM access_requests WHERE id = ? AND status = 'pending'`,
    [requestId]
  );
  if (!(reqRows as RowDataPacket[]).length) {
    throw new Error("Access request not found or already reviewed");
  }
  const { user_id, page_code } = (reqRows as Array<RowDataPacket & { user_id: string; page_code: string }>)[0];

  await db.execute(
    `UPDATE access_requests SET status='approved', reviewed_by=?, reviewed_at=NOW()
     WHERE id = ?`,
    [actorId, requestId]
  );

  // Grant view access as a user-level override
  await db.execute(
    `INSERT INTO user_page_access (user_id, page_code, can_view, can_create, can_edit, can_delete, can_export, assigned_by, notes, active_status)
     VALUES (?, ?, 1, 0, 0, 0, 0, ?, 'Approved via access request', 1)
     ON DUPLICATE KEY UPDATE
       can_view = 1, active_status = 1, assigned_by = VALUES(assigned_by),
       assigned_at = NOW(), notes = VALUES(notes)`,
    [user_id, page_code, actorId]
  );

  await db.execute(
    `INSERT INTO user_page_access_audit (user_id, page_code, action, actor_user_id, new_permissions, notes)
     VALUES (?, ?, 'ASSIGN', ?, ?, ?)`,
    [user_id, page_code, actorId, JSON.stringify({ can_view: true }), `Approved access request ${requestId}`]
  );

  await logSensitiveAction({
    action_type: "ACCESS_REQUEST_APPROVED",
    module_key: "access",
    actor_user_id: actorId,
    entity_type: "access_requests",
    entity_id: requestId,
    change_summary: { user_id, page_code },
  });
}

export async function denyAccessRequest(
  requestId: string,
  actorId: string,
  reviewNote: string
): Promise<void> {
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM access_requests WHERE id = ? AND status = 'pending'`,
    [requestId]
  );
  if (!(reqRows as RowDataPacket[]).length) {
    throw new Error("Access request not found or already reviewed");
  }

  await db.execute(
    `UPDATE access_requests SET status='denied', reviewed_by=?, reviewed_at=NOW(), review_note=?
     WHERE id = ?`,
    [actorId, reviewNote || null, requestId]
  );

  await logSensitiveAction({
    action_type: "ACCESS_REQUEST_DENIED",
    module_key: "access",
    actor_user_id: actorId,
    entity_type: "access_requests",
    entity_id: requestId,
    change_summary: { review_note: reviewNote },
  });
}
