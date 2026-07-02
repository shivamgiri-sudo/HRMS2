import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import { getEmployeeForUser } from "../shared/accessGuard.js";
import { logger } from "../logger.js";

/**
 * Agent Authorization Middleware
 *
 * Ensures:
 * 1. User is authenticated (requireAuth should run first)
 * 2. User has an associated employee_code (agent/staff role)
 * 3. If ?agentCode query param is provided, verifies it matches the authenticated user's code
 *    (prevents one agent from accessing another's data)
 *
 * On success: attaches req.agentCode to the request
 * On failure: returns 403 Forbidden
 */
export async function requireAgent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.authUser?.id) {
      res.status(401).json({ success: false, message: "Unauthenticated" });
      return;
    }

    // Get employee record for this user
    const emp = await getEmployeeForUser(req.authUser.id);
    if (!emp?.employee_code) {
      logger.warn(`User ${req.authUser.id} has no employee_code`);
      res.status(403).json({ success: false, message: "Forbidden: not an agent" });
      return;
    }

    // If query param ?agentCode is provided, verify it matches the user's code
    const requestedAgentCode = req.query.agentCode as string | undefined;
    if (requestedAgentCode && requestedAgentCode !== emp.employee_code) {
      logger.warn(`User ${req.authUser.id} (${emp.employee_code}) attempted access for agent ${requestedAgentCode}`);
      res.status(403).json({ success: false, message: "Forbidden: cannot access another agent's data" });
      return;
    }

    // Attach agent code to request for use in route handlers
    (req as AuthenticatedRequest & { agentCode: string }).agentCode = emp.employee_code;
    next();
  } catch (err) {
    logger.error("requireAgent middleware error:", err);
    next(err);
  }
}
