/**
 * /api/wfm/roster-offday-policies - fixed / floating weekly-off policy per process, LOB and branch.
 * Every route is role-gated (WFM_LOB_ROLES, same as Process LOB Mapping) and row-scoped in the
 * service layer.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { LobServiceError, WFM_LOB_ROLES, type Actor } from "./process-lob-map.service.js";
import {
  createPolicy, getPolicyDetail, listBranchOptions, listPolicies, resolvePolicyForEmployee, setPolicyActive, updatePolicy,
} from "./roster-offday-policy.service.js";

export const rosterOffdayPolicyRouter = Router();
rosterOffdayPolicyRouter.use(requireAuth);
rosterOffdayPolicyRouter.use(requireRole(...WFM_LOB_ROLES));

const id = z.string().trim().min(1).max(36);
const optId = id.optional();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const page = z.coerce.number().int().min(1).optional();
const limit = z.coerce.number().int().min(1).max(200).optional();
const flag = z.enum(["true", "false", "1", "0"]).optional().transform((v) => v === "true" || v === "1");
const offType = z.enum(["FIXED_DAY", "FLOATING"]);
const weekdays = z.array(z.number().int().min(0).max(6)).max(7).optional();

const editable = {
  off_type: offType,
  fixed_weekdays: weekdays,
  floating_offs_per_week: z.number().int().nullable().optional(),
  effective_from: ymd,
  effective_to: ymd.nullable().optional(),
};

const schemas = {
  listQuery: z.object({ process_id: optId, lob_id: optId, branch_id: optId, include_inactive: flag, page, limit }),
  create: z.object({ process_id: id, lob_id: id.nullable().optional(), branch_id: id.nullable().optional(), ...editable }),
  update: z.object(editable),
  setActive: z.object({ active_status: z.union([z.literal(0), z.literal(1), z.boolean()]) }),
  resolveQuery: z.object({ employee_id: id, date: ymd }),
};

function actorOf(req: Request): Actor {
  const u = (req as any).authUser ?? {};
  return { id: u.id, role: u.role, roles: u.roles, isDemo: u.isDemo };
}

function handle<S extends z.ZodTypeAny>(
  source: "body" | "query" | "none",
  schema: S | null,
  run: (actor: Actor, input: z.infer<S>, req: Request) => Promise<unknown>,
  successStatus = 200,
) {
  return async (req: Request, res: Response) => {
    try {
      let input: any = undefined;
      if (schema && source !== "none") {
        const parsed = schema.safeParse(source === "body" ? req.body : req.query);
        if (!parsed.success) {
          const fields = parsed.error.flatten().fieldErrors;
          const first = Object.entries(fields)[0];
          // `error` is deliberately omitted: hrmsApi prefers payload.error over payload.message.
          return res.status(400).json({
            success: false, code: "VALIDATION",
            message: first ? `Invalid ${first[0]}: ${(first[1] ?? [])[0] ?? "invalid value"}` : "Validation error",
            errors: fields,
          });
        }
        input = parsed.data;
      }
      const data = await run(actorOf(req), input, req);
      return res.status(successStatus).json({ success: true, data });
    } catch (err) {
      if (err instanceof LobServiceError) {
        return res.status(err.statusCode).json({ success: false, message: err.message, code: err.code });
      }
      console.error("[roster-offday-policy]", err instanceof Error ? err.message : err);
      return res.status(500).json({ success: false, message: "Internal server error", code: "INTERNAL" });
    }
  };
}

// Static paths first so they are never captured by "/:id".
rosterOffdayPolicyRouter.get("/branches", handle("none", null, (a) => listBranchOptions(a)));
rosterOffdayPolicyRouter.get("/resolve", handle("query", schemas.resolveQuery, (a, q) => resolvePolicyForEmployee(a, q.employee_id, q.date)));

rosterOffdayPolicyRouter.get("/", handle("query", schemas.listQuery, (a, q) => listPolicies(a, q)));
rosterOffdayPolicyRouter.post("/", handle("body", schemas.create, (a, b) => createPolicy(a, b), 201));
rosterOffdayPolicyRouter.get("/:id", handle("none", null, (a, _i, req) => getPolicyDetail(a, String(req.params.id))));
rosterOffdayPolicyRouter.put("/:id", handle("body", schemas.update, (a, b, req) => updatePolicy(a, String(req.params.id), b)));
rosterOffdayPolicyRouter.patch("/:id/active", handle("body", schemas.setActive, (a, b, req) => setPolicyActive(a, String(req.params.id), b.active_status === true || b.active_status === 1)));
