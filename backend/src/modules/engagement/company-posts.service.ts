import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { Role, normalizeRoleInputs } from "../../platform/policy/roles.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type {
  CompanyPostCreatorAccessRowDTO,
  CreatorAccessGrantInput,
  CreatorAccessRevokeInput,
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

const MODERATION_ROLES = new Set(
  normalizeRoleInputs([Role.HR_ADMIN, Role.ADMIN, Role.SUPER_ADMIN]),
);

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

export async function listCompanyPostCreators(): Promise<CompanyPostCreatorAccessRowDTO[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, user_id, active_status, granted_by, granted_at,
            revoked_by, revoked_at, created_at, updated_at
       FROM company_post_creator_access
      WHERE active_status = 1
      ORDER BY granted_at DESC`,
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
    `SELECT id, employee_id, user_id, active_status, granted_by, granted_at,
            revoked_by, revoked_at, created_at, updated_at
       FROM company_post_creator_access
      WHERE employee_id = ?
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
    `SELECT id, employee_id, user_id, active_status, granted_by, granted_at,
            revoked_by, revoked_at, created_at, updated_at
       FROM company_post_creator_access
      WHERE employee_id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] as CompanyPostCreatorAccessRowDTO;
}
