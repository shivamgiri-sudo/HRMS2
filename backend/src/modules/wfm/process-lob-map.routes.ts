/**
 * /api/wfm/process-lobs — process-wise LOB mapping and employee LOB assignment.
 * Every route is role-gated (WFM_LOB_ROLES) and row-scoped in the service layer.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  BULK_LOB_MAX,
  LobServiceError,
  WFM_LOB_ROLES,
  addMapping,
  bulkAssignLob,
  createLob,
  getEmployeeLobOptions,
  getMappingDetail,
  getProcessLobOptions,
  listActiveLobs,
  listEmployeesWithoutLob,
  listManageableProcesses,
  listMappings,
  setEmployeeLob,
  setMappingActive,
  summarizeEmployeesWithoutLob,
  type Actor,
} from "./process-lob-map.service.js";

export const processLobMapRouter = Router();
processLobMapRouter.use(requireAuth);
processLobMapRouter.use(requireRole(...WFM_LOB_ROLES));

const id = z.string().trim().min(1).max(36);
const optId = id.optional();
const page = z.coerce.number().int().min(1).optional();
const limit = z.coerce.number().int().min(1).max(200).optional();
const flag = z.enum(["true", "false", "1", "0"]).optional().transform((v) => v === "true" || v === "1");

const schemas = {
  mappingsQuery: z.object({ process_id: optId, branch_id: optId, lob_id: optId, include_inactive: flag, page, limit }),
  processesQuery: z.object({ branch_id: optId, search: z.string().trim().max(100).optional(), only_unmapped: flag, page, limit }),
  addMapping: z.object({ process_id: id, lob_id: id }),
  setActive: z.object({ active_status: z.union([z.literal(0), z.literal(1), z.boolean()]) }),
  createLob: z.object({
    lob_name: z.string().trim().min(2).max(255),
    lob_code: z.string().trim().max(50).optional(),
    description: z.string().trim().max(1000).optional(),
  }),
  setEmployeeLob: z.object({ lob_id: id.nullable() }),
  withoutLobQuery: z.object({ process_id: optId, branch_id: optId, search: z.string().trim().max(100).optional(), page, limit }),
  summaryQuery: z.object({ branch_id: optId }),
  bulk: z.object({ process_id: id, lob_id: id, employee_ids: z.array(id).max(BULK_LOB_MAX).optional() }),
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
      console.error("[process-lob-map]", err instanceof Error ? err.message : err);
      return res.status(500).json({ success: false, message: "Internal server error", code: "INTERNAL" });
    }
  };
}

// Static paths first so they are never captured by "/:id".
processLobMapRouter.get("/lobs", handle("none", null, () => listActiveLobs()));
processLobMapRouter.post("/lobs", handle("body", schemas.createLob, (a, b) => createLob(a, b), 201));
processLobMapRouter.get("/processes", handle("query", schemas.processesQuery, (a, q) => listManageableProcesses(a, q)));
processLobMapRouter.get("/processes/:processId/lob-options", handle("none", null, (a, _i, req) => getProcessLobOptions(a, String(req.params.processId))));
processLobMapRouter.get("/employees-without-lob/summary", handle("query", schemas.summaryQuery, (a, q) => summarizeEmployeesWithoutLob(a, q)));
processLobMapRouter.get("/employees-without-lob", handle("query", schemas.withoutLobQuery, (a, q) => listEmployeesWithoutLob(a, q)));
processLobMapRouter.post("/employees/bulk-lob", handle("body", schemas.bulk, (a, b) => bulkAssignLob(a, b)));
processLobMapRouter.get("/employees/:employeeId/lob-options", handle("none", null, (a, _i, req) => getEmployeeLobOptions(a, String(req.params.employeeId))));
processLobMapRouter.put("/employees/:employeeId/lob", handle("body", schemas.setEmployeeLob, (a, b, req) => setEmployeeLob(a, String(req.params.employeeId), b.lob_id)));

processLobMapRouter.get("/", handle("query", schemas.mappingsQuery, (a, q) => listMappings(a, q)));
processLobMapRouter.post("/", handle("body", schemas.addMapping, (a, b) => addMapping(a, b), 201));
processLobMapRouter.get("/:id", handle("none", null, (a, _i, req) => getMappingDetail(a, String(req.params.id))));
processLobMapRouter.put("/:id", handle("body", schemas.setActive, (a, b, req) => setMappingActive(a, String(req.params.id), b.active_status === true || b.active_status === 1)));
