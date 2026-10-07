import { Router } from "express";
import type { Response } from "express";
import { requireAuth, requireWriteAccess } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { createLoopback } from "./loopback.js";
import { decideApproval, listPendingApprovals } from "./approval-center.service.js";

export const approvalCenterRouter = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

approvalCenterRouter.use(requireAuth);

// GET /pending — every approval the caller can act on now, with all components.
approvalCenterRouter.get("/pending", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = createLoopback(req.authUser!.id, String(req.headers.authorization));
  const data = await listPendingApprovals(ctx, { fresh: req.query.fresh === "1" });
  // meta is server-only routing state; the client never sees or sends it.
  return res.json({ success: true, data: { ...data, items: data.items.map(({ meta: _meta, ...rest }) => rest) } });
}));

// POST /decide { uid, action: approve|reject, remarks? }
approvalCenterRouter.post("/decide", requireWriteAccess, h(async (req: AuthenticatedRequest, res: Response) => {
  const { uid, action, remarks } = (req.body ?? {}) as { uid?: unknown; action?: unknown; remarks?: unknown };
  if (typeof uid !== "string" || !uid) return res.status(400).json({ success: false, message: "uid is required" });
  if (action !== "approve" && action !== "reject") return res.status(400).json({ success: false, message: "action must be approve or reject" });
  const ctx = createLoopback(req.authUser!.id, String(req.headers.authorization));
  const out = await decideApproval(ctx, uid, action, typeof remarks === "string" ? remarks : "");
  if (!out.ok) return res.status(out.status).json({ success: false, message: out.message });
  return res.json({ success: true, message: action === "approve" ? "Approved" : "Declined" });
}));
