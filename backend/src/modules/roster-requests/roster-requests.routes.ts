import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { hasRole } from "../../shared/accessGuard.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";
import { resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { canAccessEmployee, OUT_OF_SCOPE_MSG, scopedProcessIdsForUser, userCanAccessProcess } from "../wfm/branch-scope.js";
import { computeImpact } from "./roster-requests.impact.js";
import { ALLOWED_ACTIONS, decideRosterRequest } from "./roster-requests.decide.js";
import { listDecisions } from "./roster-requests.decision-log.js";
import { listAutoRules, upsertAutoRule } from "./roster-requests.auto-rule.js";
import { listPendingCells, parsePendingCellsQuery } from "./roster-requests.pending-cells.js";
import { employeeScope } from "../wfm-extensions/employee-scope.js";
import { REQUEST_KINDS, type DecideInput, type ImpactResult, type RequestKind } from "./roster-requests.types.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const HUB_ROLES = ["admin", "hr", "wfm", "manager", "assistant_manager", "team_leader", "branch_head", "process_manager"];
const WEEKOFF_ROLES = ["admin", "hr", "wfm", "manager", "branch_head"];
const SWAP_CONFLICT_ROLES = ["admin", "hr", "wfm", "manager", "assistant_manager", "team_leader"];
const AUTO_RULE_WRITE_ROLES = ["admin", "hr", "wfm", "ho_wfm"];
const IMPACT_ROLES = ["admin", "hr", "wfm", "manager", "assistant_manager", "team_leader", "branch_head", "process_manager"];
const MAX_BULK_ITEMS = 50;

/**
 * Roles allowed to decide a request. Mirrors the per-kind endpoints this hub fronts. Disputes have no
 * role gate on the legacy route: roster ownership (canOwnRosterForUser) is enforced inside resolveDispute.
 */
export function rolesForKindAction(kind: RequestKind, _action: string): string[] {
  switch (kind) {
    case "weekoff_rejection":
      return [...WEEKOFF_ROLES];
    case "swap":
    case "conflict":
      return [...SWAP_CONFLICT_ROLES];
    case "dispute":
    default:
      return [...HUB_ROLES];
  }
}

export function parseImpactQuery(q: Record<string, unknown>): { kind: RequestKind; id: string } | null {
  const kind = String(q.kind ?? "");
  const id = String(q.id ?? "").trim();
  if (!id || !(REQUEST_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as RequestKind, id };
}

class HttpFail extends Error {
  constructor(public statusCode: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Every employee whose roster the request touches (incl. swap counterpart) must be in the caller's scope. */
export async function assertImpactScope(req: AuthenticatedRequest, impact: ImpactResult): Promise<void> {
  if (await hasRole(req.authUser!.id, ...ORG_WIDE_EXEMPT_ROLES)) return;
  const scope = await resolveUserBusinessScope(req.authUser!.id);
  for (const w of impact.week) {
    if (!(await canAccessEmployee(scope, w.employeeId))) throw new HttpFail(403, OUT_OF_SCOPE_MSG);
  }
}

/**
 * computeImpact + scope check. For a non-org-wide caller a nonexistent request answers with the SAME 403 as
 * an out-of-scope one, so the endpoint is not an existence oracle. Org-wide users keep the true 404.
 */
export async function scopedImpact(req: AuthenticatedRequest, kind: RequestKind, id: string): Promise<ImpactResult> {
  let impact: ImpactResult;
  try {
    impact = await computeImpact(kind, id);
  } catch (err: any) {
    if (err?.statusCode === 404 && !(await hasRole(req.authUser!.id, ...ORG_WIDE_EXEMPT_ROLES))) throw new HttpFail(403, OUT_OF_SCOPE_MSG);
    throw err;
  }
  await assertImpactScope(req, impact);
  return impact;
}

/** Role + scope + apply for one request. Throws HttpFail (or the decide service's statusCode errors). */
async function decideOne(req: AuthenticatedRequest, kind: RequestKind, id: string, input: DecideInput) {
  if (!(REQUEST_KINDS as readonly string[]).includes(kind)) throw new HttpFail(400, "Unsupported request kind");
  if (!(ALLOWED_ACTIONS[kind] as readonly string[]).includes(input?.action as string)) {
    throw new HttpFail(400, `Action '${String(input?.action)}' is not supported for ${kind}; allowed: ${ALLOWED_ACTIONS[kind].join(", ")}`);
  }
  if (!(await hasRole(req.authUser!.id, ...rolesForKindAction(kind, input.action)))) {
    throw new HttpFail(403, "You do not have permission to decide this request");
  }
  await scopedImpact(req, kind, id);
  return decideRosterRequest(kind, id, input, { userId: req.authUser!.id, req });
}

function failureOf(err: any): { status: number; error: string; impact?: ImpactResult; body?: Record<string, unknown> } {
  const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
  const error = status >= 500 && !err?.statusCode ? "Unexpected server error" : String(err?.message ?? "Request failed");
  return { status, error, impact: err?.impact, body: err?.body };
}

function sendFailure(res: Response, err: any) {
  const f = failureOf(err);
  if (typeof err?.statusCode !== "number") throw err; // unexpected: let the global errorHandler mask it
  if (f.impact) return res.status(f.status).json({ success: false, error: f.error, impact: f.impact });
  if (f.body) return res.status(f.status).json({ success: false, ...f.body });
  return res.status(f.status).json({ success: false, error: f.error, message: f.error });
}

router.use(requireAuth);

router.get(
  "/impact",
  requireRole(...IMPACT_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = parseImpactQuery(req.query as Record<string, unknown>);
    if (!q) return res.status(400).json({ success: false, error: "kind (swap|weekoff_rejection|dispute|conflict) and id are required" });
    try {
      return res.json({ success: true, data: await scopedImpact(req, q.kind, q.id) });
    } catch (err) {
      return sendFailure(res, err);
    }
  }),
);

// Roster-cell pending badges. Static path: registered before the /:kind/:id routes.
router.get(
  "/pending-cells",
  requireRole(...IMPACT_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = parsePendingCellsQuery(req.query as Record<string, unknown>);
    if (!q) return res.status(400).json({ success: false, error: "from and to are required as YYYY-MM-DD with from <= to" });
    const userId = req.authUser!.id;
    const scope = (await hasRole(userId, ...ORG_WIDE_EXEMPT_ROLES)) ? { sql: "1=1", params: [] as unknown[] } : await employeeScope(userId);
    return res.json({ success: true, data: await listPendingCells(q, scope) });
  }),
);

router.post(
  "/bulk-decide",
  requireRole(...HUB_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { items, action, reason } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: "items is required" });
    if (items.length > MAX_BULK_ITEMS) return res.status(400).json({ success: false, error: `At most ${MAX_BULK_ITEMS} items per request` });
    if (action !== "approve" && action !== "reject") return res.status(400).json({ success: false, error: "action must be approve or reject" });
    const results: Array<{ kind: string; id: string; ok: boolean; status?: number; error?: string; blockers?: string[] }> = [];
    for (const item of items) {
      const kind = String(item?.kind ?? "");
      const id = String(item?.id ?? "").trim();
      try {
        if (!id) throw new HttpFail(400, "id is required");
        await decideOne(req, kind as RequestKind, id, { action, reason });
        results.push({ kind, id, ok: true });
      } catch (err: any) {
        const f = failureOf(err);
        const entry: (typeof results)[number] = { kind, id, ok: false, status: f.status, error: f.error };
        if (f.impact?.blockers?.length) entry.blockers = f.impact.blockers;
        results.push(entry);
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    return res.json({ success: true, data: { results, okCount, failCount: results.length - okCount } });
  }),
);

router.get(
  "/auto-rules",
  requireRole(...HUB_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const scope = (await hasRole(req.authUser!.id, ...ORG_WIDE_EXEMPT_ROLES)) ? "unrestricted" : await scopedProcessIdsForUser(req.authUser!.id);
    const rows = await listAutoRules(scope === "unrestricted" ? "all" : scope);
    return res.json({ success: true, data: rows });
  }),
);

