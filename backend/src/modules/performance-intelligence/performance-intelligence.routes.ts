import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { performanceIntelligenceRepository } from "./performance-intelligence.repository.js";
import {
  createPerformanceIntelligenceService,
  type PerformanceIntelligenceService,
} from "./performance-intelligence.service.js";
import { parsePerformanceQuery } from "./performance-intelligence.validation.js";

interface RouterDependencies {
  service?: PerformanceIntelligenceService;
  authMiddleware?: RequestHandler;
}

type AsyncHandler = (
  req: AuthenticatedRequest,
  res: Response,
) => Promise<unknown>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next: NextFunction) => {
    Promise.resolve(handler(req as AuthenticatedRequest, res)).catch(next);
  };
}

function auth(req: AuthenticatedRequest): { userId: string } {
  const userId = req.authUser?.id;
  if (!userId) {
    throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  }
  return { userId };
}

function sendData(
  res: Response,
  data: unknown,
  period?: { from: string; to: string },
) {
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({
    success: true,
    data,
    meta: {
      generatedAt: new Date().toISOString(),
      ...(period ? { period } : {}),
    },
  });
}

export function createPerformanceIntelligenceRouter(
  dependencies: RouterDependencies = {},
) {
  const router = Router();
  const service = dependencies.service ?? createPerformanceIntelligenceService({
    repository: performanceIntelligenceRepository,
  });

  router.use(dependencies.authMiddleware ?? requireAuth);

  router.get("/context", asyncHandler(async (req, res) => {
    return sendData(res, await service.context(auth(req)));
  }));

  router.get("/scorecard", asyncHandler(async (req, res) => {
    const query = parsePerformanceQuery(req.query);
    return sendData(
      res,
      await service.scorecard(auth(req), query),
      { from: query.from, to: query.to },
    );
  }));

  router.get("/trends", asyncHandler(async (req, res) => {
    const query = parsePerformanceQuery(req.query);
    return sendData(
      res,
      await service.trends(auth(req), query),
      { from: query.from, to: query.to },
    );
  }));

  router.get("/people", asyncHandler(async (req, res) => {
    const query = parsePerformanceQuery(req.query);
    return sendData(
      res,
      await service.people(auth(req), query),
      { from: query.from, to: query.to },
    );
  }));

  return router;
}

export const performanceIntelligenceRouter = createPerformanceIntelligenceRouter();
