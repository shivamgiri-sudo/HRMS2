import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { jobsService } from "./jobs.service.js";
import { resolveAtsBranchScope, OUT_OF_SCOPE_MESSAGE } from "../ats-extensions/ats-ext-scope.js";

/**
 * Branch gate for authenticated job/walk-in mutations (owner policy 2026-10-01): org-wide roles pass; hr and
 * recruiters may only touch rows of their own branch. A row (or request) with no branch is org-level data and
 * is refused to non-org-wide callers (fail closed).
 */
async function branchGate(req: Request, res: Response, branchId: string | null | undefined, kind: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = await resolveAtsBranchScope((req as any).authUser?.id ?? "");
  if (scope.orgWide) return true;
  if (branchId === undefined) { res.status(404).json({ success: false, error: `${kind} not found` }); return false; }
  if (branchId && scope.branchIds.includes(branchId)) return true;
  res.status(403).json({ success: false, error: OUT_OF_SCOPE_MESSAGE, message: OUT_OF_SCOPE_MESSAGE });
  return false;
}

export const jobsRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);

// ─── Job Postings ──────────────────────────────────────────────────────────────

// GET /postings — public access for active, auth for others
jobsRouter.get(
  "/postings",
  h(async (req: Request, res: Response) => {
    const { status, process_id, branch_id } = req.query as Record<
      string,
      string | undefined
    >;
    const postings = await jobsService.listPostings({
      status,
      process_id,
      branch_id,
    });
    return res.json({ success: true, data: postings, total: postings.length });
  }),
);

// POST /postings — admin/hr only
jobsRouter.post(
  "/postings",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId: string = (req as any).authUser?.id ?? "";
    if (!(await branchGate(req, res, (req.body?.branch_id as string | undefined) ?? null, "Job posting"))) return;
    const posting = await jobsService.createPosting(req.body, userId);
    return res.status(201).json({ success: true, data: posting });
  }),
);

// PATCH /postings/:id — admin/hr only
jobsRouter.patch(
  "/postings/:id",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (req: Request, res: Response) => {
    if (!(await branchGate(req, res, await jobsService.getBranchOf("job_posting", req.params.id), "Job posting"))) return;
    if (req.body?.branch_id && !(await branchGate(req, res, req.body.branch_id as string, "Job posting"))) return;
    const posting = await jobsService.updatePosting(req.params.id, req.body);
    return res.json({ success: true, data: posting });
  }),
);

// ─── Walk-in Queue ─────────────────────────────────────────────────────────────

// GET /walkin — admin/hr/recruiter only
jobsRouter.get(
  "/walkin",
  requireAuth,
  requireRole("admin", "hr", "recruiter"),
  h(async (req: Request, res: Response) => {
    const { status, branch_id, date } = req.query as Record<string, string | undefined>;
    const scope = await resolveAtsBranchScope((req as any).authUser?.id ?? ""); // eslint-disable-line @typescript-eslint/no-explicit-any
    const entries = await jobsService.listWalkin({ status, branch_id, date, scopeBranchIds: scope.orgWide ? undefined : scope.branchIds });
    return res.json({ success: true, data: entries, total: entries.length });
  }),
);

// POST /walkin — public registration
jobsRouter.post(
  "/walkin",
  h(async (req: Request, res: Response) => {
    const {
      candidate_name,
      mobile,
      email,
      applied_role,
      branch_id,
      process_id,
    } = req.body as {
      candidate_name: string;
      mobile: string;
      email?: string;
      applied_role?: string;
      branch_id?: string;
      process_id?: string;
    };

    if (!candidate_name?.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "candidate_name is required" });
    }
    if (!mobile?.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "mobile is required" });
    }

    const entry = await jobsService.registerWalkin({
      candidate_name: candidate_name.trim(),
      mobile: mobile.trim(),
      email,
      applied_role,
      branch_id,
      process_id,
    });
    return res.status(201).json({ success: true, data: entry });
  }),
);

// PATCH /walkin/:id/call — admin/hr/recruiter
jobsRouter.patch(
  "/walkin/:id/call",
  requireAuth,
  requireRole("admin", "hr", "recruiter"),
  h(async (req: Request, res: Response) => {
    if (!(await branchGate(req, res, await jobsService.getBranchOf("walkin_queue", req.params.id), "Walk-in entry"))) return;
    const entry = await jobsService.callCandidate(req.params.id);
    return res.json({ success: true, data: entry });
  }),
);

// PATCH /walkin/:id/status — admin/hr/recruiter
jobsRouter.patch(
  "/walkin/:id/status",
  requireAuth,
  requireRole("admin", "hr", "recruiter"),
  h(async (req: Request, res: Response) => {
    const { status, notes, recruiter_id } = req.body as {
      status: string;
      notes?: string;
      recruiter_id?: string;
    };

    if (!status) {
      return res
        .status(400)
        .json({ success: false, error: "status is required" });
    }

    if (!(await branchGate(req, res, await jobsService.getBranchOf("walkin_queue", req.params.id), "Walk-in entry"))) return;
    const entry = await jobsService.updateWalkinStatus(req.params.id, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: status as any,
      notes,
      recruiter_id,
    });
    return res.json({ success: true, data: entry });
  }),
);
