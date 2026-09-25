/**
 * Routes for the Outliers & Actions tab. Mounted from onfido-process-dashboard.routes.ts via
 * mountOutlierRoutes(router, guard), so they inherit the router's auth + Onfido scope and the caller's role guard.
 */
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import {
  createAction,
  getOutlierReport,
  listActions,
  updateAction,
} from "./onfido-outlier.service.js";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const text = (max: number) => z.string().trim().max(max).nullish();

const createSchema = z.object({
  analystEmail: z.string().trim().min(3).max(255),
  analystName: text(255),
  tlName: text(255),
  amName: text(255),
  metric: z.enum(["Overall Error %", "POA Error %"]),
  periodFrom: isoDay,
  periodTo: isoDay,
  observedValue: z.number().finite().nullish(),
  targetValue: z.number().finite().nullish(),
  actionTaken: text(2000),
  rca: text(2000),
  ownerName: text(255),
  dueDate: isoDay.nullish(),
});

const updateSchema = z.object({
  actionTaken: text(2000),
  rca: text(2000),
  ownerName: text(255),
  dueDate: isoDay.nullish(),
  status: z.enum(["open", "in_progress", "closed"]).optional(),
  closureRemarks: text(2000),
});

const wrap =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req as AuthenticatedRequest, res).catch(next);
  };

function actorOf(req: AuthenticatedRequest) {
  return { id: req.authUser.id, name: req.authUser.email ?? req.authUser.id };
}

export function mountOutlierRoutes(
  router: Router,
  guard: RequestHandler[],
): void {
  router.get(
    "/outliers",
    ...guard,
    wrap(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      res.json({
        success: true,
        data: await getOutlierReport({
          from: str(q.from),
          to: str(q.to),
          tlName: str(q.tlName),
          amName: str(q.amName),
          analystEmail: str(q.analystEmail),
        }),
      });
    }),
  );

  router.get(
    "/outlier-actions",
    ...guard,
    wrap(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      res.json({
        success: true,
        data: await listActions({
          status: str(q.status),
          analystEmail: str(q.analystEmail),
          tlName: str(q.tlName),
          amName: str(q.amName),
        }),
      });
    }),
  );

  router.post(
    "/outlier-actions",
    ...guard,
    wrap(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid action",
        });
      if (parsed.data.periodTo < parsed.data.periodFrom)
        return res.status(400).json({
          success: false,
          message: "periodTo must not be before periodFrom",
        });
      res.status(201).json({
        success: true,
        data: await createAction(parsed.data, actorOf(req)),
      });
    }),
  );

  router.patch(
    "/outlier-actions/:id",
    ...guard,
    wrap(async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid update",
        });
      const id = String(req.params.id).slice(0, 36);
      res.json({ success: true, data: await updateAction(id, parsed.data) });
    }),
  );
}
