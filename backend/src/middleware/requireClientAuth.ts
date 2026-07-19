import type { Request, Response, NextFunction } from "express";
import { portalAuthService } from "../modules/portal/portal.auth.service.js";
import type { PortalTokenPayload } from "../modules/portal/portal.types.js";
import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export interface ClientAuthRequest extends Request {
  portalUser?: PortalTokenPayload;
}

export function requireClientAuth(req: ClientAuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing portal token" });
  }
  const token = header.slice(7);
  let payload: PortalTokenPayload;
  try {
    payload = portalAuthService.verifyToken(token);
    if (payload.role !== "client") return res.status(403).json({ error: "Forbidden" });
  } catch {
    return res.status(401).json({ error: "Invalid or expired portal token" });
  }

  // Revocation check — ensure the user account is still active in DB.
  // This lets admins cut off a client instantly by deactivating the user,
  // without waiting for the 7-day JWT to expire.
  db.execute<RowDataPacket[]>(
    "SELECT is_active FROM client_user WHERE id = ? LIMIT 1",
    [payload.clientUserId]
  )
    .then(([rows]) => {
      if (!rows.length || !rows[0].is_active) {
        return res.status(401).json({ error: "Account deactivated" });
      }
      req.portalUser = payload;
      return next();
    })
    .catch(() => {
      // DB unavailable — fail closed
      return res.status(503).json({ error: "Service temporarily unavailable" });
    });
}