router.put(
  "/auto-rules",
  requireRole(...AUTO_RULE_WRITE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const b = req.body ?? {};
    const processId = String(b.processId ?? "").trim();
    if (!processId) return res.status(400).json({ success: false, error: "processId is required" });
    if (!(REQUEST_KINDS as readonly string[]).includes(b.kind)) return res.status(400).json({ success: false, error: "Invalid request kind" });
    if (typeof b.enabled !== "boolean") return res.status(400).json({ success: false, error: "enabled must be a boolean" });
    const userId = req.authUser!.id;
    const orgWide = await hasRole(userId, ...ORG_WIDE_EXEMPT_ROLES);
    if (!orgWide && !(await userCanAccessProcess(userId, processId))) {
      return res.status(403).json({ success: false, message: OUT_OF_SCOPE_MSG });
    }
    const input = {
      processId,
      kind: b.kind as string,
      enabled: b.enabled,
      maxCoverageDrop: b.maxCoverageDrop === undefined ? 0 : Number(b.maxCoverageDrop),
      requireCounterpartAccept: b.requireCounterpartAccept === undefined ? true : b.requireCounterpartAccept !== false,
    };
    try {
      await upsertAutoRule(input, userId);
    } catch (err: any) {
      return res.status(400).json({ success: false, error: String(err?.message ?? "Invalid auto-rule") });
    }
    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "ROSTER_REQUEST_AUTO_RULE_UPDATED",
      module_key: "WFM",
      entity_type: "roster_request_auto_rule",
      entity_id: `${processId}:${input.kind}`,
      change_summary: { ...input },
      req,
    });
    return res.json({ success: true, data: input });
  }),
);

router.post(
  "/:kind/:id/decide",
  requireRole(...HUB_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const kind = String(req.params.kind);
    try {
      const data = await decideOne(req, kind as RequestKind, String(req.params.id), req.body ?? {});
      return res.json({ success: true, data });
    } catch (err) {
      return sendFailure(res, err);
    }
  }),
);

router.get(
  "/:kind/:id/history",
  requireRole(...HUB_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = parseImpactQuery({ kind: req.params.kind, id: req.params.id });
    if (!q) return res.status(400).json({ success: false, error: "kind (swap|weekoff_rejection|dispute|conflict) and id are required" });
    try {
      await scopedImpact(req, q.kind, q.id);
    } catch (err) {
      return sendFailure(res, err);
    }
    return res.json({ success: true, data: await listDecisions(q.kind, q.id) });
  }),
);

export { router as rosterRequestsRouter };
