import type { RowDataPacket } from "mysql2";
import type { NextFunction, Response } from "express";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import { expandRoles, normalizeRoleInputs } from "../platform/policy/index.js";
import type { RoleKey } from "../platform/policy/index.js";

export function requireRole(...allowedRoles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.authUser?.id) {
        return res.status(401).json({ success: false, message: "Unauthenticated" });
      }

      const normalizedAllowed = normalizeRoleInputs(allowedRoles);

      // Demo bypass: resolve roles from req.authUser.role (set by DEMO_TOKEN_MAP)
      // instead of querying the DB. This allows mock-token-{role} to correctly
      // exercise role-based access control in tests / demo mode.
      if (req.authUser.isDemo && process.env.INTERNAL_DEMO_BYPASS === "true" && process.env.NODE_ENV !== "production") {
        const demoRole = (req.authUser.role || "employee") as RoleKey;
        const userRoles: RoleKey[] = [demoRole];
        // Super_admin bypass still applies for the dedicated super-admin token
        if (userRoles.includes("super_admin")) {
          (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
          return next();
        }
        const expandedUserRoles = expandRoles(userRoles);
        const expandedAllowed   = expandRoles(normalizedAllowed);
        if (expandedAllowed.some((role) => expandedUserRoles.includes(role))) {
          (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
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

      const userRoles = (rows as { role_key: string }[]).map((r) => r.role_key as RoleKey);
      if (userRoles.includes("super_admin")) {
        (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
        return next();
      }

      // Expand both sides with aliases so manager↔process_manager are interchangeable
      const expandedUserRoles = expandRoles(userRoles);
      const expandedAllowed   = expandRoles(normalizedAllowed);
      const allowed = expandedAllowed.some((role) => expandedUserRoles.includes(role));

      if (!allowed) {
        console.warn(`[requireRole] Denied: user role(s) [${userRoles.join(',')}] tried route requiring [${allowedRoles.join(',')}]`);
        return res.status(403).json({ success: false, message: "Access denied. Required: " + allowedRoles.join(" or ") });
      }

      (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
