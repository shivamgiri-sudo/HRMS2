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
rosterRouter.get("/actual-process",
  requireRole("admin", "wfm", "process_manager", "branch_head", "hr", "ceo"),
  h(c.getActualProcess.bind(c))
);

rosterRouter.get("/actual-assignments",
  requireRole("admin", "wfm", "process_manager", "branch_head", "hr", "ceo"),
  h(c.listActualAssignments.bind(c))
);

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
