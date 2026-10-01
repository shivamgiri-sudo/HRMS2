import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { hasRole } from "../../shared/accessGuard.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";
import { resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { canAccessEmployee, OUT_OF_SCOPE_MSG } from "../wfm/branch-scope.js";
import { computeImpact } from "./roster-requests.impact.js";
import { REQUEST_KINDS, type RequestKind } from "./roster-requests.types.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export function parseImpactQuery(q: Record<string, unknown>): { kind: RequestKind; id: string } | null {
  const kind = String(q.kind ?? "");
  const id = String(q.id ?? "").trim();
  if (!id || !(REQUEST_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as RequestKind, id };
}

router.use(requireAuth);

router.get(
  "/impact",
  requireRole("admin", "hr", "wfm", "manager", "assistant_manager", "team_leader", "branch_head", "process_manager"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = parseImpactQuery(req.query as Record<string, unknown>);
    if (!q) return res.status(400).json({ success: false, error: "kind (swap|weekoff_rejection|dispute|conflict) and id are required" });
    // A 404 from computeImpact carries statusCode and is mapped by the global errorHandler.
    const impact = await computeImpact(q.kind, q.id);
    // Scope: every employee whose roster the request touches (incl. swap counterpart) must be in scope.
    if (!(await hasRole(req.authUser!.id, ...ORG_WIDE_EXEMPT_ROLES))) {
      const scope = await resolveUserBusinessScope(req.authUser!.id);
      for (const w of impact.week) {
        if (!(await canAccessEmployee(scope, w.employeeId))) {
          return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
        }
      }
    }
    return res.json({ success: true, data: impact });
  }),
);

export { router as rosterRequestsRouter };
