/**
 * LOB-only access to the Bulk Upload Hub.
 *
 * branch_wfm, ho_wfm and wfm_spoc (the Process LOB Mapping roles) may open the Hub to use ONE
 * upload type — Employee LOB Mapping — and nothing else. Every other role keeps exactly the
 * access it has today.
 *
 * WHY THE CHECK READS RAW ROLE KEYS
 * requireRole() runs role inputs through normalizeRoleInputs(), which folds ho_wfm and wfm_spoc
 * into "wfm" (platform/policy/roles.ts LEGACY_ROLE_EQUIVALENTS). So without this module a
 * wfm_spoc/ho_wfm account already passes every requireRole("wfm", ...) list on the Hub router
 * with full wfm reach, and the `req.userRoles` requireRole leaves behind cannot tell it apart
 * from a real wfm user. The restriction therefore looks at the raw keys (`authUser.roles`, the
 * user_roles rows) and treats a caller as "LOB-only" when they hold at least one of the three
 * roles and NOTHING that independently grants full Hub access.
 *
 * A caller who is not LOB-only takes no extra branch and makes no extra query in any guard here,
 * so admin/hr/super_admin/wfm/wfm_analyst/payroll/payroll_hr behave exactly as before.
 */
import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { expandRoles, normalizeRoleInputs } from "../../platform/policy/index.js";

/** Roles that already have the whole Hub (the requireRole list this router carried before). */
export const HUB_FULL_ACCESS_ROLES = [
  "admin", "hr", "super_admin", "wfm", "wfm_analyst", "payroll", "payroll_hr",
] as const;

/** Roles that may use the Hub for Employee LOB Mapping only. */
export const LOB_ONLY_ROLES = ["branch_wfm", "ho_wfm", "wfm_spoc"] as const;

/** Everything a Hub route that LOB-only callers need accepts. */
export const HUB_ROLES: readonly string[] = [...HUB_FULL_ACCESS_ROLES, ...LOB_ONLY_ROLES];

/** upload_type_code of the one type LOB-only callers may touch (== EMPLOYEE_LOB_UPLOAD_TYPE). */
export const LOB_ONLY_UPLOAD_TYPE = "EMPLOYEE_LOB_MAPPING";
/** rpc_name that imports it (== the branch in bulk-dispatch.ts). */
export const LOB_ONLY_IMPORT_RPC = "import_employee_lob_batch";
/** The only file-storage category the Hub uploads into. */
export const LOB_ONLY_FILE_CATEGORY = "bulk-uploads";

const canonical = (role: string): string => role.trim().replace(/[\s-]+/g, "_").toLowerCase();
const isLobOnlyRole = (role: string): boolean => (LOB_ONLY_ROLES as readonly string[]).includes(role);

/**
 * True when the user holds at least one LOB-only role and no role that already grants full Hub
 * access. `userRoles` are RAW role keys (user_roles.role_key), not normalized ones.
 *
 * The LOB-only keys are set aside before the full-access test on purpose: normalization would
 * otherwise turn wfm_spoc/ho_wfm into "wfm" and make every such user look fully privileged.
 * What remains is normalized + alias-expanded exactly as requireRole() does, so branch_hr
 * (-> hr), payroll_admin (-> payroll) and the like still count as full access.
 */
export function isLobOnlyUploader(userRoles: readonly string[] | null | undefined): boolean {
  const roles = (userRoles ?? []).map(canonical).filter(Boolean);
  if (!roles.some(isLobOnlyRole)) return false;
  const others = roles.filter((role) => !isLobOnlyRole(role));
  const effective = expandRoles(normalizeRoleInputs(others));
  return !effective.some((role) => (HUB_FULL_ACCESS_ROLES as readonly string[]).includes(role));
}

/**
 * Raw role keys for the caller. authUser.roles is the cached user_roles list; when it is absent
 * requireRole() looked the roles up itself and left the (normalized) result on req.userRoles.
 * That fallback still identifies branch_wfm; it can only mask ho_wfm/wfm_spoc as "wfm", which is
 * today's behaviour, never a widening of it.
 */
