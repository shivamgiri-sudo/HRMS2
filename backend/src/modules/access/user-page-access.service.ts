import { db } from "../../db/mysql.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

interface PageAccessPermissions {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

interface UserPageAccess extends PageAccessPermissions {
  user_id: string;
  page_code: string;
  assigned_by: string;
  assigned_at: Date;
  notes?: string;
}

interface PageCatalogEntry {
  page_code: string;
  page_name: string;
  page_path?: string;
  module?: string;
  description?: string;
}

/**
 * Get all pages in the system (from page_catalog)
 */
export async function listPageCatalog(): Promise<PageCatalogEntry[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT page_code, page_name, page_path, module, description
     FROM page_catalog
     WHERE active_status = 1
     ORDER BY module, page_name`
  );
  return rows as PageCatalogEntry[];
}

/**
 * Get all users with their email for assignment UI
 */
export async function listUsersForAccess(): Promise<Array<{ id: string; email: string }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, email FROM users WHERE active_status = 1 ORDER BY email`
  );
  return rows as Array<{ id: string; email: string }>;
}

/**
 * Get user's direct page access assignments (user_page_access only)
 */
export async function getUserPageAccess(userId: string): Promise<UserPageAccess[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      user_id, page_code, can_view, can_create, can_edit, can_delete, can_export,
      assigned_by, assigned_at, notes
     FROM user_page_access
     WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  return rows as UserPageAccess[];
}

/**
 * Get user's effective page access (role-based + user overrides)
 * User overrides take precedence over role-based access
 */
