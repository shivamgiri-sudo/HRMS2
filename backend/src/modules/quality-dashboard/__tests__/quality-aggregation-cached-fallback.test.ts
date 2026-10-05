import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When the external quality service is down, a cached copy is a usable answer:
 * it must be 200 (the HRMS client drops the body of any non-2xx). With nothing
 * cached it stays a 503 so the page can show "quality data unavailable".
 */
const { cacheGet } = vi.hoisted(() => ({ cacheGet: vi.fn() }));

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireAgent.js", () => ({
  requireAgent: (req: any, _res: any, next: any) => { req.agentCode = "A1"; next(); },
}));
vi.mock("../../../db/mysql.js", () => ({ db: {} }));
vi.mock("../../../db/shivamgiriDb.js", () => ({ getShivamgiriPool: vi.fn() }));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../../lib/cache/quality-cache.js", () => ({ cacheInstance: { get: cacheGet } }));
vi.mock("../quality-aggregation.service.js", () => ({
  QualityAggregationService: class {
    getCQScore = vi.fn(async () => { throw new Error("upstream down"); });
    getWeaknessDetail = vi.fn(async () => { throw new Error("upstream down"); });
    getCallsReview = vi.fn(async () => { throw new Error("upstream down"); });
  },
}));

const { qualityAggregationRouter } = await import("../quality-aggregation.routes.js");
const app = () => { const a = express(); a.use("/api/agent", qualityAggregationRouter); return a; };

beforeEach(() => cacheGet.mockReset());

describe("quality aggregation outage fallback", () => {
  it.each(["/api/agent/cq-score", "/api/agent/weakness-detail", "/api/agent/calls-review"])(
    "%s serves a cached copy as 200 with cached:true",
    async (path) => {
      cacheGet.mockResolvedValue({ cq_score_current: 88 });
      const res = await request(app()).get(path);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, cached: true, data: { cq_score_current: 88 } });
    },
  );

  it.each(["/api/agent/cq-score", "/api/agent/weakness-detail", "/api/agent/calls-review"])(
    "%s stays 503 when nothing is cached",
    async (path) => {
      cacheGet.mockResolvedValue(null);
      const res = await request(app()).get(path);
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    },
  );
});