function callerRoles(req: AuthenticatedRequest): readonly string[] {
  const own = req.authUser?.roles;
  if (own && own.length > 0) return own;
  return (req as AuthenticatedRequest & { userRoles?: readonly string[] }).userRoles ?? [];
}

export function isLobOnlyCaller(req: AuthenticatedRequest): boolean {
  return isLobOnlyUploader(callerRoles(req));
}

function forbid(res: Response, message: string) {
  return res.status(403).json({ success: false, error: message, message });
}

const NOT_ALLOWED = "Your role can only use the Employee LOB Mapping upload.";

/** Routes LOB-only callers must never reach (stats, reconcile). */
export function denyLobOnly(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (isLobOnlyCaller(req)) return forbid(res, NOT_ALLOWED);
  return next();
}

/** POST /batches — a LOB-only caller may only create Employee LOB Mapping batches. */
export function restrictLobOnlyBatchCreate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isLobOnlyCaller(req)) return next();
  const type = (req.body as { upload_type_code?: unknown } | undefined)?.upload_type_code;
  if (type !== LOB_ONLY_UPLOAD_TYPE) return forbid(res, NOT_ALLOWED);
  return next();
}

/**
 * Any route that names an existing batch (:id). A LOB-only caller may only touch a batch of the
 * LOB type that they created themselves; a missing batch is refused the same way as a foreign
 * one so existence is not revealed. With `requireImportRpc` the request must also carry the LOB
 * rpc_name, because the import route dispatches on rpc_name rather than on the batch's type.
 */
export function restrictLobOnlyBatchAccess(options: { requireImportRpc?: boolean } = {}) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!isLobOnlyCaller(req)) return next();
      if (options.requireImportRpc) {
        const rpc = (req.body as { rpc_name?: unknown } | undefined)?.rpc_name;
        if (rpc !== LOB_ONLY_IMPORT_RPC) return forbid(res, NOT_ALLOWED);
      }
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT upload_type_code, uploaded_by FROM upload_batch WHERE id = ? LIMIT 1",
        [req.params.id],
      );
      const batch = rows[0];
      const mine = batch && String(batch.uploaded_by ?? "") === String(req.authUser?.id ?? "");
      if (!batch || !mine || batch.upload_type_code !== LOB_ONLY_UPLOAD_TYPE) {
        return forbid(res, NOT_ALLOWED);
      }
      return next();
    } catch (err) {
      return next(err); // fail closed: an unreadable batch is never waved through
    }
  };
}

/** POST /api/files/upload — the Hub's file step; LOB-only callers may only use its own category. */
export function restrictLobOnlyFileCategory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isLobOnlyCaller(req)) return next();
  const category = String(req.query?.category ?? "");
  if (category !== LOB_ONLY_FILE_CATEGORY) return forbid(res, NOT_ALLOWED);
  return next();
}

/** GET /templates — a LOB-only caller sees the Employee LOB Mapping template alone. */
export function filterTemplatesForCaller<T extends object>(
  req: AuthenticatedRequest,
  templates: readonly T[],
): T[] {
  if (!isLobOnlyCaller(req)) return [...templates];
  return templates.filter(
    (t) => (t as { upload_type_code?: unknown }).upload_type_code === LOB_ONLY_UPLOAD_TYPE,
  );
}

/**
 * SQL fragment + params narrowing a upload_batch query to the caller's own LOB batches.
 * Empty for everyone else, so their queries are textually unchanged.
 */
export function lobOnlyBatchFilter(
  req: AuthenticatedRequest,
  alias: string,
): { sql: string; params: unknown[] } {
  if (!isLobOnlyCaller(req)) return { sql: "", params: [] };
  return {
    sql: ` AND ${alias}.upload_type_code = ? AND ${alias}.uploaded_by = ?`,
    params: [LOB_ONLY_UPLOAD_TYPE, req.authUser!.id],
  };
}
