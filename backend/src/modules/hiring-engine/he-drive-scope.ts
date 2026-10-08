/**
 * Branch scope for the drive routes (/api/he/drives and /drives/:id/*), the same rule as the analytics: org-wide roles see every drive,
 * a branch user only the drives of requisitions in their branch. Anything outside scope (or unknown) answers 404, never 403.
 * Org-wide callers skip the lookup, so their requests run exactly as before.
 */
import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { branchScopeOf } from "./he-stream.routes.js";

const covers = (scope: BranchScope, branch: unknown): boolean => scope.all || (!!scope.branchName && String(branch ?? "") === scope.branchName);

/** True when the drive exists and its requisition is in the caller's branch scope. */
export async function driveInScope(driveId: string, scope: BranchScope): Promise<boolean> {
  if (scope.all) return true;
  if (!scope.branchName) return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT jr.branch_name FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id WHERE d.id = ? LIMIT 1", [driveId]);
  return !!rows[0] && covers(scope, rows[0].branch_name);
}

/** True when the requisition exists and is in the caller's branch scope. */
export async function requisitionInBranchScope(requisitionId: string, scope: BranchScope): Promise<boolean> {
  if (scope.all) return true;
  if (!scope.branchName) return false;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_name FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  return !!rows[0] && covers(scope, rows[0].branch_name);
}

/** Route guard for /drives/:id/*: 404 "Drive not found" outside scope. */
export async function driveScoped(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (await driveInScope(String(req.params.id), await branchScopeOf(req as AuthenticatedRequest))) return next();
    res.status(404).json({ success: false, message: "Drive not found" });
  } catch (err) {
    logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he] drive scope check failed");
    res.status(500).json({ success: false, message: "Could not check access to this drive" });
  }
}

/** Route guard for POST /drives: the requisition in the body must be in scope (404 otherwise). A missing id is left to the route's 400. */
export async function bodyRequisitionScoped(req: Request, res: Response, next: NextFunction): Promise<void> {
  const rid = (req.body ?? {}).requisitionId;
  if (typeof rid !== "string") return next();
  try {
    if (await requisitionInBranchScope(rid, await branchScopeOf(req as AuthenticatedRequest))) return next();
    res.status(404).json({ success: false, message: "Requisition not found" });
  } catch (err) {
    logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he] requisition scope check failed");
    res.status(500).json({ success: false, message: "Could not check access to this requisition" });
  }
}

/** Route guard for /qualified-followup/:id and its row actions (audit view, retry, HR opt-out, mark-called): the row's requisition must be in the caller's branch scope (404 otherwise). */
export async function followupRowScoped(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = await branchScopeOf(req as AuthenticatedRequest);
    if (scope.all) return next();
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT jr.branch_name FROM qualified_followup qf JOIN job_requisition jr ON jr.id COLLATE utf8mb4_unicode_ci = qf.requisition_id COLLATE utf8mb4_unicode_ci WHERE qf.id = ? LIMIT 1",
      [String(req.params.id)]);
    if (rows[0] && covers(scope, rows[0].branch_name)) return next();
    res.status(404).json({ success: false, message: "not_found" });
  } catch (err) {
    logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he] follow-up row scope check failed");
    res.status(500).json({ success: false, message: "Could not check access to this follow-up" });
  }
}
