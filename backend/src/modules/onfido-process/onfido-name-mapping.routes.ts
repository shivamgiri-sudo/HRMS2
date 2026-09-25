import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./onfido-name-mapping.service.js";

/**
 * Admin/HR review API for the Onfido AM/TL name-to-employee reconciliation
 * feature (see backend/sql/1869_onfido_name_employee_map.sql). Mounted at
 * /api/onfido-process/name-mapping in app.ts, alongside the existing Onfido
 * process dashboard router — same base path, same admin/hr gate already
 * established across this codebase's other HR-facing write endpoints (e.g.
 * access.routes.ts, career.routes.ts, benefits.routes.ts all use
 * requireRole("admin", "hr")).
 *
 * This is deliberately a separate router file, not added to
 * onfido-process-dashboard.routes.ts: the dashboard router's VIEWER_ROLES and
 * requireOnfidoScope gate general dashboard viewing (any process-scoped
 * viewer role), while name-mapping review is a narrower admin/HR write
 * capability with no branch/process scoping concept of its own — a mapping
 * row is not tied to a branch or process, it is tied to a raw TL/AM name.
 */
export const onfidoNameMappingRouter = Router();

type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h =
  (fn: AsyncHandler) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

onfidoNameMappingRouter.use(requireAuth, requireRole("admin", "hr"));

/**
 * GET /api/onfido-process/name-mapping?verified=true|false
 * Lists mapping rows for the HR review screen. Omit ?verified to see every
 * row; ?verified=false surfaces exactly what HR needs to review next.
 */
onfidoNameMappingRouter.get(
  "/",
  h(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const verified = q.verified === "true" ? true : q.verified === "false" ? false : undefined;
    const data = await svc.listMappings({ verified });
    res.json({ success: true, data });
  }),
);

/**
 * PATCH /api/onfido-process/name-mapping/:id
 * Body: { employeeId: string | null }
 * HR's explicit decision on one row. employeeId: null is valid — "no
 * employee matches this name" is itself a reviewed, verified decision, not
 * an error. verifiedByUserId is taken from the authenticated caller's own
 * id, never from the request body, so a caller cannot attribute a review to
 * someone else.
 */
onfidoNameMappingRouter.patch(
  "/:id",
  h(async (req, res) => {
    const employeeId = req.body?.employeeId;
    if (employeeId !== null && typeof employeeId !== "string") {
      return res
        .status(400)
        .json({ success: false, message: "employeeId must be a string or null" });
    }

    const existing = await svc.getMappingRowById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Mapping row not found" });
    }

    if (employeeId !== null && !(await svc.employeeExists(employeeId))) {
      return res
        .status(400)
        .json({ success: false, message: "employeeId does not match any employee" });
    }

    await svc.verifyMapping(req.params.id, {
      employeeId,
      verifiedByUserId: req.authUser!.id,
    });

    const updated = await svc.getMappingRowById(req.params.id);
    res.json({ success: true, data: updated });
  }),
);
