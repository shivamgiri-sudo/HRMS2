import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../company-posts.service.js", () => ({
  approveCompanyPost: vi.fn(),
  createCompanyPost: vi.fn(),
  deleteCompanyPost: vi.fn(),
  grantCompanyPostCreator: vi.fn(),
  listApprovedCompanyFeed: vi.fn(),
  listCompanyPostApprovals: vi.fn(),
  listCompanyPostCreators: vi.fn(),
  listMyCompanyPosts: vi.fn(),
  rejectCompanyPost: vi.fn(),
  revokeCompanyPostCreator: vi.fn(),
}));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { authUser: { id: string; role?: string } }).authUser = {
      id: "11111111-1111-1111-1111-111111111111",
      role: String(req.headers["x-test-role"] ?? "employee"),
    };
    next();
  },
}));

vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const currentRole = String((req as express.Request & { authUser?: { role?: string } }).authUser?.role ?? "employee");
      if (!roles.includes(currentRole)) {
        return res.status(403).json({ success: false, message: "Access denied. Required: " + roles.join(" or ") });
      }
      return next();
    },
}));

vi.mock("../../../shared/accessGuard.js", () => ({
  selfOrAdminHr: (..._args: string[]) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../engagement.controller.js", () => ({
  engagementController: {
    getMySummary: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    listBadges: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    awardBadge: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    getEmployeeBadges: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    getLeaderboard: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    adjustPoints: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    getPoints: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    listTiers: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    getEmployeeTier: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    listKudosTemplates: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    getMyKudosLimit: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    listKudos: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    sendKudos: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    listSurveys: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    createSurvey: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    getSurveyResults: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    getENPS: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    getSurvey: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    submitSurvey: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    getMyPulseChecks: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: [] })),
    getPulseSummary: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
    submitPulse: vi.fn(async (_req: express.Request, res: express.Response) => res.json({ success: true, data: null })),
  },
}));

import {
  approveCompanyPost,
  createCompanyPost,
  deleteCompanyPost,
  grantCompanyPostCreator,
  listApprovedCompanyFeed,
  listCompanyPostApprovals,
  listCompanyPostCreators,
  listMyCompanyPosts,
  rejectCompanyPost,
  revokeCompanyPostCreator,
} from "../company-posts.service.js";

function createApp(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use("/api/engagement", router);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    return res.status(error?.statusCode ?? 500).json({
      success: false,
      message: error?.message ?? "Internal server error",
    });
  });
  return app;
}

