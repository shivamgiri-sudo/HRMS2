/** Tiny helpers shared by the sales / outbound routers (same error envelope and scope checks as pd.routes.ts). */
import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../../../middleware/authMiddleware.js";
import { logger } from "../../../logger.js";
import { hasAnyWritableProcess, isProcessReadable, isProcessWritable } from "../pd.config.service.js";
import { PdError } from "../pd.source.js";

export const UUID_RE = /^[0-9a-fA-F-]{36}$/;
export const OUT_OF_SCOPE = { success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." };
export const q1 = (v: unknown): string => (typeof v === "string" ? v : "");
type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
export const wrap = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch((err: unknown) => {
    if (err instanceof PdError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    logger.error({ err, path: req.path }, "[process-dashboard] request failed");
    next(err);
  });
};
/** UUID, then the caller's own scope. Returns false after sending 403. */
export async function guard(req: AuthenticatedRequest, res: Response, kind: "read" | "write"): Promise<string | null> {
  const { processId } = req.params;
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  const ok = kind === "read" ? await isProcessReadable(req.authUser!.id, processId) : await isProcessWritable(req.authUser!.id, processId);
  if (!ok) { res.status(403).json(OUT_OF_SCOPE); return null; }
  return processId;
}
export async function guardBody(req: AuthenticatedRequest, res: Response): Promise<string | null> {
  const b = (req.body ?? {}) as { processId?: string };
  if (!b.processId || !UUID_RE.test(b.processId)) throw new PdError(400, "BAD_PROCESS", "processId is required");
  if (!(await isProcessWritable(req.authUser!.id, b.processId))) { res.status(403).json(OUT_OF_SCOPE); return null; }
  return b.processId;
}

/** Admin helpers that are not about one process (table/column lists, suggestions): 403 unless the caller can administer at least one process. */
export async function requireAnyWritable(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (await hasAnyWritableProcess(req.authUser!.id)) return next();
    res.status(403).json(OUT_OF_SCOPE);
  } catch (err) { next(err); }
}