export async function getUserEffectivePageAccess(userId: string): Promise<Array<PageAccessPermissions & { page_code: string; source: 'user' | 'role' }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      COALESCE(upa.page_code, rpa.page_code) AS page_code,
      COALESCE(upa.can_view, rpa.can_view, 0) AS can_view,
      COALESCE(upa.can_create, rpa.can_create, 0) AS can_create,
      COALESCE(upa.can_edit, rpa.can_edit, 0) AS can_edit,
      COALESCE(upa.can_delete, rpa.can_delete, 0) AS can_delete,
      COALESCE(upa.can_export, rpa.can_export, 0) AS can_export,
      CASE WHEN upa.id IS NOT NULL THEN 'user' ELSE 'role' END AS source
     FROM user_roles ur
     LEFT JOIN role_page_access rpa ON rpa.role_key = ur.role_key AND rpa.active_status = 1
     LEFT JOIN user_page_access upa ON upa.user_id = ur.user_id AND upa.page_code = rpa.page_code AND upa.active_status = 1
     WHERE ur.user_id = ? AND ur.active_status = 1

     UNION

     SELECT
      page_code, can_view, can_create, can_edit, can_delete, can_export, 'user' AS source
     FROM user_page_access
     WHERE user_id = ? AND active_status = 1
       AND page_code NOT IN (
         SELECT DISTINCT rpa.page_code
         FROM user_roles ur
         JOIN role_page_access rpa ON rpa.role_key = ur.role_key
         WHERE ur.user_id = ? AND ur.active_status = 1 AND rpa.active_status = 1
       )

     ORDER BY page_code`,
    [userId, userId, userId]
  );
  return rows as Array<PageAccessPermissions & { page_code: string; source: 'user' | 'role' }>;
}

/**
 * Assign page access to a user (admin only)
 */
export async function assignUserPageAccess(
  userId: string,
  pageCode: string,
  permissions: PageAccessPermissions,
  assignedBy: string,
  notes?: string
): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Check if assignment already exists
    const [existing] = await conn.execute<RowDataPacket[]>(
      `SELECT id, can_view, can_create, can_edit, can_delete, can_export
       FROM user_page_access
       WHERE user_id = ? AND page_code = ?`,
      [userId, pageCode]
    );

    if (existing.length > 0) {
      // Update existing assignment
      const old = existing[0];
      await conn.execute(
        `UPDATE user_page_access
         SET can_view = ?, can_create = ?, can_edit = ?, can_delete = ?, can_export = ?,
             active_status = 1, assigned_by = ?, assigned_at = NOW(), notes = ?
         WHERE user_id = ? AND page_code = ?`,
        [
          permissions.can_view ? 1 : 0,
          permissions.can_create ? 1 : 0,
          permissions.can_edit ? 1 : 0,
          permissions.can_delete ? 1 : 0,
          permissions.can_export ? 1 : 0,
          assignedBy,
          notes || null,
          userId,
          pageCode
        ]
      );

      // Audit trail
      await conn.execute(
        `INSERT INTO user_page_access_audit (user_id, page_code, action, actor_user_id, old_permissions, new_permissions, notes)
         VALUES (?, ?, 'MODIFY', ?, ?, ?, ?)`,
        [
          userId,
          pageCode,
          assignedBy,
          JSON.stringify({ can_view: old.can_view, can_create: old.can_create, can_edit: old.can_edit, can_delete: old.can_delete, can_export: old.can_export }),
          JSON.stringify(permissions),
          notes || null
        ]
      );
    } else {
      // Insert new assignment
      await conn.execute(
        `INSERT INTO user_page_access (user_id, page_code, can_view, can_create, can_edit, can_delete, can_export, assigned_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          pageCode,
          permissions.can_view ? 1 : 0,
          permissions.can_create ? 1 : 0,
          permissions.can_edit ? 1 : 0,
          permissions.can_delete ? 1 : 0,
          permissions.can_export ? 1 : 0,
          assignedBy,
          notes || null
        ]
      );

      // Audit trail
      await conn.execute(
        `INSERT INTO user_page_access_audit (user_id, page_code, action, actor_user_id, new_permissions, notes)
         VALUES (?, ?, 'ASSIGN', ?, ?, ?)`,
        [userId, pageCode, assignedBy, JSON.stringify(permissions), notes || null]
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Revoke user's page access (admin only)
 */
export async function revokeUserPageAccess(
  userId: string,
  pageCode: string,
  revokedBy: string,
  notes?: string
): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Get current permissions for audit
    const [existing] = await conn.execute<RowDataPacket[]>(
      `SELECT can_view, can_create, can_edit, can_delete, can_export
       FROM user_page_access
       WHERE user_id = ? AND page_code = ? AND active_status = 1`,
      [userId, pageCode]
    );

    if (existing.length === 0) {
      throw new Error("Page access assignment not found");
    }

    // Soft delete
    await conn.execute(
      `UPDATE user_page_access
       SET active_status = 0, revoked_by = ?, revoked_at = NOW()
       WHERE user_id = ? AND page_code = ?`,
      [revokedBy, userId, pageCode]
    );

    // Audit trail
    await conn.execute(
      `INSERT INTO user_page_access_audit (user_id, page_code, action, actor_user_id, old_permissions, notes)
       VALUES (?, ?, 'REVOKE', ?, ?, ?)`,
      [userId, pageCode, revokedBy, JSON.stringify(existing[0]), notes || null]
    );

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Bulk assign multiple pages to a user (admin only)
 */
export async function bulkAssignUserPageAccess(
  userId: string,
  assignments: Array<{ page_code: string; permissions: PageAccessPermissions }>,
  assignedBy: string,
  notes?: string
): Promise<void> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const assignment of assignments) {
      await assignUserPageAccess(userId, assignment.page_code, assignment.permissions, assignedBy, notes);
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Get audit log for page access assignments
 */
export async function getUserPageAccessAuditLog(userId?: string, pageCode?: string, limit = 100): Promise<any[]> {
  let query = `
    SELECT
      upa.id, upa.user_id, u.email AS user_email,
      upa.page_code, pc.page_name,
      upa.action, upa.actor_user_id, actor.email AS actor_email,
      upa.old_permissions, upa.new_permissions, upa.notes, upa.created_at
    FROM user_page_access_audit upa
    LEFT JOIN users u ON u.id = upa.user_id
    LEFT JOIN users actor ON actor.id = upa.actor_user_id
    LEFT JOIN page_catalog pc ON pc.page_code = upa.page_code
    WHERE 1=1
  `;
  const params: any[] = [];

  if (userId) {
    query += ` AND upa.user_id = ?`;
    params.push(userId);
  }

  if (pageCode) {
    query += ` AND upa.page_code = ?`;
    params.push(pageCode);
  }

  query += ` ORDER BY upa.created_at DESC LIMIT ?`;
  params.push(limit);

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  return rows;
}

/**
 * Get all user page access assignments (for admin UI)
 */
export async function listAllUserPageAccess(): Promise<any[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
      upa.user_id, u.email AS user_email,
      upa.page_code, pc.page_name, pc.module,
      upa.can_view, upa.can_create, upa.can_edit, upa.can_delete, upa.can_export,
      upa.assigned_by, admin.email AS assigned_by_email,
      upa.assigned_at, upa.notes
     FROM user_page_access upa
     LEFT JOIN users u ON u.id = upa.user_id
     LEFT JOIN users admin ON admin.id = upa.assigned_by
     LEFT JOIN page_catalog pc ON pc.page_code = upa.page_code
     WHERE upa.active_status = 1
     ORDER BY u.email, pc.module, pc.page_name`
  );
  return rows;
}
