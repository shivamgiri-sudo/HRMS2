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

  // Demo bypass — skip DB revocation check for synthetic demo users.
  // Guard: only activates when PORTAL_DEMO_BYPASS is explicitly true AND
  // the userId is the well-known demo sentinel (never a real user UUID).
  if (
    process.env.PORTAL_DEMO_BYPASS === "true" &&
    payload.clientUserId.startsWith("u-demo-")
  ) {
    req.portalUser = payload;
    return next();
  }

  /*
   * Two revocation checks in one round trip.
   *
   * The account check is unchanged: deactivating a client_user cuts off every token they hold,
   * without waiting out the 7-day JWT.
   *
   * The session check is new. Each token now carries a jti recorded in portal_user_sessions, so
   * one session can be ended without disabling the account - a single device, or a token that
   * leaked. It is a correlated subquery rather than a second query because this runs on every
   * portal request.
   *
   * A token minted before session tracking has no jti. It is treated as live, not revoked: those
   * tokens are valid for up to seven more days and rejecting them would sign out every client
   * holding one. The account check still covers them, which is exactly the protection that
   * existed before.
   */
  db.execute<RowDataPacket[]>(
    `SELECT cu.is_active,
            EXISTS (
              SELECT 1 FROM portal_user_sessions s
               WHERE s.jti = ? AND s.revoked_at IS NOT NULL
            ) AS session_revoked
       FROM client_user cu
      WHERE cu.id = ? LIMIT 1`,
    [payload.jti ?? null, payload.clientUserId]
  )
    .then(([rows]) => {
      if (!rows.length || !rows[0].is_active) {
        return res.status(401).json({ error: "Account deactivated" });
      }
      if (payload.jti && Number(rows[0].session_revoked) === 1) {
        return res.status(401).json({ error: "Session revoked" });
      }
      req.portalUser = payload;
      return next();
    })
    .catch(() => {
      // DB unavailable — fail closed
      return res.status(503).json({ error: "Service temporarily unavailable" });
    });
}
