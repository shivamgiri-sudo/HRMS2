import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../visitor.service.js", () => ({
  visitorService: {
    listPublicBranches: vi.fn(),
    registerPublic: vi.fn(),
    getPublicStatus: vi.fn(),
    recordPublicConsent: vi.fn(),
    requestPublicCheckout: vi.fn(),
  },
}));

import { visitorPublicRouter } from "../visitor-public.routes.js";
import { visitorService } from "../visitor.service.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/visitor/public", visitorPublicRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    return res.status(error?.issues ? 400 : error?.statusCode ?? 500).json({ success: false });
  });
  return app;
}

describe("visitor public routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only the branch payload returned by the public service", async () => {
    vi.mocked(visitorService.listPublicBranches).mockResolvedValueOnce([
      { id: "branch-1", branch_code: "DEL", branch_name: "Delhi", city: "Delhi", state: "Delhi" },
    ] as any);

    const response = await request(createApp()).get("/api/visitor/public/branches");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it("rejects registration without explicit privacy consent", async () => {
    const response = await request(createApp())
      .post("/api/visitor/public/register")
      .send({ visitor: { full_name: "Visitor", mobile: "9876543210" } });

    expect(response.status).toBe(400);
    expect(visitorService.registerPublic).not.toHaveBeenCalled();
  });

  it("returns a no-store status response for a valid tracking token", async () => {
    vi.mocked(visitorService.getPublicStatus).mockResolvedValueOnce({
      visit_number: "VIS-20260716-ABC12345",
      status: "approved",
    } as any);

    const response = await request(createApp())
      .get(`/api/visitor/public/status/${"a".repeat(64)}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data).toEqual({ visit_number: "VIS-20260716-ABC12345", status: "approved" });
  });
});
