import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { TPZ_UPLOAD_TYPES, companyForInboundKey, companyForPerformancePath, tpzCompany, type TpzCapability } from "./tpz-access.catalog.js";
import { canTpz, hasAnyTpzAccess, type TpzAccess } from "./tpz-access.resolver.js";
import { getTpzAccess } from "./tpz-access.service.js";

/**
 * TPZ Process access gates.
 *
 * Mounted in app.ts in front of the routers that serve TPZ data. A request for a path the catalogue does not know is passed
 * through untouched (not even authenticated here -- the router does that, as before). For a TPZ path the gate does two things:
 *   1. DENIES (403) when the user has no right to that process / capability -- this is what narrows a role-based user an
 *      admin has restricted, and what stops a granted user from reaching a process they were not granted.
 *   2. For a user the route's own role list would reject, but who holds a matching grant, sets `req.tpzBypass` so requireRole
 *      lets THIS request through. The flag is only ever set here, only after the grant check above, and for dashboards only on
 *      GET/HEAD -- a grant can read a dashboard, it can never reach a write endpoint guarded by a role list.
 */

export interface TpzRequestState {
  tpzBypass?: boolean;
  /** Set on uploader list endpoints for a narrowed / grant-only user: the TPZ upload types that user may / may not use. */
  tpzUploadFilter?: { allow: Set<string>; deny: Set<string>; grantOnly: boolean };
}
export type TpzRequest = AuthenticatedRequest & TpzRequestState;

const forbidden = (res: Response, message: string) => res.status(403).json({ success: false, message });

async function rolesOf(req: AuthenticatedRequest): Promise<string[]> {
  if (req.authUser.roles && req.authUser.roles.length > 0) return req.authUser.roles;
  if (req.authUser.isDemo) return [req.authUser.role || "employee"];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`, [req.authUser.id]);
    return rows.map((r) => String(r.role_key));
  } catch {
    return req.authUser.role ? [req.authUser.role] : [];
  }
}

export async function accessOf(req: AuthenticatedRequest): Promise<TpzAccess> {
  return getTpzAccess(req.authUser.id, await rolesOf(req));
}

async function decide(req: TpzRequest, res: Response, next: NextFunction, company: string, capability: TpzCapability): Promise<unknown> {
  const access = await accessOf(req);
  if (!canTpz(access, company, capability)) {
    return forbidden(res, `You don't have ${capability === "upload" ? "uploader" : capability === "mis" ? "MIS" : "dashboard"} access to ${tpzCompany(company)?.label ?? company} in TPZ Process.`);
  }
  if (req.method === "GET" || req.method === "HEAD") req.tpzBypass = true;
  return next();
}

/**
 * A gate that does nothing (not even authenticate) for a request the catalogue does not govern, so every other request on
 * these prefixes costs exactly what it did before. For a governed request it authenticates first -- the same requireAuth the
 * routers use -- and then decides.
 */
const gate = (
  isRelevant: (req: AuthenticatedRequest) => boolean,
  handle: (req: TpzRequest, res: Response, next: NextFunction) => Promise<unknown>,
) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!isRelevant(req)) return next();
  void requireAuth(req, res, (authErr?: unknown) => {
    if (authErr) return next(authErr);
    handle(req as TpzRequest, res, next).catch((err) => {
      // Fail closed: an unexpected error must not open a TPZ path up.
      console.error("[tpz-access] gate error:", err instanceof Error ? err.message : String(err));
      forbidden(res, "TPZ access could not be verified. Please try again.");
    });
  });
};

/** /api/process-performance/* -- dashboards and MIS downloads. */
export const tpzPerformanceGate = gate(
  (req) => req.path === "/dashboard-export/excel" || req.path === "/mis/companies" || companyForPerformancePath(req.path) !== null,
  async (req, res, next) => {
    // dashboard-export renders rows the page already holds into a workbook; it reads no TPZ data itself. Anyone who can open
    // any TPZ dashboard may use it; for everyone else it stays behind its own role list.
    if (req.path === "/dashboard-export/excel") {
      const access = await accessOf(req);
      if (hasAnyTpzAccess(access) && !access.roleFullView) req.tpzBypass = true;
      return next();
    }
    // The company directory used by the MIS page: served to anyone with MIS rights somewhere.
    if (req.path === "/mis/companies") {
      const access = await accessOf(req);
      const any = access.roleFullView || Object.values(access.companies).some((c) => c.mis);
      if (!any) return forbidden(res, "You don't have MIS access in TPZ Process.");
      req.tpzBypass = true;
      return next();
    }
    const hit = companyForPerformancePath(req.path);
    if (!hit) return next();
    return decide(req, res, next, hit.company, hit.capability);
  },
);

/** /api/inbound-insights/:key/* */
const insightsCompany = (req: AuthenticatedRequest): string | null => companyForInboundKey(req.path.split("/").filter(Boolean)[0] ?? "");
export const tpzInsightsGate = gate(
  (req) => insightsCompany(req) !== null,
  async (req, res, next) => decide(req, res, next, insightsCompany(req) as string, "dashboards"),
);

