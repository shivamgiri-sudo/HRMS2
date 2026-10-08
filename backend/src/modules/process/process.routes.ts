import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { processController } from "./process.controller.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";

export const processRouter = Router();

processRouter.use(requireAuth);

/**
 * Branch scoping for process WRITES (owner ruling 2026-10-01). requireRole("admin","hr") says who may open
 * the page, not which processes they may change: hr used to configure / edit / (de)activate / create a process in
 * ANY branch. Org-wide roles are unaffected; hr is limited to processes of its own branch (or an assigned
 * branch / process). A user with no resolvable branch is refused. Reads stay open (process master data).
 */
async function requireProcessWriteScope(req: any, res: any, next: any) {
  try {
    const scope = await resolveUserBusinessScope(req.authUser!);
    if (scope.roles.some((r) => ORG_WIDE_EXEMPT_ROLES.includes(r))) return next();

    const branches = new Set<string>();
    if (scope.branchId) branches.add(scope.branchId);
    for (const a of scope.assignments) if (a.branchId && a.scopeType !== "self") branches.add(a.branchId);
    const assignedProcesses = new Set(scope.assignments.map((a) => a.processId).filter(Boolean) as string[]);
    const deny = () => res.status(403).json({ success: false, message: "Forbidden: this process is outside your branch / assigned scope" });

    if (req.params?.id) {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM process_master WHERE id = ? LIMIT 1", [req.params.id]);
      const row = (rows as RowDataPacket[])[0];
      if (!row) return res.status(404).json({ success: false, message: "Process not found" });
      const inBranch = row.branch_id && branches.has(String(row.branch_id));
      if (!inBranch && !assignedProcesses.has(String(req.params.id))) return deny();
    }
    // A create/update that names a branch must name one of the caller's own.
    const branchName = req.body?.branchName;
    if (typeof branchName === "string" && branchName.trim()) {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT id FROM branch_master WHERE branch_name = ? LIMIT 1", [branchName.trim()]);
      const id = (rows as RowDataPacket[])[0]?.id;
      if (!id || !branches.has(String(id))) return deny();
    } else if (!req.params?.id && branches.size === 0) {
      return deny();
    }
    return next();
  } catch (err) { return next(err); }
}

processRouter.get("/", (req, res, next) => {
  processController.list(req as AuthenticatedRequest, res).catch(next);
});

// MUST stay above "/:id". Express matches in registration order, so if this were declared
// after it, a request for /my-processes would be handled by getById with id="my-processes"
// and answer "Process not found" — the literal route would never run.
processRouter.get("/my-processes", (req, res, next) => {
  processController.listMyProcesses(req as AuthenticatedRequest, res).catch(next);
});

processRouter.get("/:id", (req, res, next) => {
  processController.getById(req as unknown as AuthenticatedRequest, res).catch(next);
});

processRouter.get("/:id/configuration", (req, res, next) => {
  processController.getConfiguration(req as unknown as AuthenticatedRequest, res).catch(next);
});

processRouter.put("/:id/configuration", requireRole("admin", "hr"), requireProcessWriteScope, (req, res, next) => {
  processController.saveConfiguration(req as AuthenticatedRequest, res).catch(next);
});

processRouter.post("/", requireRole("admin", "hr"), requireProcessWriteScope, (req, res, next) => {
  processController.create(req as AuthenticatedRequest, res).catch(next);
});

processRouter.put("/:id", requireRole("admin", "hr"), requireProcessWriteScope, (req, res, next) => {
  processController.update(req as AuthenticatedRequest, res).catch(next);
});

processRouter.patch("/:id/status", requireRole("admin", "hr"), requireProcessWriteScope, (req, res, next) => {
  processController.updateStatus(req as AuthenticatedRequest, res).catch(next);
});
