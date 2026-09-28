import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { TPZ_COMPANIES, isTpzCompanyKey } from "./tpz-access.catalog.js";
import { resolveTpzAccess, type TpzAccess, type TpzGrantRow } from "./tpz-access.resolver.js";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: TpzAccess }>();

export function invalidateTpzAccessCache(userId?: string): void {
  if (userId) cache.delete(userId); else cache.clear();
}

const isMissingTable = (err: unknown): boolean => {
  const code = String((err as { code?: unknown })?.code ?? "");
  return code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_TABLE_ERROR";
};

interface GrantDbRow extends RowDataPacket {
  id: string; scope_type: "all" | "company" | "branch"; company_key: string | null; branch_id: string | null;
  can_dashboards: number; can_upload: number; can_mis: number;
}

/** branch_id -> TPZ company keys whose process_master row is in that branch. */
export async function loadBranchCompanies(branchIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (branchIds.length === 0) return out;
  const codeToKey = new Map<string, string>();
  for (const c of TPZ_COMPANIES) for (const code of c.processCodes) codeToKey.set(code, c.key);
  const codes = [...codeToKey.keys()];
  if (codes.length === 0) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_code FROM process_master
      WHERE active_status = 1 AND branch_id IN (${branchIds.map(() => "?").join(",")}) AND process_code IN (${codes.map(() => "?").join(",")})`,
    [...branchIds, ...codes],
  );
  for (const r of rows) {
    const key = codeToKey.get(String(r.process_code));
    if (!key) continue;
    const list = out.get(String(r.branch_id)) ?? [];
    if (!list.includes(key)) list.push(key);
    out.set(String(r.branch_id), list);
  }
  return out;
}

/**
 * The user's effective TPZ access. Never throws: if the grant tables are not there yet (migration 1782 not applied) or the
 * lookup fails, the user is treated as having no grants and no restriction -- i.e. role-based access exactly as before.
 */
export async function getTpzAccess(userId: string, roles: readonly string[]): Promise<TpzAccess> {
  const key = `${userId}|${[...roles].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let restrict = false;
  let grants: TpzGrantRow[] = [];
  let branchCompanies = new Map<string, string[]>();
  try {
    const [flagRows] = await db.execute<RowDataPacket[]>(
      `SELECT restrict_to_grants FROM tpz_user_access WHERE user_id = ? AND active_status = 1 LIMIT 1`, [userId],
    );
    restrict = Number(flagRows[0]?.restrict_to_grants ?? 0) === 1;
    const [rows] = await db.execute<GrantDbRow[]>(
      `SELECT id, scope_type, company_key, branch_id, can_dashboards, can_upload, can_mis
         FROM tpz_access_grant WHERE user_id = ? AND active_status = 1`, [userId],
    );
    grants = rows.map((r) => ({
      scope_type: r.scope_type, company_key: r.company_key, branch_id: r.branch_id,
      can_dashboards: Number(r.can_dashboards) === 1, can_upload: Number(r.can_upload) === 1, can_mis: Number(r.can_mis) === 1,
    }));
    branchCompanies = await loadBranchCompanies([...new Set(grants.filter((g) => g.scope_type === "branch" && g.branch_id).map((g) => g.branch_id as string))]);
  } catch (err) {
    if (!isMissingTable(err)) console.error("[tpz-access] grant lookup failed -- falling back to role-based access:", err instanceof Error ? err.message : String(err));
    restrict = false; grants = []; branchCompanies = new Map();
  }
  const value = resolveTpzAccess({ roles, restrict, grants, branchCompanies });
  cache.set(key, { at: Date.now(), value });
  return value;
}

/* ------------------------------- admin side ------------------------------- */

export interface TpzGrantInput {
  scope_type: "all" | "company" | "branch";
  company_key?: string | null;
  branch_id?: string | null;
  can_dashboards?: boolean;
  can_upload?: boolean;
  can_mis?: boolean;
}

export interface TpzUserAccessView {
  user_id: string;
  restrict_to_grants: boolean;
  notes: string | null;
  grants: Array<{
    id: string; scope_type: "all" | "company" | "branch"; company_key: string | null; branch_id: string | null; branch_name: string | null;
    can_dashboards: boolean; can_upload: boolean; can_mis: boolean;
  }>;
}

export async function getUserTpzAccessView(userId: string): Promise<TpzUserAccessView> {
  let restrict = false;
  let notes: string | null = null;
  let grants: TpzUserAccessView["grants"] = [];
  try {
    const [flags] = await db.execute<RowDataPacket[]>(`SELECT restrict_to_grants, notes FROM tpz_user_access WHERE user_id = ? AND active_status = 1 LIMIT 1`, [userId]);
    restrict = Number(flags[0]?.restrict_to_grants ?? 0) === 1;
    notes = flags[0]?.notes ?? null;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT g.id, g.scope_type, g.company_key, g.branch_id, b.branch_name, g.can_dashboards, g.can_upload, g.can_mis
         FROM tpz_access_grant g LEFT JOIN branch_master b ON b.id = g.branch_id
        WHERE g.user_id = ? AND g.active_status = 1 ORDER BY g.scope_type, g.company_key, b.branch_name`, [userId],
    );
    grants = rows.map((r) => ({
      id: String(r.id), scope_type: r.scope_type, company_key: r.company_key ?? null, branch_id: r.branch_id ?? null, branch_name: r.branch_name ?? null,
      can_dashboards: Number(r.can_dashboards) === 1, can_upload: Number(r.can_upload) === 1, can_mis: Number(r.can_mis) === 1,
    }));
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  return { user_id: userId, restrict_to_grants: restrict, notes, grants };
}

/** Validates the grant list an admin submits. Returns an error message, or null when it is acceptable. */
export async function validateGrantInputs(grants: TpzGrantInput[]): Promise<string | null> {
  const seen = new Set<string>();
  const branchIds: string[] = [];
  for (const g of grants) {
    if (g.scope_type !== "all" && g.scope_type !== "company" && g.scope_type !== "branch") return "scope_type must be all, company or branch";
    if (g.scope_type === "company" && !(g.company_key && isTpzCompanyKey(g.company_key))) return `Unknown TPZ process '${g.company_key ?? ""}'`;
    if (g.scope_type === "branch" && !g.branch_id) return "branch_id is required for a branch grant";
    if (!g.can_dashboards && !g.can_upload && !g.can_mis) return "Every grant must allow at least one of dashboards, uploader or MIS";
    const key = g.scope_type === "all" ? "all" : g.scope_type === "company" ? `company:${g.company_key}` : `branch:${g.branch_id}`;
    if (seen.has(key)) return `Duplicate grant for ${key}`;
    seen.add(key);
    if (g.scope_type === "branch" && g.branch_id) branchIds.push(g.branch_id);
  }
  if (branchIds.length > 0) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM branch_master WHERE id IN (${branchIds.map(() => "?").join(",")})`, branchIds,
    );
    const found = new Set(rows.map((r) => String(r.id)));
    const missing = branchIds.find((b) => !found.has(b));
    if (missing) return `Unknown branch '${missing}'`;
  }
  return null;
}

