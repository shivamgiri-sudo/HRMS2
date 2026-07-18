import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../../middleware/errorHandler.js";
import { createPerformanceIntelligenceRouter } from "../performance-intelligence.routes.js";

function service() {
  return {
    context: vi.fn().mockResolvedValue({
      effectiveRole: "team_leader",
      scopeLevel: "TEAM_ONLY",
      scopeLabel: "My team",
      canViewPeople: true,
    }),
    scorecard: vi.fn().mockResolvedValue([]),
    trends: vi.fn().mockResolvedValue([]),
    people: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 }),
  };
}

function appWith(
  testService: ReturnType<typeof service>,
  authenticated = true,
) {
  const app = express();
  app.use("/api/performance-hub", createPerformanceIntelligenceRouter({
    service: testService as any,
    authMiddleware: (req: any, _res, next) => {
      if (authenticated) req.authUser = { id: "user-1", role: "team_leader" };
      next();
    },
  }));
  app.use(errorHandler);
  return app;
}

describe("performance intelligence routes", () => {
  it("returns 401 when no authenticated identity is available", async () => {
    const response = await request(appWith(service(), false))
      .get("/api/performance-hub/context");

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("returns 400 without querying the service for invalid dates", async () => {
    const testService = service();
    const response = await request(appWith(testService))
      .get("/api/performance-hub/scorecard?from=18/07/2026&to=2026-07-18");

    expect(response.status).toBe(400);
    expect(testService.scorecard).not.toHaveBeenCalled();
  });

  it("preserves a service authorization failure", async () => {
    const testService = service();
    testService.scorecard.mockRejectedValueOnce(
      Object.assign(new Error("outside scope"), { statusCode: 403 }),
    );

    const response = await request(appWith(testService))
      .get("/api/performance-hub/scorecard?from=2026-07-01&to=2026-07-18");

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("outside scope");
  });

  it.each([
    ["/context", "context"],
    ["/scorecard?from=2026-07-01&to=2026-07-18", "scorecard"],
    ["/trends?from=2026-07-01&to=2026-07-18", "trends"],
    ["/people?from=2026-07-01&to=2026-07-18", "people"],
  ])("returns the stable envelope for %s", async (path, serviceMethod) => {
    const testService = service();
    const response = await request(appWith(testService))
      .get(`/api/performance-hub${path}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      success: true,
      meta: { generatedAt: expect.any(String) },
    });
    expect(testService[serviceMethod as keyof typeof testService]).toHaveBeenCalled();
  });
});