/** /api/inbound/project/:key/* (the summary / project-list endpoints stay role-only). */
const inboundProjectCompany = (req: AuthenticatedRequest): string | null => {
  const parts = req.path.split("/").filter(Boolean);
  return parts[0] === "project" && parts[1] ? companyForInboundKey(parts[1]) : null;
};
export const tpzInboundProjectGate = gate(
  (req) => inboundProjectCompany(req) !== null,
  async (req, res, next) => decide(req, res, next, inboundProjectCompany(req) as string, "dashboards"),
);

/* ------------------------------------ uploaders ------------------------------------ */

function uploadFilterFor(access: TpzAccess): NonNullable<TpzRequestState["tpzUploadFilter"]> {
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const [code, info] of TPZ_UPLOAD_TYPES) (canTpz(access, info.company, "upload") ? allow : deny).add(code);
  return { allow, deny, grantOnly: !access.uploadRoleAdmitted };
}

const BATCH_OP = /^\/batches\/([0-9a-fA-F-]{8,64})(?:\/(rows|import|import-status))?$/;

function uploadShape(req: AuthenticatedRequest) {
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path;
  const method = req.method.toUpperCase();
  return {
    isTemplates: method === "GET" && path === "/templates",
    isStats: method === "GET" && path === "/process-performance-v2-stats",
    isList: method === "GET" && (path === "/batches" || path === "/coverage"),
    isCreate: method === "POST" && path === "/batches",
    batchOp: BATCH_OP.exec(path),
  };
}

interface BatchLookup extends RowDataPacket { upload_type_code: string; uploaded_by: string | null }

/**
 * /api/bulk-upload/* -- the uploaders. A user whose ROLE already admits them to bulk upload keeps exactly what they have, except
 * that an admin can narrow them: TPZ upload types they were not granted are hidden and refused. A user with no such role can
 * use only the TPZ upload types they were granted, only on batches they created, and only with the import function that
 * belongs to the batch's own type.
 */
export const tpzUploadGate = gate(
  (req) => {
    const u = uploadShape(req);
    return u.isTemplates || u.isStats || u.isList || u.isCreate || u.batchOp !== null;
  },
  async (req, res, next) => {
    const { isTemplates, isStats, isList, isCreate, batchOp } = uploadShape(req);
    const access = await accessOf(req);
    const filter = uploadFilterFor(access);
    const userId = req.authUser.id;

    // Nothing to enforce for a role-admitted user with no narrowing: leave the request completely alone.
    if (access.uploadRoleAdmitted && filter.deny.size === 0) return next();
    // A user with neither the role nor any upload grant: the route's own role guard answers (403), as before.
    if (!access.uploadRoleAdmitted && filter.allow.size === 0) return next();

    if (isTemplates || isStats || isList) {
      req.tpzUploadFilter = filter;
      if (filter.grantOnly) req.tpzBypass = true;
      return next();
    }

    if (isCreate) {
      const code = String((req.body as { upload_type_code?: unknown } | undefined)?.upload_type_code ?? "");
      const info = TPZ_UPLOAD_TYPES.get(code);
      if (!info) {
        // Not a TPZ upload type: untouched for a role-admitted user, refused for a grant-only one.
        if (filter.grantOnly) return forbidden(res, "Your TPZ access covers only the uploaders you were granted.");
        return next();
      }
      if (!canTpz(access, info.company, "upload")) return forbidden(res, `You don't have uploader access to ${tpzCompany(info.company)?.label ?? info.company} in TPZ Process.`);
      if (filter.grantOnly) req.tpzBypass = true;
      return next();
    }

    // /batches/:id[/rows|/import|/import-status]
    const [rows] = await db.execute<BatchLookup[]>(`SELECT upload_type_code, uploaded_by FROM upload_batch WHERE id = ? LIMIT 1`, [batchOp![1]]);
    const batch = rows[0];
    if (!batch) return next(); // the route answers 404
    const info = TPZ_UPLOAD_TYPES.get(String(batch.upload_type_code));
    if (!info) {
      if (filter.grantOnly) return forbidden(res, "Your TPZ access covers only the uploaders you were granted.");
      return next();
    }
    if (!canTpz(access, info.company, "upload")) return forbidden(res, `You don't have uploader access to ${tpzCompany(info.company)?.label ?? info.company} in TPZ Process.`);
    if (filter.grantOnly) {
      if (String(batch.uploaded_by ?? "") !== userId) return forbidden(res, "You can only work with batches you uploaded yourself.");
      if (batchOp![2] === "import") {
        const rpc = String((req.body as { rpc_name?: unknown } | undefined)?.rpc_name ?? "");
        if (rpc !== info.rpc) return forbidden(res, "That import function does not belong to this upload type.");
      }
      req.tpzBypass = true;
    }
    return next();
  },
);

/** True when the request's TPZ upload filter (if any) lets this upload type through. */
export function tpzAllowsUploadType(req: AuthenticatedRequest, code: string): boolean {
  const f = (req as TpzRequest).tpzUploadFilter;
  if (!f) return true;
  return f.grantOnly ? f.allow.has(code) : !f.deny.has(code);
}

/** The MIS company keys this request's user may see (all of them for a full-access role). */
export async function tpzMisAllowed(req: AuthenticatedRequest, keys: string[]): Promise<string[]> {
  const access = await accessOf(req);
  return keys.filter((k) => canTpz(access, k, "mis"));
}