/**
 * Replaces a user's whole TPZ setup (flag + grants) in ONE transaction, so a half-saved set can never widen or narrow access.
 * Audited with the before/after.
 */
export async function replaceUserTpzAccess(params: {
  userId: string; restrictToGrants: boolean; notes: string | null; grants: TpzGrantInput[]; actorId: string; req?: import("express").Request;
}): Promise<TpzUserAccessView> {
  const before = await getUserTpzAccessView(params.userId);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO tpz_user_access (user_id, restrict_to_grants, notes, active_status, created_by, updated_by)
       VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE restrict_to_grants = VALUES(restrict_to_grants), notes = VALUES(notes), active_status = 1, updated_by = VALUES(updated_by)`,
      [params.userId, params.restrictToGrants ? 1 : 0, params.notes, params.actorId, params.actorId],
    );
    await conn.execute(`DELETE FROM tpz_access_grant WHERE user_id = ?`, [params.userId]);
    for (const g of params.grants) {
      const scopeKey = g.scope_type === "all" ? "all" : g.scope_type === "company" ? `company:${g.company_key}` : `branch:${g.branch_id}`;
      await conn.execute(
        `INSERT INTO tpz_access_grant (id, user_id, scope_type, company_key, branch_id, scope_key, can_dashboards, can_upload, can_mis, active_status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [randomUUID(), params.userId, g.scope_type, g.scope_type === "company" ? g.company_key : null, g.scope_type === "branch" ? g.branch_id : null,
          scopeKey, g.can_dashboards ? 1 : 0, g.can_upload ? 1 : 0, g.can_mis ? 1 : 0, params.actorId],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
  invalidateTpzAccessCache();
  const after = await getUserTpzAccessView(params.userId);
  await logSensitiveAction({
    actor_user_id: params.actorId, action_type: "TPZ_ACCESS_UPDATED", module_key: "tpz_access", entity_type: "user", entity_id: params.userId,
    old_value_json: before as unknown as Record<string, unknown>, new_value_json: after as unknown as Record<string, unknown>, req: params.req,
  });
  return after;
}
