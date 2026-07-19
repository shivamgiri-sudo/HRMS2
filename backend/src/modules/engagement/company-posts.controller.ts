import type { Response } from "express";
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
  DeleteCompanyPostSchema,
  GrantCompanyPostCreatorSchema,
  ModerateCompanyPostSchema,
  RevokeCompanyPostCreatorSchema,
} from "./company-posts.validation.js";
import { z } from "zod";

function validationErrorMessage(error: z.ZodError): string {
  return Object.values(error.flatten().fieldErrors).flat().join("; ") || error.message;
}

function getActorUserId(req: AuthenticatedRequest): string {
  if (!req.authUser?.id) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
  return req.authUser.id;
}

function getActorContext(req: AuthenticatedRequest) {
  return {
    actorUserId: getActorUserId(req),
    ipAddress: req.ip ?? undefined,
    userAgent: req.get("user-agent") ?? undefined,
  };
}

function parsePage(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

function parseLimit(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(100, Math.floor(n)) : undefined;
}

function requestString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const companyPostsController = {
  async listFeed(req: AuthenticatedRequest, res: Response) {
    try {
      const { actorUserId } = getActorContext(req);
      void actorUserId; // auth confirmed; feed is read-only for all authenticated users
      const result = await listApprovedCompanyFeed({
        page: parsePage(req.query.page),
        limit: parseLimit(req.query.limit),
      });
      return res.json({ success: true, ...result });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async create(req: AuthenticatedRequest, res: Response) {
    try {
      const ctx = getActorContext(req);
      const parsed = CreateCompanyPostSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
      }
      const data = await createCompanyPost({ ...parsed.data, actorUserId: ctx.actorUserId });
      return res.status(201).json({ success: true, data });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async listMine(req: AuthenticatedRequest, res: Response) {
    try {
      const { actorUserId } = getActorContext(req);
      const result = await listMyCompanyPosts({
        actorUserId,
        page: parsePage(req.query.page),
        limit: parseLimit(req.query.limit),
      });
      return res.json({ success: true, ...result });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async listApprovals(req: AuthenticatedRequest, res: Response) {
    try {
      const { actorUserId } = getActorContext(req);
      const result = await listCompanyPostApprovals({
        actorUserId,
        page: parsePage(req.query.page),
        limit: parseLimit(req.query.limit),
      });
      return res.json({ success: true, ...result });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async listManage(req: AuthenticatedRequest, res: Response) {
    try {
      const { actorUserId } = getActorContext(req);
      const result = await listCompanyPostManagement({
        actorUserId,
        page: parsePage(req.query.page),
        limit: parseLimit(req.query.limit),
      });
      return res.json({ success: true, ...result });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async approve(req: AuthenticatedRequest, res: Response) {
    try {
      const ctx = getActorContext(req);
      const parsed = ModerateCompanyPostSchema.safeParse({
        post_id: req.params.id,
        actor_user_id: ctx.actorUserId,
        action: "approve",
        review_notes: req.body.review_notes,
      });
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
      }
      const data = await approveCompanyPost({
        ...parsed.data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return res.json({ success: true, data });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async reject(req: AuthenticatedRequest, res: Response) {
    try {
      const ctx = getActorContext(req);
      const parsed = ModerateCompanyPostSchema.safeParse({
        post_id: req.params.id,
        actor_user_id: ctx.actorUserId,
        action: "reject",
        reason: req.body.reason,
        review_notes: req.body.review_notes,
      });
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
      }
      const data = await rejectCompanyPost({
        ...parsed.data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return res.json({ success: true, data });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async remove(req: AuthenticatedRequest, res: Response) {
    try {
      const ctx = getActorContext(req);
      const parsed = DeleteCompanyPostSchema.safeParse({
        post_id: req.params.id,
        reason: requestString(req.body?.reason),
      });
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
      }
      await deleteCompanyPost({
        postId: parsed.data.post_id,
        actorUserId: ctx.actorUserId,
        reason: parsed.data.reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return res.json({ success: true });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async listCreators(req: AuthenticatedRequest, res: Response) {
    try {
      const { actorUserId } = getActorContext(req);
      const data = await listCompanyPostCreators({ actorUserId });
      return res.json({ success: true, data });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async grantCreator(req: AuthenticatedRequest, res: Response) {
    try {
      const { actorUserId } = getActorContext(req);
      const parsed = GrantCompanyPostCreatorSchema.safeParse({
        employee_id: req.params.employeeId,
        user_id: req.body.user_id,
      });
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
      }
      const data = await grantCompanyPostCreator({ ...parsed.data, actorUserId });
      return res.json({ success: true, data });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },

  async revokeCreator(req: AuthenticatedRequest, res: Response) {
    try {
      const { actorUserId } = getActorContext(req);
      const parsed = RevokeCompanyPostCreatorSchema.safeParse({
        employee_id: req.params.employeeId,
      });
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: validationErrorMessage(parsed.error) });
      }
      const data = await revokeCompanyPostCreator({ ...parsed.data, actorUserId });
      return res.json({ success: true, data });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      return res.status(e.statusCode ?? 500).json({ success: false, error: e.message ?? "Server error" });
    }
  },
};
