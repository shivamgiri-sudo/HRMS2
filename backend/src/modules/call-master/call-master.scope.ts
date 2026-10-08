import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { inboundProjectAllowed, resolveProcessScope } from "../dashboards/process-scope-guards.js";
import { getInboundProjects } from "./inbound-projects.js";

/**
 * Call Master client scoping (owner ruling 2026-10-01).
 *
 * The call-master data is keyed by dialler client id, not by branch. A client belongs to a process through the
 * inbound project registry (static catalogue + admin-registered process_inbound_config), and a process belongs to
 * a branch. So a non-org-wide caller (manager, process_manager, operations_manager, qa, quality_analyst ...) is
 * limited to the clients of projects whose process is inside their branch / assigned scope.
 *
 * `allowedClientIds` returns null for org-wide callers (nothing is narrowed). A client the registry cannot place
 * is hidden from everyone who is not org-wide (fail closed).
 */
export async function allowedClientIds(userId: string): Promise<number[] | null> {
  const scope = await resolveProcessScope(userId);
  if (scope.orgWide) return null;
  const projects = await getInboundProjects({ includeDbOnly: true });
  const ids = new Set<number>();
  for (const p of projects) {
    if (!inboundProjectAllowed(scope, p)) continue;
    for (const raw of [p.clientId, p.fcrClientId]) {
      const n = Number(raw);
      if (raw !== undefined && raw !== null && raw !== "" && Number.isFinite(n)) ids.add(n);
    }
  }
  return [...ids];
}

/** The ids a request may use: the caller's own pick (?clientIds=) narrowed to what the server allows; [-1] matches nothing. */
export function narrowClientIds(requested: number[] | undefined, allowed: number[]): number[] {
  const effective = requested && requested.length > 0 ? requested.filter((id) => allowed.includes(id)) : allowed;
  return effective.length > 0 ? effective : [-1];
}

/**
 * Router-level middleware: rewrites ?clientIds= to the intersection with the caller's allowed clients, so every
 * handler that reads it through parseFilters is scoped without being touched. Org-wide callers pass untouched.
 */
export async function scopeClientIdsMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as AuthenticatedRequest).authUser?.id;
    if (!userId) return res.status(403).json({ success: false, message: "Forbidden: no resolvable scope" });
    const allowed = await allowedClientIds(userId);
    res.locals.allowedClientIds = allowed;
    if (allowed === null) return next();
    const raw = req.query.clientIds;
    const requested = raw
      ? String(raw).split(",").map(Number).filter((n) => !Number.isNaN(n))
      : undefined;
    req.query.clientIds = narrowClientIds(requested, allowed).join(",");
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Single-client dashboards (?clientId=): a scoped caller may only name a client inside their scope, and when they
 * name none the dashboard is pinned to their only allowed client (several allowed clients -> they must choose one).
 * `listPaths` are the client-picker endpoints, which stay reachable and are filtered via res.locals.allowedClientIds;
 * `exemptPaths` carry no client data (config / master lists) and are left alone. Non-GET requests pass untouched
 * (they are role-gated configuration writes, not data reads).
 */
export function requireClientInScope(opts: { listPaths?: string[]; exemptPaths?: string[] } = {}) {
  const listPaths = opts.listPaths ?? [];
  const exemptPaths = opts.exemptPaths ?? [];
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.method !== "GET" || exemptPaths.includes(req.path)) return next();
      const userId = (req as AuthenticatedRequest).authUser?.id;
      if (!userId) return res.status(403).json({ success: false, message: "Forbidden: no resolvable scope" });
      const allowed = await allowedClientIds(userId);
      res.locals.allowedClientIds = allowed;
      if (allowed === null) return next();
      const requested = typeof req.query.clientId === "string" ? req.query.clientId.trim() : "";
      if (requested) {
        if (!allowed.includes(Number(requested))) {
          return res.status(403).json({ success: false, message: "Forbidden: this client is outside your branch / assigned scope" });
        }
        return next();
      }
      if (listPaths.includes(req.path)) return next();
      if (allowed.length === 1) {
        req.query.clientId = String(allowed[0]);
        return next();
      }
      return res.status(403).json({ success: false, message: "Choose a client inside your branch / assigned scope" });
    } catch (err) {
      return next(err);
    }
  };
}
