import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  requireQueryScope,
  requireBodyScope,
  requireRosterPlanScope,
} from "../../middleware/scopeMiddleware.js";
import { rosterController as c } from "./roster.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(_req, file, cb) {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

export const rosterRouter = Router();
rosterRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Plans
rosterRouter.post("/plans",
  requireRole("admin", "wfm", "process_manager"),
  requireBodyScope(["wfm", "process_manager"], ["admin", "hr"]),
  h(c.createPlan.bind(c))
);

rosterRouter.get("/plans",
  requireRole("admin", "wfm", "process_manager", "branch_head", "hr", "ceo"),
  requireQueryScope(["wfm", "process_manager", "branch_head"], ["admin", "hr", "ceo"]),
  h(c.listPlans.bind(c))
);

rosterRouter.patch("/plans/:id/publish",
  requireRole("admin", "wfm", "process_manager"),
  requireRosterPlanScope({
    planIdSource: "param",
    planIdKey: "id",
    scopedRoles: ["process_manager"],
    globalRoles: ["admin"],
  }),
  h(c.publishPlan.bind(c))
);

// Assignments
// GET /actual-process and GET /actual-assignments: handled by
// roster.actual.secure.routes.ts (mounted first at /api/wfm/roster — see app.ts). Removed
// here (delta-audit 2026-08-14, Stage 7, item 6) — this was dead code shadowed by the
// identically-pathed pair there, undocumented until now. Not merely redundant: this
// version only did a coarse requireRole check, while the version that actually runs
// applies real row-level scope filtering (actualRosterScope/buildScopeWhereClause,
// including the team_leader/tl role-alias fix shared with wfm-ext.routes.ts,
// leave.secure.routes.ts and wfm.regularization.secure.routes.ts). Confirm any future
// change to these two reads lands in roster.actual.secure.routes.ts.

rosterRouter.post("/assignments",
  requireRole("admin", "wfm", "process_manager"),
  requireRosterPlanScope({
    planIdSource: "body",
    planIdKey: "planId",
    scopedRoles: ["wfm", "process_manager"],
    globalRoles: ["admin"],
    requireDraft: true,
    publishedChangeRoles: ["process_manager"],
  }),
  h(c.assignEmployee.bind(c))
);

rosterRouter.get("/assignments",
  requireRole("admin", "wfm", "process_manager", "branch_head", "hr", "ceo"),
  requireRosterPlanScope({
    planIdSource: "query",
    planIdKey: "planId",
    scopedRoles: ["wfm", "process_manager", "branch_head"],
    globalRoles: ["admin", "hr", "ceo"],
  }),
  h(c.listAssignments.bind(c))
);

// CSV upload — multer runs before controller
rosterRouter.post("/upload",
  requireRole("admin", "wfm", "process_manager"),
  requireRosterPlanScope({
    planIdSource: "query",
    planIdKey: "planId",
    scopedRoles: ["wfm", "process_manager"],
    globalRoles: ["admin"],
    requireDraft: true,
  }),
  upload.single("file"),
  h(c.uploadCsv.bind(c))
);
