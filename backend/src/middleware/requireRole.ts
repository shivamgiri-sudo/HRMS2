import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { expandRoles, normalizeRoleInputs } from "../platform/policy/index.js";
import type { RoleKey } from "../platform/policy/index.js";
import type { AuthenticatedRequest } from "./authMiddleware.js";

export function requireRole(...allowedRoles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.authUser?.id) {
        return res.status(401).json({ success: false, message: "Unauthenticated" });
      }

      const normalizedAllowedRoles = normalizeRoleInputs(allowedRoles);

      // Demo bypass: resolve roles from req.authUser.role (set by DEMO_TOKEN_MAP)
      // instead of querying the DB. This allows mock-token-{role} to correctly
      // exercise role-based access control in tests / demo mode.
      if (req.authUser.isDemo && process.env.INTERNAL_DEMO_BYPASS === "true" && process.env.NODE_ENV !== "production") {
        const userRoles = normalizeRoleInputs([req.authUser.role || "employee"]);
        if (userRoles.includes("super_admin")) {
          (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
          return next();
        }

        const expandedUserRoles = expandRoles(userRoles);
        const expandedAllowedRoles = expandRoles(normalizedAllowedRoles);
        if (expandedAllowedRoles.some((role) => expandedUserRoles.includes(role))) {
          (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
          return next();
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. Required: " + allowedRoles.join(" or "),
        });
      }

      // Use roles already fetched by requireAuth (cached) — skip second DB round-trip
      let roleKeyList: string[];
      if (req.authUser.roles && req.authUser.roles.length > 0) {
        roleKeyList = req.authUser.roles;
      } else {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
          [req.authUser.id],
        );
        roleKeyList = (rows as { role_key: string }[]).map((row) => row.role_key);
      }

      const userRoles = normalizeRoleInputs(roleKeyList);

      if (userRoles.includes("super_admin")) {
        (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
        return next();
      }

      const expandedUserRoles = expandRoles(userRoles);
      const expandedAllowedRoles = expandRoles(normalizedAllowedRoles);
      const allowed = expandedAllowedRoles.some((role) => expandedUserRoles.includes(role));

      if (!allowed) {
        console.warn(
          `[requireRole] Denied: user role(s) [${userRoles.join(",")}] tried route requiring [${allowedRoles.join(",")}]`,
        );
        return res.status(403).json({
          success: false,
          message: "Access denied. Required: " + allowedRoles.join(" or "),
        });
      }

      (req as AuthenticatedRequest & { userRoles: RoleKey[] }).userRoles = userRoles;
      return next();
    } catch (err) {
      // SECURITY: Fail-closed on any error (including DB errors).
      // Do NOT propagate the error to the error handler — that could expose info.
      // Instead, deny access with 503 and log the error for investigation.
      console.error("[requireRole] Authorization check failed - denying access:", err instanceof Error ? err.message : String(err));
      return res.status(503).json({
        success: false,
        message: "Authorization service temporarily unavailable. Please try again.",
        code: "AUTH_SERVICE_UNAVAILABLE",
      });
    }
  };
}
