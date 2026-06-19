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
        return res.status(403).json({ success: false, message: "Forbidden" });
      }

      (req as AuthenticatedRequest & { userRoles: string[] }).userRoles = userRoles;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
