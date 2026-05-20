import type { RowDataPacket } from "mysql2";
import type { NextFunction, Response } from "express";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "./authMiddleware.js";

export function requireRole(...allowedRoles: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.authUser?.id) {
        return res.status(401).json({ success: false, message: "Unauthenticated" });
      }

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT r.role_key
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ? AND ur.is_active = 1`,
        [req.authUser.id]
      );

      const userRoles = (rows as { role_key: string }[]).map((r) => r.role_key);
      const allowed = allowedRoles.some((role) => userRoles.includes(role));

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
