import type { Request, Response, NextFunction } from "express";
import { portalAuthService } from "../modules/portal/portal.auth.service.js";
import type { PortalTokenPayload } from "../modules/portal/portal.types.js";

export interface ClientAuthRequest extends Request {
  portalUser?: PortalTokenPayload;
}

export function requireClientAuth(req: ClientAuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing portal token" });
  }
  const token = header.slice(7);
  try {
    const payload = portalAuthService.verifyToken(token);
    if (payload.role !== "client") return res.status(403).json({ error: "Forbidden" });
    req.portalUser = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired portal token" });
  }
}
