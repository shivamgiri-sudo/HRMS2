import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  approveCompanyPost,
  createCompanyPost,
  deleteCompanyPost,
  grantCompanyPostCreator,
  listApprovedCompanyFeed,
  listCompanyPostApprovals,
  listCompanyPostCreators,
  listCompanyPostManagement,
  listMyCompanyPosts,
  rejectCompanyPost,
  revokeCompanyPostCreator,
} from "./company-posts.service.js";
import {
  CreateCompanyPostSchema,
  GrantCompanyPostCreatorSchema,
  ModerateCompanyPostSchema,
  RevokeCompanyPostCreatorSchema,
} from "./company-posts.validation.js";

const DeleteCompanyPostSchema = z.object({
  post_id: z.string().uuid("Invalid post ID"),
  reason: z.string().trim().max(500).optional(),
});

function validationErrorMessage(error: z.ZodError): string {
  return Object.values(error.flatten().fieldErrors).flat().join("; ") || error.message;
}

function getActorUserId(req: AuthenticatedRequest): string {
  return req.authUser?.id ?? "";
}

function requestString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const companyPostsController = {
  async listFeed(_req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await listApprovedCompanyFeed() });
  },

  async create(req: AuthenticatedRequest, res: Response) {
    const parsed = CreateCompanyPostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
    }

    const data = await createCompanyPost({
      ...parsed.data,
      actorUserId: getActorUserId(req),
    });
    return res.status(201).json({ success: true, data });
  },

  async listMine(req: AuthenticatedRequest, res: Response) {
    const data = await listMyCompanyPosts({ actorUserId: getActorUserId(req) });
    return res.json({ success: true, data });
  },

  async listApprovals(req: AuthenticatedRequest, res: Response) {
    const data = await listCompanyPostApprovals({ actorUserId: getActorUserId(req) });
    return res.json({ success: true, data });
  },

  async listManage(req: AuthenticatedRequest, res: Response) {
    const data = await listCompanyPostManagement({ actorUserId: getActorUserId(req) });
    return res.json({ success: true, data });
  },

  async approve(req: AuthenticatedRequest, res: Response) {
    const parsed = ModerateCompanyPostSchema.safeParse({
      post_id: req.params.id,
      actor_user_id: getActorUserId(req),
      action: "approve",
      reason: req.body.reason,
      review_notes: req.body.review_notes,
    });
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
    }

    const data = await approveCompanyPost(parsed.data);
    return res.json({ success: true, data });
  },

  async reject(req: AuthenticatedRequest, res: Response) {
    const parsed = ModerateCompanyPostSchema.safeParse({
      post_id: req.params.id,
      actor_user_id: getActorUserId(req),
      action: "reject",
      reason: req.body.reason,
      review_notes: req.body.review_notes,
    });
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
    }

    const data = await rejectCompanyPost(parsed.data);
    return res.json({ success: true, data });
  },

  async remove(req: AuthenticatedRequest, res: Response) {
    const parsed = DeleteCompanyPostSchema.safeParse({
      post_id: req.params.id,
      reason: requestString(req.body?.reason) ?? requestString(req.query.reason),
    });
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
    }

    await deleteCompanyPost({
      postId: parsed.data.post_id,
      actorUserId: getActorUserId(req),
      reason: parsed.data.reason,
    });
    return res.json({ success: true });
  },

  async listCreators(req: AuthenticatedRequest, res: Response) {
    return res.json({ success: true, data: await listCompanyPostCreators({ actorUserId: getActorUserId(req) }) });
  },

  async grantCreator(req: AuthenticatedRequest, res: Response) {
    const parsed = GrantCompanyPostCreatorSchema.safeParse({
      employee_id: req.params.employeeId,
      user_id: req.body.user_id,
    });
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
    }

    const data = await grantCompanyPostCreator({
      ...parsed.data,
      actorUserId: getActorUserId(req),
    });
    return res.json({ success: true, data });
  },

  async revokeCreator(req: AuthenticatedRequest, res: Response) {
    const parsed = RevokeCompanyPostCreatorSchema.safeParse({
      employee_id: req.params.employeeId,
    });
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
    }

    const data = await revokeCompanyPostCreator({
      ...parsed.data,
      actorUserId: getActorUserId(req),
    });
    return res.json({ success: true, data });
  },
};
