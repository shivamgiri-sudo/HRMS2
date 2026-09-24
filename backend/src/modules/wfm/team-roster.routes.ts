/**
 * /api/wfm/team-roster - Team Roster submission workflow.
 *
 * Authentication only at the router level: the audience is "anyone who has people reporting to them"
 * (64 of the 78 real managers hold only the employee role), which no role list can express. Every
 * handler therefore enforces its own rule server-side: the reporting tree (team-roster-tree.ts) for
 * the manager surface, the named approver for the manager step, and the WFM role + branch/process
 * scope for the final step. Mounted before the catch-all /api/wfm routers in app.ts.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { readLobFilter } from "../../shared/lobFilter.js";
import { cancelSubmission, copySubmissionToDraft, submitDraft } from "./team-roster-submit.js";
import { discardDraft, getMyDraft, setDraftNote, upsertDraftLines } from "./team-roster-draft.js";
import { getSubmissionDetail, listApprovals, listMySubmissions } from "./team-roster-query.js";
import { getTeamAttendance, getTeamAttendanceDetail } from "./team-roster-attendance.js";
import { getGrid, getMe, listTemplates } from "./team-roster.service.js";
import { managerDecide, wfmDecide } from "./team-roster-workflow.js";
import { MAX_REMARKS_LENGTH, NEW_ASSIGNMENT_TYPES, TeamRosterError, type Actor } from "./team-roster-types.js";

export const teamRosterRouter = Router();
teamRosterRouter.use(requireAuth);

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const int = z.coerce.number().int().min(0).optional();
const cellRef = z.object({ employeeId: z.string().trim().min(1).max(36), date: ymd });
const schemas = {
  grid: z.object({ from: ymd, to: ymd, search: z.string().trim().max(100).optional(), offset: int, limit: int }),
  lines: z.object({
    upserts: z.array(cellRef.extend({
      type: z.enum(NEW_ASSIGNMENT_TYPES),
      shiftTemplateId: z.string().trim().max(36).nullish(),
      shiftStart: z.string().trim().regex(/^\d{1,2}:\d{2}$/, "expected HH:MM").nullish(),
      shiftEnd: z.string().trim().regex(/^\d{1,2}:\d{2}$/, "expected HH:MM").nullish(),
      shiftMasterId: z.string().trim().max(36).nullish(),
      reason: z.string().trim().max(500).nullish(),
    })).max(2000).optional(),
    deletes: z.array(cellRef).max(2000).optional(),
  }),
  note: z.object({ note: z.string().trim().max(500).nullable() }),
  submit: z.object({ note: z.string().trim().max(500).nullish() }),
  decision: z.object({ remarks: z.string().trim().max(MAX_REMARKS_LENGTH).nullish() }),
  mine: z.object({ status: z.string().trim().max(30).optional(), offset: int, limit: int }),
  approvals: z.object({ step: z.enum(["manager", "wfm"]), offset: int, limit: int }),
  attendance: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM"), search: z.string().trim().max(100).optional(), offset: int, limit: int }),
  attendanceDetail: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "expected YYYY-MM") }),
};

const actorOf = (req: Request): Actor => {
  const u = (req as any).authUser ?? {};
  return { id: u.id, role: u.role, roles: u.roles, isDemo: u.isDemo };
};

function run<S extends z.ZodTypeAny>(
  source: "body" | "query" | "none",
  schema: S | null,
  fn: (actor: Actor, input: z.infer<S>, req: Request) => Promise<unknown>,
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
            message: first ? `Invalid ${first[0]}: ${(first[1] ?? [])[0] ?? "invalid value"}` : "Validation error", errors: fields,
          });
        }
        input = parsed.data;
      }
      return res.status(successStatus).json({ success: true, data: await fn(actorOf(req), input, req) });
    } catch (err) {
      if (err instanceof TeamRosterError) {
        return res.status(err.statusCode).json({ success: false, message: err.message, code: err.code, details: err.details });
      }
      console.error("[team-roster]", err instanceof Error ? err.message : err);
      return res.status(500).json({ success: false, message: "Internal server error", code: "INTERNAL" });
    }
  };
}

const idOf = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new TeamRosterError(400, "Invalid submission id.", "VALIDATION");
  return id;
};

// Static paths first so nothing is captured by "/submissions/:id".
teamRosterRouter.get("/me", run("none", null, (a) => getMe(a)));
teamRosterRouter.get("/templates", run("none", null, (a) => listTemplates(a)));
teamRosterRouter.get("/grid", (req, res, next) => {
  const lob = readLobFilter(req, res);
  if (!lob) return;
  (req as any).lob = lob;
  next();
}, run("query", schemas.grid, (a, q, req) => getGrid(a, { ...q, lob: (req as any).lob })));
teamRosterRouter.get("/attendance", (req, res, next) => {
  const lob = readLobFilter(req, res);
  if (!lob) return;
  (req as any).lob = lob;
  next();
}, run("query", schemas.attendance, (a, q, req) => getTeamAttendance(a, { ...q, lob: (req as any).lob })));
teamRosterRouter.get("/attendance/:employeeId", run("query", schemas.attendanceDetail, (a, q, req) => getTeamAttendanceDetail(a, String(req.params.employeeId).slice(0, 36), q.month)));
teamRosterRouter.get("/draft", run("none", null, (a) => getMyDraft(a)));
teamRosterRouter.put("/draft/lines", run("body", schemas.lines, (a, b) => upsertDraftLines(a, {
  upserts: b.upserts?.map((u) => ({ ...u, shiftTemplateId: u.shiftTemplateId ?? null, shiftStart: u.shiftStart ?? null, shiftEnd: u.shiftEnd ?? null, shiftMasterId: u.shiftMasterId ?? null, reason: u.reason ?? null })),
  deletes: b.deletes,
})));
teamRosterRouter.put("/draft/note", run("body", schemas.note, async (a, b) => { await setDraftNote(a, b.note); return { saved: true }; }));
teamRosterRouter.delete("/draft", run("none", null, (a) => discardDraft(a)));
teamRosterRouter.post("/draft/submit", run("body", schemas.submit, (a, b) => submitDraft(a, { note: b.note ?? null }), 201));
teamRosterRouter.get("/submissions", run("query", schemas.mine, (a, q) => listMySubmissions(a, q)));
teamRosterRouter.get("/approvals", run("query", schemas.approvals, (a, q) => listApprovals(a, q)));
teamRosterRouter.get("/submissions/:id", run("none", null, (a, _i, req) => getSubmissionDetail(a, idOf(req))));
teamRosterRouter.post("/submissions/:id/cancel", run("none", null, (a, _i, req) => cancelSubmission(a, idOf(req))));
teamRosterRouter.post("/submissions/:id/copy-to-draft", run("none", null, (a, _i, req) => copySubmissionToDraft(a, idOf(req))));
teamRosterRouter.post("/submissions/:id/manager-approve", run("body", schemas.decision, (a, b, req) => managerDecide(a, idOf(req), "approve", b.remarks)));
teamRosterRouter.post("/submissions/:id/manager-reject", run("body", schemas.decision, (a, b, req) => managerDecide(a, idOf(req), "reject", b.remarks)));
teamRosterRouter.post("/submissions/:id/wfm-approve", run("body", schemas.decision, (a, b, req) => wfmDecide(a, idOf(req), "approve", b.remarks)));
teamRosterRouter.post("/submissions/:id/wfm-reject", run("body", schemas.decision, (a, b, req) => wfmDecide(a, idOf(req), "reject", b.remarks)));
