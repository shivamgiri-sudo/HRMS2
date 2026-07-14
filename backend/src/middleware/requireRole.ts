import type { RowDataPacket } from "mysql2";
import type { NextFunction, Response } from "express";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "./authMiddleware.js";

/**
 * Role aliases — bidirectional:
 * - "manager" ↔ "process_manager": same authority, different naming conventions across modules.
 *   A route protected with requireRole("manager") accepts users with either role key.
 * - "tl" ↔ "team_leader": legacy short form and canonical form.
 *   Expansion runs on BOTH the allowed list and the user's actual roles so both orderings match.
 */
const ROLE_ALIASES: Record<string, string[]> = {
  "process_manager": ["manager"],
  "manager":         ["process_manager"],
  "team_leader":     ["tl"],
  "tl":              ["team_leader"],
  "wfm":             ["wfm_analyst"],
  "wfm_analyst":     ["wfm"],
};

/** Expand a list of roles to include their known aliases */
function expandRoles(roles: string[]): string[] {
  const expanded = new Set(roles);
  for (const r of roles) {
    (ROLE_ALIASES[r] ?? []).forEach(a => expanded.add(a));
  }
  return Array.from(expanded);
}

export function requireRole(...allowedRoles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.authUser?.id) {
        return res.status(401).json({ success: false, message: "Unauthenticated" });
      }

      // Demo bypass: resolve roles from req.authUser.role (set by DEMO_TOKEN_MAP)
      // instead of querying the DB. This allows mock-token-{role} to correctly
      // exercise role-based access control in tests / demo mode.
      if (req.authUser.isDemo && process.env.INTERNAL_DEMO_BYPASS === "true" && process.env.NODE_ENV !== "production") {
        const demoRole = req.authUser.role || 'employee';
        const userRoles = [demoRole];
        // Super_admin bypass still applies for the dedicated super-admin token
        if (userRoles.includes('super_admin')) {
          (req as AuthenticatedRequest & { userRoles: string[] }).userRoles = userRoles;
          return next();
        }
        const expandedUserRoles = expandRoles(userRoles);
        const expandedAllowed   = expandRoles(allowedRoles);
        if (expandedAllowed.some((role) => expandedUserRoles.includes(role))) {
          (req as AuthenticatedRequest & { userRoles: string[] }).userRoles = userRoles;
          return next();
        }
        return res.status(403).json({ success: false, message: "Access denied. Required: " + allowedRoles.join(" or ") });
      }

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT role_key
           FROM user_roles
          WHERE user_id = ? AND active_status = 1`,
        [req.authUser.id]
      );

      const userRoles = (rows as { role_key: string }[]).map((r) => r.role_key);
      if (userRoles.includes("super_admin")) {
        (req as AuthenticatedRequest & { userRoles: string[] }).userRoles = userRoles;
        return next();
      }

      // Expand both sides with aliases so manager↔process_manager are interchangeable
      const expandedUserRoles = expandRoles(userRoles);
      const expandedAllowed   = expandRoles(allowedRoles);
      const allowed = expandedAllowed.some((role) => expandedUserRoles.includes(role));

      if (!allowed) {
        console.warn(`[requireRole] Denied: user role(s) [${userRoles.join(',')}] tried route requiring [${allowedRoles.join(',')}]`);
        return res.status(403).json({ success: false, message: "Access denied. Required: " + allowedRoles.join(" or ") });
      }

      (req as AuthenticatedRequest & { userRoles: string[] }).userRoles = userRoles;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
