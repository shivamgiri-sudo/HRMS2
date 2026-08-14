import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { inboxService, getMyPending, getTimeline } from "./inbox.service.js";
import { generateFixDraftForWorkItem } from "../ai/mira-fix-draft-generate.service.js";
import { listFixDraftsForWorkItem } from "../ai/mira-fix-draft.service.js";
import { deployFixDraft } from "../ai/mira-fix-deploy.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /my-pending — platform-wide pending tasks for caller (role+branch scoped)
router.get("/my-pending", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const result = await getMyPending(userId);
  return res.json({ success: true, ...result });
}));

// GET /timeline/:referenceType/:referenceId — cross-module audit timeline
router.get("/timeline/:referenceType/:referenceId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { referenceType, referenceId } = req.params;
  // Optional: the work_item's own id, for tasks whose entity_id doesn't self-reference it —
  // see getTimeline's workItemId block for why this is needed.
  const workItemId = typeof req.query.workItemId === "string" ? req.query.workItemId : undefined;
  const events = await getTimeline(referenceType, referenceId, workItemId);
  return res.json({ success: true, events });
}));

// GET /count — unread count for caller
router.get("/count", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const count = await inboxService.getUnreadCount(userId);
  return res.json({ success: true, count });
}));

// GET / — list inbox items scoped to caller
router.get("/", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { type, priority, is_read } = req.query as Record<string, string>;
  const items = await inboxService.listItems({ user_id: userId, type, priority, is_read });
  return res.json({ success: true, data: items, total: items.length });
}));

// POST / — create inbox item (admin/hr only — system use)
router.post("/", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { user_id, type, title, description, entity_type, entity_id, action_url, priority } = req.body as Record<string, string>;
  if (!user_id || !type || !title) {
    return res.status(400).json({ success: false, error: "user_id, type, and title are required" });
  }
  const item = await inboxService.createItem({ user_id, type, title, description, entity_type, entity_id, action_url, priority });
  return res.status(201).json({ success: true, data: item });
}));

// PATCH /:id/read — mark item as read (caller's own items only)
router.patch("/:id/read", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  await inboxService.markRead(req.params.id, userId);
  return res.json({ success: true });
}));

// PATCH /:id/actioned — mark item as actioned (caller's own items only)
router.patch("/:id/actioned", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  await inboxService.markActioned(req.params.id, userId);
  return res.json({ success: true });
}));

// PATCH /mark-all-read — mark all unread items as read for caller
router.patch("/mark-all-read", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  await inboxService.markAllRead(userId);
  return res.json({ success: true });
}));

// GET /mira-fix-draft/:workItemId — every draft ever attempted for a triaged complaint,
// most recent first (rejected attempts stay visible as history, not hidden). super_admin
// only — this is the same audience Mira feedback items are assigned to.
router.get("/mira-fix-draft/:workItemId", requireRole("super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const drafts = await listFixDraftsForWorkItem(req.params.workItemId);
  return res.json({ success: true, drafts });
}));

// POST /mira-fix-draft/:workItemId/generate — attempts to turn an already-triaged,
// already-eligible diagnosis (category='genuine_bug', actionable=true) into a candidate
// diff. Every outcome (including refusal and rejection) is a 200 with a status field, not
// an error response — "the model declined" and "the deny-list rejected it" are expected,
// informative outcomes for a human reviewer to read, not failures of this endpoint.
// super_admin only: this is a privileged action that writes an AI-authored diff to the
// database, even though nothing can be deployed from it yet (see mira-fix-draft.service.ts).
router.post("/mira-fix-draft/:workItemId/generate", requireRole("super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const outcome = await generateFixDraftForWorkItem(req.params.workItemId);
  return res.json({ success: true, outcome });
}));

// POST /mira-fix-draft/deploy/:draftId — applies a drafted diff in a disposable worktree,
// runs the verification command, and (only when MIRA_AUTO_DEPLOY_ENABLED) commits, pushes
// and confirms it live, reverting automatically if confirmation fails. Same 200-with-status
// contract as /generate: "the deny-list rejected it", "the tests failed" and "this was a dry
// run because the pipeline is not armed" are all outcomes to read, not errors.
//
// super_admin only, and deliberately a separate call from /generate — generating a candidate
// diff and shipping one are different decisions, and collapsing them into one endpoint would
// mean the act of drafting could deploy.
router.post("/mira-fix-draft/deploy/:draftId", requireRole("super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.authUser?.email ?? req.authUser?.id ?? "super_admin";
  const outcome = await deployFixDraft(req.params.draftId, String(actor));
  return res.json({ success: true, outcome });
}));

export { router as inboxRouter };
