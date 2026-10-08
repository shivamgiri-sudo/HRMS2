import type { Request, Response, NextFunction } from "express";
import type { PrivacyContext, PrivacyAction } from "./privacyPolicy.types.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

declare global {
  namespace Express {
    interface Request {
      privacyContext?: PrivacyContext;
    }
  }
}

/**
 * Middleware that reads auth context and attaches a PrivacyContext to req.
 * Must be placed after requireAuth.
 *
 * Usage:
 *   router.get('/endpoint', requireAuth, privacyContextMiddleware('read'), handler)
 */
export function privacyContextMiddleware(action: PrivacyAction) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.authUser) {
      next();
      return;
    }

    const principalId =
      (req.params as Record<string, string>).id ??
      (req.params as Record<string, string>).employeeId ??
      (req.query.employeeId as string | undefined);

    const authUserAny = authReq.authUser as Record<string, unknown>;
    req.privacyContext = {
      actorUserId: authReq.authUser.id,
      actorRoles: (authUserAny.roleKeys as string[] | undefined) ?? [authReq.authUser.role ?? "employee"],
      primaryRole: authReq.authUser.role ?? "employee",
      principalId,
      principalType: "employee",
      requestedAction: action,
      purposeCode: req.headers["x-privacy-purpose"] as string | undefined,
      branchId: (req.query.branch_id as string | undefined) ?? (authUserAny.branchId as string | undefined),
      processId: req.query.process_id as string | undefined,
      ipAddress: req.ip ?? undefined,
      userAgent: req.headers["user-agent"] ?? undefined,
      isSelfAccess: principalId === authReq.authUser.id || principalId === (authUserAny.employeeId as string | undefined),
    };

    next();
  };
}