describe("company post engagement routes", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { engagementRouter } = await import("../engagement.routes.js");
    app = createApp(engagementRouter);
  });

  it("returns the approved feed payload", async () => {
    vi.mocked(listApprovedCompanyFeed).mockResolvedValueOnce([
      { id: "post-1", status: "approved" },
    ] as any);

    const response = await request(app)
      .get("/api/engagement/company-posts/feed")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [{ id: "post-1", status: "approved" }],
    });
    expect(listApprovedCompanyFeed).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid company post creation payloads", async () => {
    const response = await request(app)
      .post("/api/engagement/company-posts")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(response.status).toBe(400);
    expect(createCompanyPost).not.toHaveBeenCalled();
  });

  it("creates a company post with authenticated actor context", async () => {
    vi.mocked(createCompanyPost).mockResolvedValueOnce({ id: "post-1", status: "pending_approval" } as any);

    const response = await request(app)
      .post("/api/engagement/company-posts")
      .set("Authorization", "Bearer test-token")
      .send({
        content_text: "Townhall today",
        media: [{ file_id: "file-1", media_type: "image", sort_order: 1 }],
      });

    expect(response.status).toBe(201);
    expect(createCompanyPost).toHaveBeenCalledWith({
      actorUserId: "11111111-1111-1111-1111-111111111111",
      content_text: "Townhall today",
      media: [{ file_id: "file-1", media_type: "image", sort_order: 1 }],
    });
  });

  it("loads the current creator's posts from auth context", async () => {
    vi.mocked(listMyCompanyPosts).mockResolvedValueOnce([] as any);

    const response = await request(app)
      .get("/api/engagement/company-posts/mine")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(200);
    expect(listMyCompanyPosts).toHaveBeenCalledWith({
      actorUserId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("loads the moderation approvals queue from auth context", async () => {
    vi.mocked(listCompanyPostApprovals).mockResolvedValueOnce([] as any);

    const response = await request(app)
      .get("/api/engagement/company-posts/approvals")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(200);
    expect(listCompanyPostApprovals).toHaveBeenCalledWith({
      actorUserId: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("rejects invalid approve route params before calling the service", async () => {
    const response = await request(app)
      .post("/api/engagement/company-posts/not-a-uuid/approve")
      .set("Authorization", "Bearer test-token")
      .send({ review_notes: "Looks good" });

    expect(response.status).toBe(400);
    expect(approveCompanyPost).not.toHaveBeenCalled();
  });

  it("approves a company post with authenticated actor context", async () => {
    vi.mocked(approveCompanyPost).mockResolvedValueOnce({ id: "post-1", status: "approved" } as any);

    const response = await request(app)
      .post("/api/engagement/company-posts/22222222-2222-2222-2222-222222222222/approve")
      .set("Authorization", "Bearer test-token")
      .send({ review_notes: "Approved for publish", actor_user_id: "ignored" });

    expect(response.status).toBe(200);
    expect(approveCompanyPost).toHaveBeenCalledWith({
      action: "approve",
      actor_user_id: "11111111-1111-1111-1111-111111111111",
      post_id: "22222222-2222-2222-2222-222222222222",
      reason: undefined,
      review_notes: "Approved for publish",
    });
  });

  it("rejects a company post with authenticated actor context", async () => {
    vi.mocked(rejectCompanyPost).mockResolvedValueOnce({ id: "post-1", status: "rejected" } as any);

    const response = await request(app)
      .post("/api/engagement/company-posts/22222222-2222-2222-2222-222222222222/reject")
      .set("Authorization", "Bearer test-token")
      .send({ reason: "Needs revision", review_notes: "Too promotional" });

    expect(response.status).toBe(200);
    expect(rejectCompanyPost).toHaveBeenCalledWith({
      action: "reject",
      actor_user_id: "11111111-1111-1111-1111-111111111111",
      post_id: "22222222-2222-2222-2222-222222222222",
      reason: "Needs revision",
      review_notes: "Too promotional",
    });
  });

  it("soft deletes a company post with authenticated actor context", async () => {
    vi.mocked(deleteCompanyPost).mockResolvedValueOnce(undefined);

    const response = await request(app)
      .delete("/api/engagement/company-posts/22222222-2222-2222-2222-222222222222")
      .set("Authorization", "Bearer test-token")
      .send({ reason: "Removed after review" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(deleteCompanyPost).toHaveBeenCalledWith({
      actorUserId: "11111111-1111-1111-1111-111111111111",
      postId: "22222222-2222-2222-2222-222222222222",
      reason: "Removed after review",
    });
  });

  it("blocks creator access assignment listing for non-super-admin callers", async () => {
    const response = await request(app)
      .get("/api/engagement/company-post-creators")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(403);
    expect(listCompanyPostCreators).not.toHaveBeenCalled();
  });

  it("lists creator access assignments for super admin callers", async () => {
    vi.mocked(listCompanyPostCreators).mockResolvedValueOnce([
      { employee_id: "33333333-3333-3333-3333-333333333333", active_status: true },
    ] as any);

    const response = await request(app)
      .get("/api/engagement/company-post-creators")
      .set("Authorization", "Bearer test-token")
      .set("x-test-role", "super_admin");

    expect(response.status).toBe(200);
    expect(listCompanyPostCreators).toHaveBeenCalledWith({
      actorUserId: "11111111-1111-1111-1111-111111111111",
    });
    expect(response.body.success).toBe(true);
  });

  it("rejects invalid creator grant params before calling the service", async () => {
    const response = await request(app)
      .post("/api/engagement/company-post-creators/not-a-uuid/grant")
      .set("Authorization", "Bearer test-token")
      .set("x-test-role", "super_admin")
      .send({});

    expect(response.status).toBe(400);
    expect(grantCompanyPostCreator).not.toHaveBeenCalled();
  });

  it("grants creator access with authenticated actor context", async () => {
    vi.mocked(grantCompanyPostCreator).mockResolvedValueOnce({ employee_id: "33333333-3333-3333-3333-333333333333" } as any);

    const response = await request(app)
      .post("/api/engagement/company-post-creators/33333333-3333-3333-3333-333333333333/grant")
      .set("Authorization", "Bearer test-token")
      .set("x-test-role", "super_admin")
      .send({ user_id: "44444444-4444-4444-4444-444444444444", actorUserId: "ignored" });

    expect(response.status).toBe(200);
    expect(grantCompanyPostCreator).toHaveBeenCalledWith({
      actorUserId: "11111111-1111-1111-1111-111111111111",
      employee_id: "33333333-3333-3333-3333-333333333333",
      user_id: "44444444-4444-4444-4444-444444444444",
    });
  });

  it("revokes creator access with authenticated actor context", async () => {
    vi.mocked(revokeCompanyPostCreator).mockResolvedValueOnce({ employee_id: "33333333-3333-3333-3333-333333333333" } as any);

    const response = await request(app)
      .post("/api/engagement/company-post-creators/33333333-3333-3333-3333-333333333333/revoke")
      .set("Authorization", "Bearer test-token")
      .set("x-test-role", "super_admin");

    expect(response.status).toBe(200);
    expect(revokeCompanyPostCreator).toHaveBeenCalledWith({
      actorUserId: "11111111-1111-1111-1111-111111111111",
      employee_id: "33333333-3333-3333-3333-333333333333",
    });
  });
});
