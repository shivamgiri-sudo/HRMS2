import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "./authMiddleware.js";
import { getEmployeeForUser, hasRoleForRequest } from "../shared/accessGuard.js";
import { db } from "../db/mysql.js";
import { logger } from "../logger.js";

export const MASID_RE = /^MAS\d+$/i;

/**
 * Roles that may open any agent's quality view via ?agentCode=. Org-wide quality roles only;
 * super_admin and admin are implied by hasRole. Branch/process-scoped managers are deliberately
 * not here yet — that needs row-scope enforcement against the agent's branch/process first.
 */
export const QUALITY_VIEW_ANY_AGENT_ROLES = ["qa", "quality_analyst", "tq_head"] as const;

/**
 * The agent's MASID as used by db_audit.call_quality_assessment.User / CallDetails.AgentName.
 * It lives in employees.call_centre_code for some employees and in employees.employee_code for
 * others (e.g. employee_code = "MAS60429"), so take whichever column actually holds a MAS code.
 */
async function resolveMasid(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT call_centre_code, employee_code FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const row = rows[0];
  if (!row) return null;
  for (const v of [row.call_centre_code, row.employee_code]) {
    const s = typeof v === "string" ? v.trim() : "";
    if (MASID_RE.test(s)) return s.toUpperCase();
  }
  return null;
}

/**
 * Resolves whose quality data the request may read and attaches it as req.agentCode (a MASID).
 * - No ?agentCode: the caller's own MASID (403 if they are not a call-centre agent).
 * - ?agentCode equal to the caller's own MASID: allowed.
 * - ?agentCode for someone else: only for QUALITY_VIEW_ANY_AGENT_ROLES (and super_admin/admin);
 *   every such access is logged.
 */
export async function requireAgent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.authUser?.id) {
      res.status(401).json({ success: false, message: "Unauthenticated" });
      return;
    }

    const emp = await getEmployeeForUser(req.authUser.id);
    const ownMasid = emp ? await resolveMasid(emp.id) : null;
    const requested = typeof req.query.agentCode === "string" ? req.query.agentCode.trim() : "";

    if (requested) {
      if (!MASID_RE.test(requested)) {
        res.status(400).json({ success: false, message: "agentCode must be a MASID like MAS60429" });
        return;
      }
      const target = requested.toUpperCase();
      if (ownMasid && target === ownMasid) {
        (req as AuthenticatedRequest & { agentCode: string }).agentCode = ownMasid;
        next();
        return;
      }
      if (await hasRoleForRequest(req.authUser, ...QUALITY_VIEW_ANY_AGENT_ROLES)) {
        logger.info(`[quality-view] user ${req.authUser.id} viewed quality data of agent ${target} (${req.method} ${req.originalUrl})`);
        (req as AuthenticatedRequest & { agentCode: string }).agentCode = target;
        next();
        return;
      }
      logger.warn(`User ${req.authUser.id} (${ownMasid ?? "no MASID"}) attempted access for agent ${target}`);
      res.status(403).json({ success: false, message: "Forbidden: cannot access another agent's data" });
      return;
    }

    if (!ownMasid) {
      res.status(403).json({ success: false, message: "Forbidden: no call-centre quality data is linked to your account" });
      return;
    }
    (req as AuthenticatedRequest & { agentCode: string }).agentCode = ownMasid;
    next();
  } catch (err) {
    logger.error("requireAgent middleware error:", err);
    next(err);
  }
}
